import { PrismaClient } from '@prisma/client';
import { InventoryMutationEngine, MutationType } from './src/inventory-domain/services/inventory-mutation.engine';

const prisma = new PrismaClient({ log: ['warn', 'error'] });
const engine = new InventoryMutationEngine();

async function prepareMultiWarehouseTest() {
  const shop = await prisma.shop.findFirst();
  if (!shop) throw new Error('No shop found in DB for test!');
  const shopId = shop.id;

  const user = await prisma.user.findFirst();
  if (!user) throw new Error('No user found in DB for test!');
  const userId = user.id;

  const category = await prisma.category.findFirst({ where: { shopId } });
  let categoryId = category ? category.id : 'cat-test';

  const product = await prisma.product.create({
    data: {
      shopId,
      name: `Multi Warehouse Test ${Date.now()}`,
      sku: `SKU-WH-${Date.now()}`,
      categoryId: categoryId,
      type: 'SIMPLE',
      costPrice: 100,
      sellingPrice: 150,
      mrp: 200,
      wholesalePrice: 120,
      unit: 'PCS',
      currentStock: 100, // 40 + 60
      stockVersion: 1
    }
  });

  await prisma.$executeRaw`
    INSERT IGNORE INTO Warehouse (id, shopId, name, code, isPrimary)
    VALUES ('dummy_wh', ${shopId}, 'Dummy WH', 'DWH', false)
  `;

  await prisma.$executeRaw`
    INSERT IGNORE INTO Location (id, shopId, warehouseId, type, code, path, depth)
    VALUES ('WAREHOUSE_A', ${shopId}, 'dummy_wh', 'WAREHOUSE', 'WHA', '/WHA', 1),
           ('WAREHOUSE_B', ${shopId}, 'dummy_wh', 'WAREHOUSE', 'WHB', '/WHB', 1)
  `;

  const invItemA = await prisma.inventoryItem.create({
    data: {
      shopId,
      productId: product.id,
      locationId: 'WAREHOUSE_A',
      onHand: 40,
      version: 1
    }
  });

  const invItemB = await prisma.inventoryItem.create({
    data: {
      shopId,
      productId: product.id,
      locationId: 'WAREHOUSE_B',
      onHand: 60,
      version: 1
    }
  });

  return { shopId, userId, product, invItemA, invItemB };
}

async function runMultiWarehouseTest() {
  console.log(`\n--- RUNNING MULTI-WAREHOUSE AGGREGATION TEST ---`);
  const { shopId, userId, product, invItemA, invItemB } = await prepareMultiWarehouseTest();

  console.log(`[INITIAL] Warehouse A: 40 | Warehouse B: 60 | Product.currentStock: 100`);

  // Sell 10 from Warehouse A
  await prisma.$transaction(async (tx: any) => {
    await engine.mutateStock(tx, {
      shopId,
      locationId: 'WAREHOUSE_A',
      productId: product.id,
      quantity: 10,
      mutationType: MutationType.SALE,
      referenceId: `REF-WHA-1`,
      performedBy: userId,
      idempotencyKey: `IDEM-WHA-1`
    });
  });

  // Purchase 20 into Warehouse B
  await prisma.$transaction(async (tx: any) => {
    await engine.mutateStock(tx, {
      shopId,
      locationId: 'WAREHOUSE_B',
      productId: product.id,
      quantity: 20,
      mutationType: MutationType.PURCHASE,
      referenceId: `REF-WHB-1`,
      performedBy: userId,
      idempotencyKey: `IDEM-WHB-1`
    });
  });

  const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
  const finalInvA = await prisma.inventoryItem.findFirst({ where: { productId: product.id, locationId: 'WAREHOUSE_A' } });
  const finalInvB = await prisma.inventoryItem.findFirst({ where: { productId: product.id, locationId: 'WAREHOUSE_B' } });

  console.log(`[AFTER MUTATIONS] Warehouse A: ${finalInvA?.onHand} | Warehouse B: ${finalInvB?.onHand}`);
  console.log(`[EXPECTED] Product.currentStock: 110 (40 - 10 + 60 + 20)`);
  console.log(`[ACTUAL] Product.currentStock: ${finalProduct?.currentStock}`);
  
  const sum = (finalInvA?.onHand.toNumber() || 0) + (finalInvB?.onHand.toNumber() || 0);
  if (finalProduct?.currentStock.toNumber() === sum) {
    console.log(`✅ MULTI-WAREHOUSE INVARIANT: SUM(onHand) [${sum}] === Product.currentStock [${finalProduct?.currentStock.toNumber()}] -> PASS`);
  } else {
    console.log(`❌ MULTI-WAREHOUSE INVARIANT FAILED: SUM(onHand) [${sum}] !== Product.currentStock [${finalProduct?.currentStock?.toNumber()}]`);
  }
}

async function main() {
  await runMultiWarehouseTest();
}

main().catch(console.error).finally(() => prisma.$disconnect());
