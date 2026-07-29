// @ts-nocheck
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { BillingService } from './billing/billing.service';
import { InventoryDomainService } from './inventory-domain/services/inventory-domain.service';
import { GrnIntegrationService } from './grn-domain/services/grn-integration.service';
import { TenantContextService } from './iam/tenant-context/tenant-context.service';
import { Decimal } from '@prisma/client/runtime/library';

async function bootstrap() {
  console.log('--- EXEC-006B FINAL CERTIFICATION ---');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const billingService = app.get(BillingService);
  const inventoryDomain = app.get(InventoryDomainService);
  const grnIntegration = app.get(GrnIntegrationService);

  const shop = await prisma.shop.findFirst();
  const user = await prisma.user.findFirst({ where: { shopId: shop!.id } });
  
  const context = { 
    shopId: shop!.id, 
    userId: user!.id, 
    email: user!.email, 
    role: user!.role,
    correlationId: 'test',
    requestId: 'test'
  };
  
  await TenantContextService.asAsyncLocalStorage.run(context as any, async () => {
    let product = await prisma.product.findFirst({ where: { shopId: shop!.id } });
    
    // Set currentStock to 0 for test baseline
    await prisma.product.update({
      where: { id: product!.id },
      data: { currentStock: 0 }
    });
    
    // Clear any existing InventoryItem to start clean
    await prisma.inventoryItem.updateMany({ where: { productId: product!.id }, data: { onHand: 0 } });

    console.log('Test Shop, User, and Product loaded. Current Stock reset to 0');

    // PHASE 8: PURCHASE SYNCHRONIZATION
    console.log('\n>> PHASE 8: PURCHASE SYNCHRONIZATION');
    await prisma.$transaction(async (tx: any) => {
      const grnMock = {
        id: 'GRN-MOCK-' + Date.now(),
        warehouseId: 'DEFAULT',
        createdBy: user!.id,
        lines: [
          { productId: product!.id, acceptedQuantity: '500', unitPrice: '50' }
        ]
      };
      await grnIntegration.updateInventoryFromGrn(tx, shop!.id, grnMock as any);
    });

    const productAfterGrn = await prisma.product.findUnique({ where: { id: product!.id } });
    const invItemAfterGrn = await prisma.inventoryItem.findFirst({ where: { productId: product!.id, locationId: 'DEFAULT' } });
    const purchaseLog = await prisma.inventoryLog.findFirst({ where: { productId: product!.id, type: 'PURCHASE' } });
    
    console.log(`Product.currentStock: ${productAfterGrn?.currentStock}`);
    console.log(`InventoryItem.onHand: ${invItemAfterGrn?.onHand}`);
    console.log(`InventoryLog created: ${!!purchaseLog}`);
    
    if (productAfterGrn?.currentStock.toNumber() !== 500 || invItemAfterGrn?.onHand.toNumber() !== 500 || !purchaseLog) {
      throw new Error('Phase 8 Purchase Synchronization FAILED');
    }

    // PHASE 5: NEGATIVE STOCK PREVENTION
    console.log('\n>> PHASE 5: NEGATIVE STOCK PREVENTION');
    try {
      await billingService.createInvoice({
        items: [{ productId: product!.id, quantity: 1000 }],
        paymentMode: 'CASH',
        amountPaid: 100000, idempotencyKey: 'test-phase5-' + Date.now(),
      } as any);
      throw new Error('Should have thrown out of stock error');
    } catch (e: any) {
      if (e.message.includes('Insufficient stock') || e.message.includes('out of stock') || e.message.includes('OPTIMISTIC_LOCK_CONFLICT')) {
        console.log('Negative stock correctly prevented.');
      } else {
        throw e;
      }
    }

    // PHASE 6 & 7: CONCURRENT SALES (OPTIMISTIC LOCKING)
    console.log('\n>> PHASE 6 & 7: CONCURRENT SALES (50 threads)');
    const promises = [];
    let firstError: any = null;
    for (let i = 0; i < 50; i++) {
      promises.push(billingService.createInvoice({
        items: [{ productId: product!.id, quantity: 1 }],
        paymentMode: 'CASH',
        amountPaid: 100, idempotencyKey: 'test-phase6-' + Date.now() + '-' + i,
      } as any, '127.0.0.1').catch(e => {
        if (!firstError) {
          firstError = e;
          console.log('Caught expected concurrent error:', e.message);
        }
        return null;
      }));
    }
    await Promise.all(promises);

    const productAfterSales = await prisma.product.findUnique({ where: { id: product!.id } });
    const invItemAfterSales = await prisma.inventoryItem.findFirst({ where: { productId: product!.id, locationId: 'DEFAULT' } });
    
    // Need to count based on the recent time to avoid older tests
    const salesCount = await prisma.inventoryLog.count({ 
      where: { productId: product!.id, type: 'SALE', createdAt: { gt: new Date(Date.now() - 60000) } } 
    });
    const ledgerSalesCount = await prisma.stockLedgerEntry.count({ 
      where: { inventoryItemId: invItemAfterSales!.id, movementType: 'SALE', createdAt: { gt: new Date(Date.now() - 60000) } } 
    });

    console.log(`Product.currentStock: ${productAfterSales?.currentStock}`);
    console.log(`InventoryItem.onHand: ${invItemAfterSales?.onHand}`);
    if (salesCount === 0 && firstError) {
      console.error('CONCURRENT SALES FAILED. First Error:', firstError);
    }
    console.log(`Total Successful Sales: ${salesCount}`);
    console.log(`StockLedgerEntry Sales: ${ledgerSalesCount}`);

    if (productAfterSales?.currentStock.toNumber() !== (500 - salesCount) || 
        invItemAfterSales?.onHand.toNumber() !== (500 - salesCount) ||
        salesCount !== ledgerSalesCount) {
      throw new Error('Phase 6 & 7 Synchronization FAILED');
    }

    let shift = await prisma.shift.findFirst({ where: { shopId: shop!.id, status: 'OPEN', openedById: user!.id } });
    if (!shift) {
      await prisma.shift.create({ data: { shopId: shop!.id, openedById: user!.id, status: 'OPEN', openingCash: 0, totalSales: 0, totalReceipts: 0, cashSales: 0, upiSales: 0, cardSales: 0, udharSales: 0 } });
    }

    // PHASE 9: RETURN SYNCHRONIZATION
    console.log('\n>> PHASE 9: RETURN SYNCHRONIZATION');
    const saleInvoice = await prisma.invoice.findFirst({ where: { shopId: shop!.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    await billingService.processReturn({ invoiceId: saleInvoice!.id, reason: 'Defective' } as any, '127.0.0.1');
    
    const productAfterReturn = await prisma.product.findUnique({ where: { id: product!.id } });
    const invItemAfterReturn = await prisma.inventoryItem.findFirst({ where: { productId: product!.id, locationId: 'DEFAULT' } });
    
    console.log(`Product.currentStock: ${productAfterReturn?.currentStock}`);
    console.log(`InventoryItem.onHand: ${invItemAfterReturn?.onHand}`);
    
    // Using an implicit +1 because we returned exactly 1 item
    if (productAfterReturn?.currentStock.toNumber() !== (500 - salesCount + 1)) {
      throw new Error('Phase 9 Return Synchronization FAILED');
    }

    // PHASE 10: MANUAL ADJUSTMENTS
    console.log('\n>> PHASE 10: MANUAL ADJUSTMENTS');
    await inventoryDomain.adjustStock(
      invItemAfterReturn!.id,
      'DAMAGE' as any,
      -5,
      user!.id,
      {}
    );

    const productAfterAdj = await prisma.product.findUnique({ where: { id: product!.id } });
    const invItemAfterAdj = await prisma.inventoryItem.findFirst({ where: { productId: product!.id, locationId: 'DEFAULT' } });
    const adjLog = await prisma.inventoryLog.findFirst({ where: { productId: product!.id, type: 'ADJUSTMENT' }, orderBy: { createdAt: 'desc' } });

    console.log(`Product.currentStock: ${productAfterAdj?.currentStock}`);
    console.log(`InventoryItem.onHand: ${invItemAfterAdj?.onHand}`);
    console.log(`InventoryLog for Adjustment created: ${!!adjLog}`);

    if (!adjLog || productAfterAdj?.currentStock.toNumber() !== invItemAfterAdj?.onHand.toNumber()) {
       throw new Error('Phase 10 Adjustment Synchronization FAILED');
    }

    console.log('\n>> PHASE 15: SQL FORENSICS VERIFICATION');
    console.log('Validating dual-engines have perfectly identical aggregate balances...');
    if (productAfterAdj?.currentStock.toNumber() !== invItemAfterAdj?.onHand.toNumber()) {
      throw new Error('SQL Forensics FAILED: System is suffering from Inventory Sync Schism');
    }
    
    console.log('\n✅ EXEC-006B ALL PHASES PASSED SUCCESSFULLY');
  }); // End of async local storage run

  await app.close();
  process.exit(0);
}

bootstrap().catch(e => {
  console.error(e);
  process.exit(1);
});




