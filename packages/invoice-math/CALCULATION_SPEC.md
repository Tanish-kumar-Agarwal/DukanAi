# Canonical Calculation Specification

This document defines the strictly deterministic 10-step canonical execution order for the `InvoiceMathEngine`. All current and future financial calculations within the shared `@dukaanai/invoice-math` package MUST strictly adhere to this execution pipeline to guarantee drift-free outputs across all deployment boundaries (Frontend POS, Backend API, Receipt generation, Data pipelines).

## The Pipeline

**1. Validate Input**
- Ensure requested discounts are non-negative.
- Reject invalid discount types and missing reasons.
- Ensure strict formatting of payment modes and values.
- Apply `Object.freeze()` to seal the input from runtime mutation.

**2. Normalize Monetary Values**
- Coerce all raw number inputs into precise `Decimal.js` wrapped instances (`Money` abstractions if utilized).
- Enforce that `Decimal.set(...)` configuration (e.g. `precision`, `rounding mode`) is strictly applied via the centralized `decimal.ts` singleton before any operations occur.

**3. Calculate Line Subtotals**
- For each item: `quantity * unitPrice`.
- Apply line-level discounts (if applicable in future scope).
- Accumulate to calculate raw `Invoice Subtotal`.

**4. Apply Invoice Discount**
- Deduct the global `discountAmount` or compute `discountPercentage` against the raw `Invoice Subtotal`.
- Reject mathematically impossible states (e.g. `discountAmount > Subtotal`).

**5. Distribute Discount**
- Proportionally allocate the global discount across all line items based on their weight (value contribution) relative to the subtotal.
- This prevents sub-cent drift and ensures `SUM(lineDiscount) == globalDiscount`.

**6. Calculate Taxable Amount**
- For each line item: `Taxable Amount = Line Subtotal - Allocated Line Discount`.
- Accumulate to `Invoice Taxable Amount`.

**7. Calculate Line Taxes**
- Apply exact GST slab rates (`5%`, `12%`, `18%`, `28%`) against the item's `Taxable Amount`.
- Depending on interstate rules, allocate strictly into `CGST/SGST` or `IGST`.
- All tax computations truncate/round to 2 decimal places per local taxation guidelines immediately at the line level.

**8. Aggregate Taxes**
- `Invoice Total Tax = SUM(Line Tax Amounts)`.
- Re-verify: `SUM(Line CGST) + SUM(Line SGST) + SUM(Line IGST) == Invoice Total Tax`.

**9. Apply Round-Off**
- Calculate mathematical `Final Total = Invoice Taxable Amount + Invoice Total Tax`.
- Calculate nearest whole integer: `Rounded Final Total = Math.round(Final Total)`.
- Extract deterministic difference: `Round-Off = Rounded Final Total - Final Total`.
- Store `Round-Off` accurately to support exact zero-sum ledger tracking.

**10. Produce Final Totals & Metadata**
- Produce the final immutable `InvoiceCalculationResultV1` output.
- Inject `calculationHash` derived strictly from the frozen inputs and rule logic.
- Inject deterministic context flags: `schemaVersion`, `engineVersion`.
- Return the payload exactly as calculated, exposing zero internal calculation helper methods to consumers.
