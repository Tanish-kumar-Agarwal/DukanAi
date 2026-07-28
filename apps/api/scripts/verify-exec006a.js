const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const axios = require('axios');

async function run() {
  try {
    const shop = await prisma.shop.findFirst();
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER', shopId: shop.id } });
    const customer = await prisma.customer.findFirst({ where: { shopId: shop.id } });
    
    // 1. Give customer 100 outstanding balance so we can test udhar return
    await prisma.customer.update({
      where: { id: customer.id },
      data: { outstandingBalance: 100 }
    });

    // Find a product
    const product = await prisma.product.findFirst({ where: { shopId: shop.id, isDeleted: false, isActive: true } });
    
    // Give product 10 stock
    await prisma.product.update({
      where: { id: product.id },
      data: { currentStock: 10 }
    });

    // Make an invoice directly via service or API? Let's use the API
    console.log('Sending Invoice Creation Request...');
    
    const invoicePayload = {
      items: [
        {
          productId: product.id,
          quantity: 2
        }
      ],
      paymentMode: 'UDHAR',
      customerId: customer.id,
      udharAmount: Number(product.sellingPrice) * 2,
      shiftId: null,
      idempotencyKey: crypto.randomUUID()
    };
    
    // Fake the auth by disabling it (AUTH_DISABLED=true)
    const baseUrl = 'http://localhost:3001/api/billing';
    
    const res = await axios.post(`${baseUrl}/invoice`, invoicePayload);
    const invoiceId = res.data.id;
    console.log('Invoice created:', invoiceId);

    // Verify stock deduction
    const pAfterSale = await prisma.product.findUnique({ where: { id: product.id } });
    console.log('Stock after sale (expected 8):', Number(pAfterSale.currentStock));
    
    const cAfterSale = await prisma.customer.findUnique({ where: { id: customer.id } });
    console.log('Customer balance after sale (expected 100 + amount):', Number(cAfterSale.outstandingBalance));

    // Execute Return
    console.log('\nExecuting Return Request...');
    const returnPayload = {
      invoiceId: invoiceId,
      reason: 'CUSTOMER_REQUEST',
      notes: 'Test Return'
    };
    const retRes = await axios.post(`${baseUrl}/returns`, returnPayload);
    console.log('Return created:', retRes.data.id);

    // Verify Stock restored
    const pAfterReturn = await prisma.product.findUnique({ where: { id: product.id } });
    console.log('Stock after return (expected 10):', Number(pAfterReturn.currentStock));

    // Verify Customer balance restored
    const cAfterReturn = await prisma.customer.findUnique({ where: { id: customer.id } });
    console.log('Customer balance after return (expected 100):', Number(cAfterReturn.outstandingBalance));

    // Verify Idempotency
    try {
      console.log('\nTesting Idempotency...');
      await axios.post(`${baseUrl}/returns`, returnPayload);
      console.log('FAILED: Allowed duplicate return!');
    } catch (err) {
      console.log('SUCCESS: Duplicate return rejected with status', err.response?.status);
    }

    // Verify DB constraints (Invoice Type and originalId)
    const returnInvoice = await prisma.invoice.findUnique({ where: { id: retRes.data.id } });
    console.log('\nReturn Invoice Type:', returnInvoice.type);
    console.log('Return Invoice originalId:', returnInvoice.originalId);

    // Verify InventoryLog
    const logs = await prisma.inventoryLog.findMany({ where: { invoiceId: returnInvoice.id } });
    console.log('Inventory logs created:', logs.length);
    if (logs.length > 0) {
      console.log('Log Type:', logs[0].type);
      console.log('Log Qty Change:', Number(logs[0].quantityChange));
    }

    // Verify AuditLog
    const audits = await prisma.auditLog.findMany({ where: { entityId: returnInvoice.id, action: 'RETURN_CREATED' } });
    console.log('Audit logs created:', audits.length);
    
    console.log('\nAll tests completed.');
  } catch (err) {
    console.error('Error during test:', err.response ? err.response.data : err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
