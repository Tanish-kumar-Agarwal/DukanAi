import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function prepareDirectTest(initialStock: number) {
  const shopId = `shop-test-${Date.now()}`;
  const userId = `user-test-${Date.now()}`;
  
  await prisma.shop.create({ data: { id: shopId, name: 'Test Shop', status: 'ACTIVE' } });
  await prisma.user.create({ data: { id: userId, shopId, email: `test-${Date.now()}@test.com`, name: 'Test User', role: 'CASHIER' } });

  const product = await prisma.product.create({
    data: {
      shopId, name: 'Test Product', sku: `TEST-${Date.now()}`,
      currentStock: initialStock, sellingPrice: 100, costPrice: 50, mrp: 120,
      wholesalePrice: 90, gstRate: 'EIGHTEEN', type: 'SIMPLE',
      stockVersion: 1, unit: 'PCS'
    }
  });

  const invItem = await prisma.inventoryItem.create({
    data: { shopId, productId: product.id, locationId: 'DEFAULT', onHand: initialStock, status: 'AVAILABLE' }
  });

  return { shopId, userId, product, invItem };
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

async function runDirectSaleTest(concurrentRequests: number, initialStock: number) {
  console.log(`\n--- RUNNING DIRECT TEST: ${concurrentRequests} concurrent sales against stock ${initialStock} ---`);
  const { shopId, userId, product, invItem } = await prepareDirectTest(initialStock);

  const promises = [];
  for (let i = 0; i < concurrentRequests; i++) {
    promises.push(prisma.$transaction(async (tx) => {
      let currentInvItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: product.id, locationId: 'DEFAULT' }
      });
      let balanceAfter: any;
      if (currentInvItem) {
        currentInvItem = await tx.inventoryItem.update({
          where: { id: currentInvItem.id },
          data: { onHand: { decrement: 1 } }
        });
        balanceAfter = currentInvItem.onHand;
      }
      
      await tx.stockLedgerEntry.create({
        data: {
          shopId,
          inventoryItemId: currentInvItem!.id,
          movementType: 'SALE',
          quantity: -1,
          unitCost: product.costPrice,
          referenceType: 'INVOICE',
          referenceId: `dummy-inv-${i}`,
          balanceAfter: balanceAfter,
          createdBy: userId
        }
      });
      return 'SUCCESS';
    }).catch(e => `FAIL: ${e.message}`));
  }
  const results = await Promise.all(promises);
  const successes = results.filter(r => r === 'SUCCESS').length;
  const failures = results.filter(r => r !== 'SUCCESS');
  console.log(`Successes: ${successes}, Failures: ${failures.length}`);
  if (failures.length > 0) console.log(failures);

  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
  console.log(`Final InventoryItem.onHand: ${finalInvItem?.onHand}`);
  await verifyLedger(invItem.id, initialStock);
}

async function runDirectReturnTest(concurrentRequests: number, initialStock: number) {
  console.log(`\n--- RUNNING DIRECT TEST: ${concurrentRequests} concurrent returns against stock ${initialStock} ---`);
  const { shopId, userId, product, invItem } = await prepareDirectTest(initialStock);

  const promises = [];
  for (let i = 0; i < concurrentRequests; i++) {
    promises.push(prisma.$transaction(async (tx) => {
      let currentInvItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: product.id, locationId: 'DEFAULT' }
      });
      let balanceAfter: any;
      if (currentInvItem) {
        currentInvItem = await tx.inventoryItem.update({
          where: { id: currentInvItem.id },
          data: { onHand: { increment: 1 } }
        });
        balanceAfter = currentInvItem.onHand;
      }
      
      await tx.stockLedgerEntry.create({
        data: {
          shopId,
          inventoryItemId: currentInvItem!.id,
          movementType: 'SALE_RETURN',
          quantity: 1,
          unitCost: product.costPrice,
          referenceType: 'INVOICE_RETURN',
          referenceId: `dummy-ret-${i}`,
          balanceAfter: balanceAfter,
          createdBy: userId
        }
      });
      return 'SUCCESS';
    }).catch(e => `FAIL: ${e.message}`));
  }
  const results = await Promise.all(promises);
  const successes = results.filter(r => r === 'SUCCESS').length;
  const failures = results.filter(r => r !== 'SUCCESS');
  console.log(`Successes: ${successes}, Failures: ${failures.length}`);
  if (failures.length > 0) console.log(failures);

  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
  console.log(`Final InventoryItem.onHand: ${finalInvItem?.onHand}`);
  await verifyLedger(invItem.id, initialStock);
}

async function runDirectMixedTest(sales: number, returns: number, initialStock: number) {
  console.log(`\n--- RUNNING DIRECT MIXED TEST: ${sales} sales, ${returns} returns against stock ${initialStock} ---`);
  const { shopId, userId, product, invItem } = await prepareDirectTest(initialStock);

  const promises = [];
  for (let i = 0; i < sales; i++) {
    promises.push(prisma.$transaction(async (tx) => {
      let currentInvItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: product.id, locationId: 'DEFAULT' }
      });
      let balanceAfter: any;
      if (currentInvItem) {
        currentInvItem = await tx.inventoryItem.update({
          where: { id: currentInvItem.id },
          data: { onHand: { decrement: 1 } }
        });
        balanceAfter = currentInvItem.onHand;
      }
      
      await tx.stockLedgerEntry.create({
        data: { shopId, inventoryItemId: currentInvItem!.id, movementType: 'SALE', quantity: -1, unitCost: product.costPrice, referenceType: 'INVOICE', referenceId: `dummy-inv-${i}`, balanceAfter: balanceAfter, createdBy: userId }
      });
      return 'SALE_SUCCESS';
    }).catch(e => `SALE_FAIL: ${e.message}`));
  }

  for (let i = 0; i < returns; i++) {
    promises.push(prisma.$transaction(async (tx) => {
      let currentInvItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: product.id, locationId: 'DEFAULT' }
      });
      let balanceAfter: any;
      if (currentInvItem) {
        currentInvItem = await tx.inventoryItem.update({
          where: { id: currentInvItem.id },
          data: { onHand: { increment: 1 } }
        });
        balanceAfter = currentInvItem.onHand;
      }
      
      await tx.stockLedgerEntry.create({
        data: { shopId, inventoryItemId: currentInvItem!.id, movementType: 'SALE_RETURN', quantity: 1, unitCost: product.costPrice, referenceType: 'INVOICE_RETURN', referenceId: `dummy-ret-${i}`, balanceAfter: balanceAfter, createdBy: userId }
      });
      return 'RETURN_SUCCESS';
    }).catch(e => `RETURN_FAIL: ${e.message}`));
  }
  const results = await Promise.all(promises);
  console.log(`Sale Successes: ${results.filter(r => r === 'SALE_SUCCESS').length}`);
  console.log(`Return Successes: ${results.filter(r => r === 'RETURN_SUCCESS').length}`);

  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
  console.log(`Final InventoryItem.onHand: ${finalInvItem?.onHand}`);
  await verifyLedger(invItem.id, initialStock);
}

async function runDirectFailureTest(failAfter: 'update' | 'ledger') {
  console.log(`\n--- RUNNING DIRECT FAILURE TEST: Fail after ${failAfter} ---`);
  const { shopId, userId, product, invItem } = await prepareDirectTest(10);

  try {
    await prisma.$transaction(async (tx) => {
      let currentInvItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: product.id, locationId: 'DEFAULT' }
      });
      
      currentInvItem = await tx.inventoryItem.update({
        where: { id: currentInvItem!.id },
        data: { onHand: { decrement: 1 } }
      });
      
      if (failAfter === 'update') throw new Error('Forced failure after update');

      await tx.stockLedgerEntry.create({
        data: { shopId, inventoryItemId: currentInvItem.id, movementType: 'SALE', quantity: -1, unitCost: product.costPrice, referenceType: 'INVOICE', referenceId: `dummy-inv`, balanceAfter: currentInvItem.onHand, createdBy: userId }
      });

      if (failAfter === 'ledger') throw new Error('Forced failure after ledger');
    });
  } catch (e: any) {
    console.log(`Transaction threw: ${e.message}`);
  }

  const finalInvItem = await prisma.inventoryItem.findFirst({ where: { productId: product.id } });
  const entries = await prisma.stockLedgerEntry.count({ where: { inventoryItemId: invItem.id } });
  console.log(`Rollback Check: onHand=${finalInvItem?.onHand} (Expected 10), ledgerEntries=${entries} (Expected 0)`);
}

async function main() {
  await runDirectSaleTest(2, 10);
  await runDirectSaleTest(10, 10);
  await runDirectSaleTest(20, 10);
  await runDirectSaleTest(50, 100);
  
  await runDirectReturnTest(5, 5);
  await runDirectReturnTest(20, 5);
  
  await runDirectMixedTest(20, 20, 50);
  
  await runDirectFailureTest('update');
  await runDirectFailureTest('ledger');
}

main().catch(console.error).finally(() => prisma.$disconnect());
