import { PrismaClient, PaymentMode } from '@prisma/client';
import { BillingService } from '../../apps/api/src/billing/billing.service';
import { InventoryCacheService } from '../../apps/api/src/inventory/inventory-cache.service';
import { BillingHelpers } from '../../apps/api/src/billing/billing.helpers';
import { TenantContextService } from '../../apps/api/src/iam/tenant-context/tenant-context.service';
import { BillingFeatureConfig } from '../../apps/api/src/config/domains/features/billing-feature.config';

const prisma = new PrismaClient();

// Mocks
class MockTenantContext {
  shopId = '';
  userId = '';
  getShopId() { return this.shopId; }
  getUserId() { return this.userId; }
  getCorrelationId() { return 'test-correlation-id'; }
}

class MockInventoryGateway {
  broadcastStockUpdate() {}
  broadcastLowStockAlert() {}
}
class MockCacheConfig { inventoryStockTtlSeconds = 3600; }
class MockRedis { 
  async exists() { return false; } 
  async eval() { return '-2'; } // Force cache miss to hit DB
  async incrbyfloat() {}
  async set() {}
}
class MockBillingConfig {
  jitterDelayBaseMs = 10;
  jitterDelayRandomMultiplier = 50;
}

async function prepareTest(initialStock: number) {
  const shopId = `shop-test-${Date.now()}`;
  const userId = `user-test-${Date.now()}`;
  
  await prisma.shop.create({ data: { id: shopId, name: 'Test Shop', status: 'ACTIVE' } });
  await prisma.user.create({ data: { id: userId, shopId, email: `test-${Date.now()}@test.com`, name: 'Test User', role: 'CASHIER' } });

  const product = await prisma.product.create({
    data: {
      shopId, name: 'Test Product', sku: 'TEST-123',
      currentStock: initialStock, sellingPrice: 100, costPrice: 50, mrp: 120,
      wholesalePrice: 90, gstRate: 'EIGHTEEN', type: 'SIMPLE',
      stockVersion: 1, unit: 'PCS'
    }
  });

  const invItem = await prisma.inventoryItem.create({
    data: { shopId, productId: product.id, locationId: 'DEFAULT', onHand: initialStock, status: 'AVAILABLE' }
  });

  const tenantContext = new MockTenantContext();
  tenantContext.shopId = shopId;
  tenantContext.userId = userId;
  const inventoryCache = new InventoryCacheService(null as any, new MockRedis() as any, prisma, tenantContext as any, new MockCacheConfig() as any);
  const inventoryGateway = new MockInventoryGateway();
  const billingHelpers = new BillingHelpers(prisma, inventoryGateway as any, tenantContext as any);
  
  const billingService = new BillingService(
    prisma, inventoryGateway as any, inventoryCache, billingHelpers, tenantContext as any, new MockBillingConfig() as any, null as any
  );
  
  let mockSeq = 1000;
  (billingService as any).generateInvoiceNumber = async () => { return `INV-${Date.now()}-${mockSeq++}`; };
  
  return { billingService, product, invItem, shopId, userId };
}

async function verifyLedger(invItemId: string, initialStock: number) {
  const ledgerEntries = await prisma.stockLedgerEntry.findMany({ 
    where: { inventoryItemId: invItemId },
    orderBy: { createdAt: 'asc' } 
  });
  let previousBalance = initialStock;
  let corrupted = 0;
  ledgerEntries.forEach((entry, idx) => {
    const expectedBalance = previousBalance + entry.quantity.toNumber();
    const actualBalance = entry.balanceAfter.toNumber();
    const isCorrupted = expectedBalance !== actualBalance;
    if (isCorrupted) corrupted++;
    console.log(`  [${idx}] qty: ${entry.quantity}, balanceAfter: ${actualBalance} (Expected: ${expectedBalance}) ${isCorrupted ? '❌ CORRUPTED' : '✅'}`);
    previousBalance = actualBalance;
  });
  console.log(`Result: ${corrupted > 0 ? '❌ LEDGER CORRUPTED' : '✅ LEDGER CONSISTENT'}`);
  return corrupted === 0;
}

async function runSalesTest(concurrentRequests: number, quantityPerRequest: number, initialStock: number) {
  console.log(`\n--- RUNNING TEST: ${concurrentRequests} concurrent sales of ${quantityPerRequest} unit(s) against stock ${initialStock} ---`);
  const { billingService, product, invItem } = await prepareTest(initialStock);
  const promises = [];
  for (let i = 0; i < concurrentRequests; i++) {
    const dto = {
      idempotencyKey: `idemp-test-${Date.now()}-${i}`, paymentMode: PaymentMode.UPI,
      amountPaid: 118 * quantityPerRequest, items: [{ productId: product.id, quantity: quantityPerRequest }]
    };
    promises.push(billingService.createInvoice(dto as any, '127.0.0.1').then(() => 'SUCCESS').catch(e => `FAIL: ${e.message}`));
  }
  const results = await Promise.all(promises);
  const failures = results.filter(r => r.startsWith('FAIL'));
  console.log(`Successes: ${results.filter(r => r === 'SUCCESS').length}, Failures: ${failures.length}`);
  if (failures.length > 0) console.log(failures);
  const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
  console.log(`Final Product.currentStock: ${finalProduct?.currentStock}, Final InventoryItem.onHand: ${finalInvItem?.onHand}`);
  await verifyLedger(invItem.id, initialStock);
}

async function runReturnsTest(concurrentRequests: number, quantityPerRequest: number, initialStock: number) {
  console.log(`\n--- RUNNING TEST: ${concurrentRequests} concurrent returns of ${quantityPerRequest} unit(s) against stock ${initialStock} ---`);
  const { billingService, product, invItem } = await prepareTest(initialStock);
  
  const invoices = [];
  for (let i = 0; i < concurrentRequests; i++) {
    const dto = {
      idempotencyKey: `setup-inv-${Date.now()}-${i}`, paymentMode: PaymentMode.UPI,
      amountPaid: 118 * quantityPerRequest, 
      items: [{ productId: product.id, quantity: quantityPerRequest }]
    };
    invoices.push(await billingService.createInvoice(dto as any, '127.0.0.1'));
  }

  const promises = [];
  for (let i = 0; i < concurrentRequests; i++) {
    const returnDto = { invoiceId: invoices[i].id, reason: 'Defective' };
    promises.push(billingService.processReturn(returnDto as any, '127.0.0.1').then(() => 'SUCCESS').catch(e => `FAIL: ${e.message}`));
  }
  
  const results = await Promise.all(promises);
  const failures = results.filter(r => r.startsWith('FAIL'));
  console.log(`Successes: ${results.filter(r => r === 'SUCCESS').length}, Failures: ${failures.length}`);
  if (failures.length > 0) console.log(failures);
  await verifyLedger(invItem.id, initialStock);
}

async function runMixedTest(sales: number, returns: number, initialStock: number) {
  console.log(`\n--- RUNNING MIXED TEST: ${sales} sales, ${returns} returns against stock ${initialStock} ---`);
  const { billingService, product, invItem } = await prepareTest(initialStock);
  
  const invoices = [];
  for (let i = 0; i < returns; i++) {
    const dto = {
      idempotencyKey: `setup-inv-${Date.now()}-${i}`, paymentMode: PaymentMode.UPI,
      amountPaid: 118 * 1, items: [{ productId: product.id, quantity: 1 }]
    };
    invoices.push(await billingService.createInvoice(dto as any, '127.0.0.1'));
  }

  const promises = [];
  for (let i = 0; i < sales; i++) {
    const saleDto = {
      idempotencyKey: `mixed-sale-${Date.now()}-${i}`, paymentMode: PaymentMode.UPI,
      amountPaid: 118, items: [{ productId: product.id, quantity: 1 }]
    };
    promises.push(billingService.createInvoice(saleDto as any, '127.0.0.1').then(() => 'SALE_SUCCESS').catch(e => `SALE_FAIL: ${e.message}`));
  }
  for (let i = 0; i < returns; i++) {
    const returnDto = { invoiceId: invoices[i].id, reason: 'Defective' };
    promises.push(billingService.processReturn(returnDto as any, '127.0.0.1').then(() => 'RETURN_SUCCESS').catch(e => `RETURN_FAIL: ${e.message}`));
  }
  
  const results = await Promise.all(promises);
  const saleFails = results.filter(r => r.startsWith('SALE_FAIL'));
  const returnFails = results.filter(r => r.startsWith('RETURN_FAIL'));
  console.log(`Sales Successes: ${results.filter(r => r === 'SALE_SUCCESS').length}, Return Successes: ${results.filter(r => r === 'RETURN_SUCCESS').length}`);
  if (saleFails.length > 0) console.log('Sale Fails:', saleFails);
  if (returnFails.length > 0) console.log('Return Fails:', returnFails);
  await verifyLedger(invItem.id, initialStock);
}

async function main() {
  await runSalesTest(2, 1, 10);
  await runSalesTest(10, 1, 10);
  await runSalesTest(20, 1, 10);
  await runReturnsTest(5, 1, 10);
  await runMixedTest(5, 5, 20);
}

main().catch(console.error).finally(() => prisma.$disconnect());
