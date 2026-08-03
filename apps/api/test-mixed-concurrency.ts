import { PrismaClient } from '@prisma/client';
import { InventoryMutationEngine, MutationType } from './src/inventory-domain/services/inventory-mutation.engine';

const prisma = new PrismaClient({ log: ['warn', 'error'] });
const engine = new InventoryMutationEngine();

async function prepareDirectTest(initialStock: number) {
  const shop = await prisma.shop.findFirst();
  if (!shop) throw new Error('No shop found in DB for test!');
  const shopId = shop.id;

  const user = await prisma.user.findFirst();
  if (!user) throw new Error('No user found in DB for test!');
  const userId = user.id;

  const category = await prisma.category.findFirst({ where: { shopId } });
  let categoryId = category ? category.id : 'cat-test';
  if (!category) {
    const newCat = await prisma.category.create({
      data: {
        shopId,
        name: 'Test Category',
        isActive: true
      }
    });
    categoryId = newCat.id;
  }

  const product = await prisma.product.create({
    data: {
      shopId,
      name: `Mixed Concurrency Test ${Date.now()}`,
      sku: `SKU-MIX-${Date.now()}`,
      categoryId: categoryId,
      type: 'SIMPLE',
      costPrice: 100,
      sellingPrice: 150,
      mrp: 200,
      wholesalePrice: 120,
      unit: 'PCS',
      currentStock: initialStock,
      stockVersion: 1
    }
  });

  const invItem = await prisma.inventoryItem.create({
    data: {
      shopId,
      productId: product.id,
      locationId: 'DEFAULT',
      onHand: initialStock,
      version: 1
    }
  });

  return { shopId, userId, product, invItem };
}

async function verifyLedger(inventoryItemId: string, expectedInitial: number) {
  const entries = await prisma.stockLedgerEntry.findMany({
    where: { inventoryItemId },
    orderBy: { createdAt: 'asc' }
  });

  let runningBalance = expectedInitial;
  let mismatches = 0;

  console.log(`\nVerifying Ledger sequence (Total ${entries.length} entries)...`);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    runningBalance += entry.quantity.toNumber();
    if (entry.balanceAfter.toNumber() !== runningBalance) {
      console.log(`❌ Mismatch at index ${i}: expected balanceAfter=${runningBalance}, but db recorded=${entry.balanceAfter.toNumber()} (qty change: ${entry.quantity.toNumber()})`);
      mismatches++;
    }
  }

  if (mismatches === 0) {
    console.log(`✅ Ledger mathematically perfect. No mismatches.`);
  } else {
    console.log(`❌ Ledger corrupted: ${mismatches} mismatches found!`);
  }
}

async function runMixedEngineTest(concurrentUsers: number, initialStock: number) {
  console.log(`\n--- RUNNING MIXED CONCURRENCY TEST: ${concurrentUsers} total requests against stock ${initialStock} ---`);
  const { shopId, userId, product, invItem } = await prepareDirectTest(initialStock);

  let successes = 0;
  let failures = 0;
  let retriesCount = 0;

  const operations = [MutationType.SALE, MutationType.RETURN, MutationType.ADJUSTMENT, MutationType.PURCHASE];

  const tasks = Array.from({ length: concurrentUsers }).map(async (_, i) => {
    let attempts = 0;
    const opType = operations[i % operations.length];
    const quantity = opType === MutationType.SALE ? 1 : (opType === MutationType.RETURN ? 1 : (opType === MutationType.PURCHASE ? 2 : -1)); // Adjustment decreases by 1
    
    while (attempts < 5) {
      attempts++;
      try {
        const p = await prisma.product.findUnique({ where: { id: product.id } });
        const iItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
        if (!p || !iItem) throw new Error('Missing data');

        await prisma.$transaction(async (tx: any) => {
          await engine.mutateStock(tx, {
            shopId: product.shopId,
            locationId: 'DEFAULT',
            productId: product.id,
            quantity,
            mutationType: opType,
            referenceId: `REF-MIX-${concurrentUsers}-${i}-${attempts}`,
            performedBy: userId,
            idempotencyKey: `IDEM-MIX-${concurrentUsers}-${i}-${attempts}`,
            occ: {
              expectedProductVersion: p.stockVersion,
              expectedInventoryItemVersion: iItem.version
            }
          });
        });
        successes++;
        if (attempts > 1) {
          console.log(`[Request ${i} - ${opType}] Succeeded after ${attempts - 1} retries.`);
        }
        return; // Success
      } catch (err: any) {
        if (err.message.includes('lock conflict') || err.message.includes('version conflict') || err.message.includes('Deadlock')) {
          retriesCount++;
          // retry
        } else {
          failures++;
          return;
        }
      }
    }
    failures++; // Exhausted retries
  });

  await Promise.all(tasks);

  const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });

  console.log(`Successes: ${successes}, Failures: ${failures}, OCC Retries: ${retriesCount}`);
  console.log(`Final InventoryItem.onHand: ${finalInvItem?.onHand} | Product.currentStock: ${finalProduct?.currentStock}`);
  await verifyLedger(invItem.id, initialStock);
}

async function main() {
  await runMixedEngineTest(100, 200);
}

main().catch(console.error).finally(() => prisma.$disconnect());
