import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from '../src/billing/billing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
import { PaymentMode } from '@prisma/client';
import { InventoryGateway } from '../src/inventory/inventory.gateway';
import { InventoryCacheService } from '../src/inventory/inventory-cache.service';
import { BillingHelpers } from '../src/billing/billing.helpers';

import { TenantContextService } from '../src/iam/tenant-context/tenant-context.service';

describe('Billing Concurrency', () => {
  let billingService: BillingService;
  let prisma: PrismaService;
  let tenantContextService: TenantContextService;

  beforeAll(async () => {
    // For a real app, this should configure the testing module.
    // Assuming PrismaService and BillingService are provided properly.
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        PrismaService,
        TenantContextService,
        // Mock the gateway, cache and helpers
        { provide: InventoryGateway, useValue: { broadcastStockUpdate: jest.fn(), broadcastLowStockAlert: jest.fn() } },
        { provide: InventoryCacheService, useValue: { tryDecrementStock: jest.fn().mockResolvedValue('cache_miss'), restoreStock: jest.fn() } },
        { provide: BillingHelpers, useValue: { checkLowStockAlerts: jest.fn() } }
      ],
    }).compile();

    billingService = moduleRef.get<BillingService>(BillingService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    tenantContextService = moduleRef.get<TenantContextService>(TenantContextService);
  });

  it('should prevent overselling and allow exactly 1 success out of 5 concurrent requests', async () => {
    const uniqueSuffix = Date.now().toString() + Math.random().toString().slice(2, 6);
    // 1. Setup mock data
    const owner = await prisma.user.create({ data: { email: `owner-${uniqueSuffix}@test.com`, name: 'Owner', role: 'OWNER', password: 'pass', shopId: 'tmp' } });
    const shop = await prisma.shop.create({ data: { name: `Test Shop ${uniqueSuffix}`, ownerId: owner.id } });
    const user = await prisma.user.create({ data: { email: `test-${uniqueSuffix}@test.com`, name: 'Tester', role: 'CASHIER', password: 'pass', shopId: shop.id } });
    
    // Create a product with currentStock = 1
    const product = await prisma.product.create({
      data: {
        name: `Test Product ${uniqueSuffix}`,
        sku: `TEST-${uniqueSuffix}`,
        costPrice: 10,
        sellingPrice: 20,
        mrp: 20,
        wholesalePrice: 18,
        unit: 'PCS',
        currentStock: 1,
        stockVersion: 0,
        shopId: shop.id
      }
    });

    // 2. Fire 5 simultaneous requests
    const context = { shopId: shop.id, userId: user.id, role: 'CASHIER' as any, correlationId: 'test', requestId: 'test' };
    const requests = Array(5).fill(0).map((_, idx) => 
      tenantContextService.runWithContext(context, () => 
        billingService.createInvoice({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMode: PaymentMode.CASH,
          amountPaid: 150,
          idempotencyKey: `unique-key-${idx}` // DIFFERENT keys to bypass idempotency check for this specific test
        }, '127.0.0.1')
      )
    );

    const results = await Promise.allSettled(requests);

    // 3 & 4. Assert 1 success and 4 conflicts
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    rejected.forEach(rej => {
      // @ts-ignore
      expect(rej.reason).toBeInstanceOf(ConflictException);
      // @ts-ignore
      expect(rej.reason.response.code).toBe('INSUFFICIENT_STOCK');
    });

    // 5. Assert product's final currentStock is exactly 0
    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(finalProduct!.currentStock.toNumber()).toBe(0);
    expect(finalProduct!.stockVersion).toBe(1); // incremented exactly once

    // 6. Assert exactly 1 InvoiceItem and 1 InventoryLog entry exist
    const invoiceItems = await prisma.invoiceItem.findMany({ where: { productId: product.id } });
    expect(invoiceItems.length).toBe(1);

    const logs = await prisma.inventoryLog.findMany({ where: { productId: product.id } });
    expect(logs.length).toBe(1);
  });

  it('should test idempotency - prevent duplicate bills on retry', async () => {
    const uniqueSuffix = Date.now().toString() + Math.random().toString().slice(2, 6);
    const owner = await prisma.user.create({ data: { email: `owner-idem-${uniqueSuffix}@test.com`, name: 'Owner', role: 'OWNER', password: 'pass', shopId: 'tmp' } });
    const shop = await prisma.shop.create({ data: { name: `Test Shop Idem ${uniqueSuffix}`, ownerId: owner.id } });
    const user = await prisma.user.create({ data: { email: `idem-${uniqueSuffix}@test.com`, name: 'Tester', role: 'CASHIER', password: 'pass', shopId: shop.id } });
    const product = await prisma.product.create({
      data: {
        name: `Idem Product ${uniqueSuffix}`,
        sku: `IDEM-${uniqueSuffix}`,
        costPrice: 10,
        sellingPrice: 20,
        mrp: 20,
        wholesalePrice: 18,
        unit: 'PCS',
        currentStock: 10,
        stockVersion: 0,
        shopId: shop.id
      }
    });

    const dto = {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMode: PaymentMode.CASH,
      amountPaid: 150,
      idempotencyKey: `idem-test-${uniqueSuffix}`
    };

    const context = { shopId: shop.id, userId: user.id, role: 'CASHIER' as any, correlationId: 'test', requestId: 'test' };
    const firstCall = await tenantContextService.runWithContext(context, () => billingService.createInvoice(dto, '127.0.0.1'));
    const secondCall = await tenantContextService.runWithContext(context, () => billingService.createInvoice(dto, '127.0.0.1'));

    // Assert both return exact same invoice
    expect(firstCall.id).toBe(secondCall.id);

    // Assert only 1 Invoice row exists with that key
    const count = await prisma.invoice.count({ where: { idempotencyKey: `idem-test-${uniqueSuffix}` } });
    expect(count).toBe(1);
  });
});
