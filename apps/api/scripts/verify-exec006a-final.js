const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const crypto = require('crypto');
const prisma = new PrismaClient();
const API_URL = 'http://localhost:3001/api';
const headers = { 'x-tenant-id': 'system-job' };

async function run() {
  console.log("=== STARTING EXEC-006A FINAL CERTIFICATION ===\n");
  try {
    const shop = await prisma.shop.findFirst();
    const customer = await prisma.customer.findFirst({ where: { shopId: shop.id } });
    const product = await prisma.product.findFirst({ where: { shopId: shop.id } });
    const shift = await prisma.shift.findFirst({ where: { shopId: shop.id, status: 'OPEN' } });

    console.log(`Shop: ${shop.id}`);
    console.log(`Customer: ${customer.id}`);
    console.log(`Product: ${product.id}`);
    if (shift) console.log(`Shift: ${shift.id}`);

    // Snapshot
    const beforeStats = await getStats(shop.id, customer.id, product.id, shift?.id);
    console.log("BEFORE SNAPSHOT:", beforeStats);

    // Phase 11: Regression (Sale works)
    console.log("\n[Phase 11] Executing Standard Sale (UDHAR)...");
    const saleRes = await axios.post(`${API_URL}/billing/invoice`, {
      items: [{ productId: product.id, quantity: 1 }],
      paymentMode: 'UDHAR',
      customerId: customer.id,
      shiftId: shift?.id,
      idempotencyKey: crypto.randomUUID()
    }, { headers });
    const saleInvoice = saleRes.data;
    console.log(`Sale Invoice Created: ${saleInvoice.id}`);

    // Wait for outbox/ledger processing
    await new Promise(r => setTimeout(r, 2000));

    const afterSaleStats = await getStats(shop.id, customer.id, product.id, shift?.id);
    console.log("AFTER SALE SNAPSHOT:", afterSaleStats);

    // Phase 6: Concurrency
    console.log("\n[Phase 6] Bombarding with 20 concurrent Return requests...");
    const returnPromises = [];
    for (let i = 0; i < 20; i++) {
      returnPromises.push(
        axios.post(`${API_URL}/billing/returns`, {
          invoiceId: saleInvoice.id,
          reason: 'CUSTOMER_REQUEST',
          notes: `Concurrency Test ${i}`
        }, { headers }).catch(e => e.response?.status)
      );
    }
    const results = await Promise.all(returnPromises);
    const successes = results.filter(r => r?.data?.id);
    const conflicts = results.filter(r => r === 409);
    console.log(`Successes: ${successes.length}, Conflicts (409): ${conflicts.length}`);
    
    if (successes.length !== 1) throw new Error("Concurrency failed! Multiple successes.");

    const returnInvoice = successes[0].data;
    console.log(`Return Invoice Created: ${returnInvoice.id}`);

    // Wait for outbox/ledger processing
    await new Promise(r => setTimeout(r, 2000));

    // Phase 3 & 4: Database Snapshot & Mathematical Certification
    const finalStats = await getStats(shop.id, customer.id, product.id, shift?.id);
    console.log("\n[Phase 3/4] FINAL SNAPSHOT (Should match BEFORE SNAPSHOT exactly for Stock/Ledger/Shift):");
    console.log(finalStats);

    console.log("\nMathematical Validation:");
    console.log(`Stock Drift: ${finalStats.stock - beforeStats.stock} (Expected 0)`);
    console.log(`Customer Balance Drift: ${finalStats.customerBalance - beforeStats.customerBalance} (Expected 0)`);
    console.log(`AR Balance Drift: ${finalStats.arBalance - beforeStats.arBalance} (Expected 0)`);
    console.log(`Revenue Balance Drift: ${finalStats.revBalance - beforeStats.revBalance} (Expected 0)`);
    if (shift) {
        console.log(`Shift Total Drift: ${finalStats.shiftTotal - beforeStats.shiftTotal} (Expected 0)`);
        console.log(`Shift Udhar Drift: ${finalStats.shiftUdhar - beforeStats.shiftUdhar} (Expected 0)`);
    }

    // Phase 5: Idempotency
    console.log("\n[Phase 5] Attempting identical return again...");
    try {
      await axios.post(`${API_URL}/billing/returns`, {
        invoiceId: saleInvoice.id,
        reason: 'CUSTOMER_REQUEST'
      }, { headers });
      console.log("FAIL: Second return succeeded!");
    } catch (err) {
      if (err.response?.status === 409) {
        console.log("SUCCESS: Idempotency confirmed (409 Conflict).");
      } else {
        console.log("UNEXPECTED STATUS:", err.response?.status);
      }
    }

    console.log("\n=== CERTIFICATION COMPLETE ===");
  } catch (err) {
    console.error("CERTIFICATION FAILED:", err.response?.data || err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function getStats(shopId, customerId, productId, shiftId) {
  const p = await prisma.product.findUnique({ where: { id: productId } });
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  
  const arLedger = await prisma.ledgerTransaction.findFirst({
    where: { shopId, account: 'ACCOUNTS_RECEIVABLE' },
    orderBy: { createdAt: 'desc' }
  });
  const revLedger = await prisma.ledgerTransaction.findFirst({
    where: { shopId, account: 'SALES_REVENUE' },
    orderBy: { createdAt: 'desc' }
  });
  
  const shift = shiftId ? await prisma.shift.findUnique({ where: { id: shiftId } }) : null;

  return {
    stock: p.currentStock.toNumber(),
    customerBalance: c.outstandingBalance.toNumber(),
    arBalance: arLedger ? arLedger.balanceAfter.toNumber() : 0,
    revBalance: revLedger ? revLedger.balanceAfter.toNumber() : 0,
    shiftTotal: shift ? shift.totalSales.toNumber() : 0,
    shiftUdhar: shift ? shift.udharSales.toNumber() : 0
  };
}

run();
