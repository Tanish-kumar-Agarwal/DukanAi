import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { InventoryMutationEngine, MutationType } from './src/inventory-domain/services/inventory-mutation.engine';
import { v4 as uuidv4 } from 'uuid';

async function bootstrap() {
  const prisma = new PrismaClient();
  const engine = new InventoryMutationEngine();

  console.log('--- FAILURE MATRIX & ROLLBACK TESTS ---');
  
  const shop = await prisma.shop.findFirst();
  if (!shop) {
    console.log('No shop found. Skipping tests.');
    process.exit(0);
  }

  const user = await prisma.user.findFirst({ where: { shopId: shop.id }}) || await prisma.user.create({ data: { shopId: shop.id, name: 'Test User', email: 'test@example.com', passwordHash: 'hash', role: 'ADMIN' } });
  const category = await prisma.category.findFirst({ where: { shopId: shop.id }}) || await prisma.category.create({ data: { shopId: shop.id, name: 'Test Cat', status: 'ACTIVE' } });
  
  const product = await prisma.product.create({
    data: {
      shopId: shop.id,
      name: 'Failure Matrix Test Product',
      sku: 'TEST-FAIL-' + Date.now(),
      barcode: 'BF-' + Date.now(),
      type: 'SIMPLE',
      categoryId: category.id,
      unit: 'PCS',
      currentStock: 10,
      stockVersion: 1,
      costPrice: 50,
      sellingPrice: 100,
      wholesalePrice: 100,
      mrp: 100
    }
  });

  const location = await prisma.warehouse.findFirst({ where: { shopId: shop.id }});
  
  await prisma.inventoryItem.create({
    data: {
      shopId: shop.id,
      productId: product.id,
      locationId: location ? location.id : 'DEFAULT',
      onHand: 10
    }
  });

  const printState = async (label: string) => {
    console.log(`\n[STATE SNAPSHOT] ${label}`);
    const p = await prisma.product.findUnique({ where: { id: product.id } });
    const items = await prisma.inventoryItem.findMany({ where: { productId: product.id } });
    const ledgers = await prisma.stockLedgerEntry.findMany({ where: { inventoryItemId: { in: items.map(i => i.id) } } });
    const logs = await prisma.inventoryLog.findMany({ where: { productId: product.id } });
    
    console.log(`Product: { currentStock: ${p?.currentStock}, stockVersion: ${p?.stockVersion} }`);
    items.forEach(i => console.log(`InventoryItem [${i.locationId}]: { onHand: ${i.onHand}, reserved: ${i.reservedStock} }`));
    console.log(`Ledger Rows: ${ledgers.length}`);
    console.log(`InventoryLog Rows: ${logs.length}`);
    
    const sum = items.reduce((acc, curr) => acc + Number(curr.onHand), 0);
    console.log(`INVARIANT CHECK: SUM(InventoryItem.onHand) [${sum}] === Product.currentStock [${p?.currentStock}] -> ${sum === Number(p?.currentStock) ? 'PASS' : 'FAIL'}`);
  };

  await printState('BEFORE ROLLBACK TEST');
  
  try {
    await prisma.$transaction(async (tx: any) => {
      await engine.mutateStock(tx, {
        shopId: shop.id,
        locationId: location ? location.id : 'DEFAULT',
        productId: product.id,
        quantity: 3,
        mutationType: MutationType.SALE,
        referenceId: uuidv4(),
        performedBy: user.id
      });
      
      console.log('\nSimulating CRASH immediately before commit...');
      throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
    });
  } catch (e: any) {
    console.log('Caught expected error:', e.message);
  }

  await printState('AFTER ROLLBACK TEST');

  console.log('\n--- IDEMPOTENCY TEST ---');
  const idempotencyKey = 'IDEM-' + Date.now();
  const refId = uuidv4();
  
  await prisma.$transaction(async (tx: any) => {
    await engine.mutateStock(tx, {
      shopId: shop.id,
      locationId: location ? location.id : 'DEFAULT',
      productId: product.id,
      quantity: 2,
      mutationType: MutationType.SALE,
      referenceId: refId,
      performedBy: user.id,
      idempotencyKey: idempotencyKey
    });
  });
  console.log('\nFirst mutation executed successfully.');
  await printState('AFTER FIRST IDEMPOTENT REQUEST');

  let idempotentResult;
  await prisma.$transaction(async (tx: any) => {
    idempotentResult = await engine.mutateStock(tx, {
      shopId: shop.id,
      locationId: location ? location.id : 'DEFAULT',
      productId: product.id,
      quantity: 2,
      mutationType: MutationType.SALE,
      referenceId: refId,
      performedBy: user.id,
      idempotencyKey: idempotencyKey
    });
  });
  
  console.log('\nSecond mutation executed.');
  await printState('AFTER DUPLICATE IDEMPOTENT REQUEST');
  
  if (idempotentResult.idempotent) {
    console.log('\n✅ IDEMPOTENCY SUCCESSFUL. Duplicate request detected (Result: true).');
  } else {
    console.log('\n❌ IDEMPOTENCY FAILED. Mutated twice.');
    process.exit(1);
  }

  await prisma.$disconnect();
  process.exit(0);
}

bootstrap();
