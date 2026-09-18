# POS / Billing API Contract (EXEC-006C)

This document is the single source of truth for the POS workflow surface. The
web app, the API and the shared math package are all built against it.

Conventions

- Base path `/api`. Every route requires a Bearer JWT unless marked public.
- Prisma `Decimal` fields serialize as strings (`"12.50"`); clients coerce with
  `Number()` for display only. Money math never happens in the browser outside
  the shared `@dukaanai/invoice-math` engine.
- Errors use the global envelope
  `{ statusCode, message, error, code?, details?, correlationId, timestamp }`.
  `code` is a stable machine string (see per-route lists). Clients branch on
  `code`, never on `message`.
- Business day and financial year are computed in the shop timezone
  (`ShopSettings.timezone`, default `Asia/Kolkata`). Financial year runs
  April to March.

## 1. Shared math engine (`@dukaanai/invoice-math`)

```ts
InvoiceMathEngine.calculate(input: InvoiceMathInput): InvoiceCalculationResultV1
```

Input

```ts
{
  items: [{ productId, quantity, unitPrice, discountPercent?, gstRateStr?, cessRate?, isInterState }],
  discountAmount?, discountPercentage?, discountType?: 'FIXED_AMOUNT' | 'PERCENTAGE', discountReason?,
  payment?: {
    tenders: [{ type: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER', amount, tenderedAmount?, reference? }],
    udharAmount?
  }
}
```

Result

```ts
{
  schemaVersion, engineVersion, calculationHash,
  lines: [{ productId, quantity, unitPrice, lineSubtotal, discountAmount, taxableAmount,
            cgstAmount, sgstAmount, igstAmount, cessAmount, taxAmount, lineTotal }],
  subtotal, totalDiscount, taxableTotal, totalCgst, totalSgst, totalIgst, totalCess, totalTax,
  grandTotal, roundOff, finalTotal,
  payment: null | { paidAmount, udharAmount, changeAmount,
                    paymentMode: 'CASH' | 'UPI' | 'CARD' | 'UDHAR' | 'SPLIT',
                    tenders: [{ type, amount, tenderedAmount, changeAmount, reference }] }
}
```

Rules

- `payment` omitted: preview mode, `payment` is `null`, no payment validation.
- `payment` present: `sum(tenders.amount) + udharAmount == finalTotal` exactly.
  Only `CASH` may carry `tenderedAmount > amount`; `changeAmount` is the
  difference. Non-cash tenders must have `tenderedAmount == amount` (or omit it).
- `paymentMode` is derived: one tender and no udhar gives that tender's mode
  (`BANK_TRANSFER` maps to `CARD` for the invoice enum), udhar only gives
  `UDHAR`, anything else gives `SPLIT`.
- Errors throw `InvoiceMathError` with `code` in:
  `ERR_NEGATIVE_DISCOUNT`, `ERR_DISCOUNT_EXCEEDS_SUBTOTAL`,
  `ERR_MISSING_DISCOUNT_REASON`, `ERR_DISCOUNT_LIMIT`,
  `ERR_ZERO_SUBTOTAL_DISCOUNT`, `ERR_INVALID_QUANTITY`, `ERR_INVALID_PAYMENT`,
  `ERR_NEGATIVE_PAYMENT`, `ERR_NEGATIVE_UDHAR`, `ERR_PAYMENT_MISMATCH`,
  `ERR_CHANGE_NOT_ALLOWED`, `ERR_UNKNOWN_TENDER`, `ERR_DUPLICATE_LINE`.
- The magic preview value `amountPaid = 99999999` no longer exists.

```ts
InvoiceMathEngine.calculateReturn(input: ReturnMathInput): ReturnCalculationResult
```

Proportional return math for partial returns. Each line carries the original
stored amounts and the quantity being returned; the result has per-line
amounts scaled by `quantity / originalQuantity` (2 dp, half-up) and invoice
totals with a fresh round-off.

## 2. Billing

Roles: `CASHIER`, `MANAGER`, `ADMIN`, `OWNER`, `SUPER_ADMIN` unless noted.

### `POST /billing/calculate`

Body: `{ items: [{ productId, quantity, discountPercent? }], customerId?,
discountAmount?, discountPercentage?, discountType?, discountReason? }`.
The server resolves prices, GST rate and `isInterState` (shop state vs
customer state). Response: the engine result (payment `null`) plus
`{ isInterState, shopState, customerState }`.

### `POST /billing/invoice`

Body

```ts
{
  idempotencyKey: string (uuid v4),
  items: [{ productId, quantity, discountPercent? }],
  customerId?, notes?, shiftId?,
  discountAmount?, discountPercentage?, discountType?, discountReason?,
  payments: [{ tender: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER', amount, tenderedAmount?, reference? }],
  udharAmount?
}
```

Legacy `paymentMode` + `amountPaid` are still accepted and mapped to
`payments`/`udharAmount`.

Behaviour

- Duplicate `productId` lines with the same `discountPercent` are merged;
  different discounts on the same product are rejected (`ERR_DUPLICATE_LINE`).
- If `shiftId` is omitted the cashier's OPEN shift (if any) is attached.
- Stock is deducted at the shop's sale location through the inventory engine.
- Credit sales require a customer and are checked against `creditLimit`
  under a row lock. Managers and above may override the limit
  (server-side role check).
- Everything (invoice, items, payments, stock, udhar, shift, ledger, audit,
  outbox) commits in one transaction or nothing does.
- Same key + same payload returns the existing invoice with `200`. Same key +
  different payload returns `422 IDEMPOTENCY_KEY_REUSED`.

Response `201`: `{ invoice, stock: [{ productId, balanceAfter }], shiftId }` where
`invoice` includes `items`, `payments`, `customer`.

Error codes: `PRODUCT_NOT_FOUND` (404), `INSUFFICIENT_STOCK` (409, details
`{ productId, productName, requestedQty, availableQty }`),
`CREDIT_LIMIT_EXCEEDED` (409, details `{ creditLimit, currentBalance,
requestedAmount, projectedBalance }`), `CUSTOMER_REQUIRED` (400),
`SHIFT_INVALID` (409), `IDEMPOTENCY_KEY_REUSED` (422), engine codes above
(400), `MAX_RETRIES_EXCEEDED` (409).

### `GET /billing/invoices`

Query: `from`, `to` (ISO dates, business-day inclusive), `status`, `type`
(`SALE` | `SALES_RETURN`), `customerId`, `paymentMode`, `q` (invoice number
contains), `skip`, `take` (max 100). Response `{ items, total }`; each item:
`{ id, invoiceNumber, type, status, totalAmount, paidAmount, udharAmount,
changeAmount, paymentMode, createdAt, customer: { id, name } | null,
cashier: { id, name }, itemCount, originalId, returnedAmount }`.

### `GET /billing/invoices/:id`

Full invoice: items (with `returnedQuantity`, `discountAmount`,
`taxableAmount`), payments, customer, cashier, shift, `returns[]` (summaries of
return invoices), `originalInvoice` summary for returns.

### `GET /billing/invoices/:id/receipt`

`{ shop: { name, address, city, state, pincode, phone, email, gstin },
invoice, items, payments, gstSummary: [{ rate, taxableAmount, cgst, sgst, igst,
cess }], totals: { subtotal, discount, taxable, tax, roundOff, grandTotal,
paid, change, udhar } }` for printing.

### `POST /billing/returns`

Body: `{ idempotencyKey, invoiceId, items?: [{ invoiceItemId, quantity }],
reason?, notes?, refund?: { tender?: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER',
reference? } }`. Omitting `items` returns everything still returnable.
Refund order: the original credit portion is reversed on the customer first,
the remainder is refunded through `refund.tender` (default `CASH`). A cash
refund requires the cashier's OPEN shift.

Response `201`: return invoice (type `SALES_RETURN`) with items and payments.
Codes: `INVOICE_NOT_FOUND`, `INVOICE_NOT_RETURNABLE`, `RETURN_QTY_EXCEEDS`,
`SHIFT_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`.

### `POST /billing/invoices/:id/cancel`

Roles: `MANAGER`, `ADMIN`, `OWNER`, `SUPER_ADMIN`. Body `{ reason }`. Only a
`SALE` with no returns, on the same business day, can be cancelled. Stock,
udhar, shift, ledger are reversed; the invoice becomes `CANCELLED` and keeps
its number. Codes: `INVOICE_NOT_CANCELLABLE`.

## 3. Shifts

- `POST /shifts/open { openingCash }` returns the shift; `409 SHIFT_ALREADY_OPEN`.
- `GET /shifts/current` returns the caller's OPEN shift or `null`.
- `POST /shifts/current/close { closingCash, notes? }` closes it; response
  includes `expectedCash`, `closingCash`, `variance`.
- `GET /shifts?skip&take` lists the shop's shifts (`MANAGER`+ see all, cashiers
  see their own).

Shift shape: `{ id, status, openedAt, closedAt, openingCash, expectedCash,
closingCash, variance, totalSales, cashSales, upiSales, cardSales, udharSales,
totalReceipts, openedBy: { id, name }, closedBy }`.

`expectedCash = openingCash + cash sales - cash refunds + cash receipts`.

## 4. Customers

- `GET /customers?q&skip&take` returns `{ items, total }`.
- `POST /customers { name, phone, email?, address?, city?, state?, creditLimit?, notes? }`.
- `PATCH /customers/:id { name?, phone?, email?, address?, city?, state?, creditLimit?, notes?, isActive? }`.
- `GET /customers/:id` returns the customer with `state`, `creditLimit`,
  `outstandingBalance`, `totalPurchases`, `totalPaid`, last 10 invoices and
  last 10 ledger rows.
- `GET /customers/:id/ledger?skip&take` returns `{ items, total }` of
  `UdharTransaction` rows `{ id, type, amount, balanceBefore, balanceAfter,
  tender, reference, notes, invoice: { id, invoiceNumber } | null, recordedBy:
  { name }, createdAt }`.
- `GET /customers/:id/invoices?skip&take` returns `{ items, total }`.
- `POST /customers/:id/payments { idempotencyKey, amount, tender, reference?,
  notes?, allowAdvance? }` records a repayment. Without `allowAdvance`,
  `amount > outstandingBalance` is `409 PAYMENT_EXCEEDS_OUTSTANDING`. With it,
  the balance may go negative (advance / store credit). Response
  `{ customer, transaction }`.
- `POST /customers/search { query, skip?, take? }` returns an array.
- `DELETE /customers/:id` soft-deletes; `409 CUSTOMER_HAS_BALANCE` when the
  outstanding balance is not zero.

Roles: reads for all roles; create/update/payments for `CASHIER`+; delete for
`MANAGER`+.

## 5. Products and search

- `GET /products?q&limit&offset` (limit max 200) returns an array of products
  with `currentStock`, `gstRate`, `unit`, `sellingPrice`, `mrp`, `barcode`,
  `type`, `isActive`, `category`.
- `GET /search?q&limit` returns lean results `{ id, name, sku, barcode,
  sellingPrice, mrp, gstRate, unit, currentStock, type, isActive, imageUrl,
  categoryName }` ranked by relevance (exact barcode/SKU first, then name).
- `GET /search/barcode/:code` returns exactly one product or
  `404 BARCODE_NOT_FOUND`; `409 BARCODE_AMBIGUOUS` with `details.candidates`.
- Barcodes are unique per shop: `409 BARCODE_IN_USE` on create/update.
- Price changes on `PATCH /products/:id` write an `AuditLog` row
  (`PRODUCT_PRICE_CHANGED`, before/after).

## 6. Dashboard and reports

- `GET /dashboard/summary` returns
  `{ businessDate, timezone, todayGrossSales, todayReturns, todaySales (net),
  todayProfit, todayOrders, todayReturnCount, totalRevenue (net, all time),
  totalOrders, totalCustomers, totalProducts, outstandingUdhar, lowStockCount,
  outOfStockCount, inventoryValue, recentInvoices: [{ id, invoiceNumber, type,
  status, totalAmount, paymentMode, createdAt, customer }], paymentModes:
  [{ mode, amount }] (today, from tenders plus udhar), shift }`.
  Only `SALE` invoices count as sales; `SALES_RETURN` totals are subtracted;
  `CANCELLED` invoices are excluded.
- `GET /dashboard/kpis` returns `{ businessDate, grossRevenue, netRevenue,
  totalRefunds, orders, avgOrderValue }` computed live and cached for 60 s
  under key `shop:{shopId}:analytics:kpis`.
- `GET /dashboard/analytics?range` and `GET /dashboard/trends?days` keep their
  shapes with the same SALE/RETURN/CANCELLED rules and business-day ranges.
- `GET /dashboard/export/invoices.csv?from&to`,
  `GET /dashboard/export/invoice-items.csv?from&to`,
  `GET /dashboard/export/gst-summary.csv?from&to` stream `text/csv`.

Cache keys the event processor invalidates after any invoice mutation:
`shop:{shopId}:analytics:dashboard`, `shop:{shopId}:analytics:kpis`,
`shop:{shopId}:analytics:summary`.

## 7. Outbox events (payloads)

All payloads carry `eventId`, `correlationId`, `shopId`, `userId`, `createdAt`.

- `INVOICE_CREATED`: `{ invoiceId, invoiceNumber, type: 'SALE', customerId,
  amount, paymentMode, items: [{ productId, quantity, balanceAfter }] }`
- `INVOICE_RETURNED`: `{ invoiceId, invoiceNumber, originalInvoiceId, amount,
  items: [{ productId, quantity, balanceAfter }] }`
- `INVOICE_CANCELLED`: `{ invoiceId, invoiceNumber, amount, items: [...] }`
- `CUSTOMER_PAYMENT_RECORDED`: `{ customerId, transactionId, amount, tender }`

## 8. Shop

`GET /shops/me` returns `{ id, name, address, city, state, pincode, phone,
email, logoUrl, settings: { gstin, currency, timezone } }`. The POS uses
`state` to decide inter-state GST for a selected customer.
