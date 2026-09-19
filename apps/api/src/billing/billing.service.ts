import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GstRate, LedgerAccount, LedgerEntryType, Prisma, ProductType, ProductUnit, TenderType } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, InvoiceItemDto, PaymentTenderDto } from './dto/create-invoice.dto';
import { CalculateInvoiceDto } from './dto/calculate-invoice.dto';
import { InventoryCacheService } from '../inventory/inventory-cache.service';
import { BillingHelpers } from './billing.helpers';
import { InvoiceMathEngine, InvoiceMathError, Decimal, InvoiceMathInput, InvoiceCalculationResultV1 } from './utils/invoice-math.engine';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { BillingFeatureConfig } from '../config/domains/features/billing-feature.config';
import { InventoryMutationEngine, MutationType } from '../inventory-domain/services/inventory-mutation.engine';
import { InventoryLocationService } from '../inventory-domain/services/inventory-location.service';
import { OptimisticLockConflictError, InsufficientStockError } from '../inventory-domain/errors/inventory.errors';
import { InvoiceNumberService } from './services/invoice-number.service';
import { LedgerPostingService, LedgerEntryInput } from './services/ledger-posting.service';
import { BillingActor, INVOICE_INCLUDE, InvoiceWithRelations, StockOutcome, isManager, money, qty } from './billing.types';
import { financialYearLabel, safeTimeZone } from '../common/time/business-day';

type Tx = Prisma.TransactionClient;

interface NormalisedLine {
  productId: string;
  quantity: number;
  discountPercent: number;
}

interface LockedCustomer {
  id: string;
  name: string;
  state: string | null;
  outstandingBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal;
  isActive: boolean;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  type: ProductType;
  unit: ProductUnit;
  currentStock: Prisma.Decimal;
  stockVersion: number;
  sellingPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  mrp: Prisma.Decimal;
  gstRate: GstRate;
  cessRate: Prisma.Decimal;
}

export interface CreateInvoiceResult {
  invoice: InvoiceWithRelations;
  stock: StockOutcome[];
  shiftId: string | null;
  replayed: boolean;
}

const OCC_RETRY_MARKER = 'OPTIMISTIC_LOCK_CONFLICT';
const STOCKED_TYPES = new Set(['SIMPLE', 'VARIABLE', 'BUNDLE', 'COMBO']);

/**
 * POS checkout.
 *
 * One request = one atomic transaction that creates the invoice, its lines
 * and tenders, deducts stock through the inventory engine, updates the
 * customer's credit under a row lock, updates the open shift, posts a
 * balanced double-entry ledger, writes the audit row and stages the outbox
 * event. Any failure rolls all of it back. Redis is advisory only.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryCache: InventoryCacheService,
    private readonly billingHelpers: BillingHelpers,
    private readonly tenantContext: TenantContextService,
    private readonly billingConfig: BillingFeatureConfig,
    private readonly inventoryMutationEngine: InventoryMutationEngine,
    private readonly locationService: InventoryLocationService,
    private readonly invoiceNumbers: InvoiceNumberService,
    private readonly ledger: LedgerPostingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  async calculateInvoice(dto: CalculateInvoiceDto, actor: BillingActor) {
    const lines = this.normaliseLines(dto.items);
    const products = await this.loadProducts(actor.shopId, lines.map((l) => l.productId));
    const { isInterState, shopState, customerState } = await this.resolveInterState(actor.shopId, dto.customerId);

    const payments = dto.payments ? this.toPaymentInput(dto.payments, dto.udharAmount) : undefined;
    const result = this.runEngine({
      items: lines.map((l) => this.toMathItem(l, products.get(l.productId)!, isInterState)),
      discountAmount: dto.discountAmount,
      discountPercentage: dto.discountPercentage,
      discountType: dto.discountType,
      discountReason: dto.discountReason,
      payment: payments,
    });

    return { ...result, isInterState, shopState, customerState };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async createInvoice(dto: CreateInvoiceDto, actor: BillingActor): Promise<CreateInvoiceResult> {
    const lines = this.normaliseLines(dto.items);
    const paymentInput = this.toPaymentInput(dto.payments ?? this.legacyPayments(dto), dto.udharAmount ?? (dto.payments ? 0 : this.legacyUdhar(dto)));
    const requestHash = this.hashRequest({ lines, dto, paymentInput });

    // 1. Idempotent replay (same key + same payload) or reuse rejection.
    const existing = await this.prisma.invoice.findFirst({
      where: { idempotencyKey: dto.idempotencyKey, shopId: actor.shopId },
      include: INVOICE_INCLUDE,
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException({
          message: 'This idempotency key was already used for a different request.',
          code: 'IDEMPOTENCY_KEY_REUSED',
          details: { invoiceId: existing.id, invoiceNumber: existing.invoiceNumber },
        });
      }
      return { invoice: existing, stock: [], shiftId: existing.shiftId, replayed: true };
    }

    // 2. Products, location, availability (fail fast before any lock).
    const products = await this.loadProducts(actor.shopId, lines.map((l) => l.productId));
    const locationId = await this.locationService.resolveSaleLocation(this.prisma, actor.shopId);
    const availability = await this.loadAvailability(actor.shopId, locationId, products);
    for (const line of lines) {
      const product = products.get(line.productId)!;
      if (!STOCKED_TYPES.has(product.type)) continue;
      const available = availability.get(line.productId) ?? 0;
      if (available < line.quantity) {
        await this.billingHelpers.auditRejected(actor, 'INSUFFICIENT_STOCK', { productId: product.id, requestedQty: line.quantity, availableQty: available });
        throw this.insufficientStock(product, line.quantity, available);
      }
    }

    // 3. Redis advisory pre-check (never authoritative, always compensated).
    const decrementedInRedis: NormalisedLine[] = [];
    for (const line of lines) {
      if (!STOCKED_TYPES.has(products.get(line.productId)!.type)) continue;
      const status = await this.inventoryCache.tryDecrementStock(line.productId, line.quantity);
      if (status === 'ok') {
        decrementedInRedis.push(line);
      } else if (status === 'insufficient') {
        // The DB said there is enough (step 2): the cache is stale. Repair it and continue.
        await this.inventoryCache.syncStock(line.productId, products.get(line.productId)!.currentStock.toString());
      }
    }

    const { isInterState } = await this.resolveInterState(actor.shopId, dto.customerId);
    const requiresCustomer = paymentInput.udharAmount.greaterThan(0);
    if (requiresCustomer && !dto.customerId) {
      await this.restoreRedis(decrementedInRedis);
      throw new BadRequestException({ message: 'A customer must be selected for credit (udhar) billing.', code: 'CUSTOMER_REQUIRED' });
    }

    // 4. Engine (validates discounts and the settlement before we touch the DB).
    let math: InvoiceCalculationResultV1;
    try {
      math = this.runEngine({
        items: lines.map((l) => this.toMathItem(l, products.get(l.productId)!, isInterState)),
        discountAmount: dto.discountAmount,
        discountPercentage: dto.discountPercentage,
        discountType: dto.discountType,
        discountReason: dto.discountReason,
        payment: paymentInput,
      });
    } catch (e) {
      await this.restoreRedis(decrementedInRedis);
      throw e;
    }
    const timeZone = await this.billingHelpers.shopTimeZone(actor.shopId);
    const MAX_RETRIES = 3;
    let attempt = 0;

    try {
      while (attempt < MAX_RETRIES) {
        attempt++;
        try {
          const outcome = await this.prisma.$transaction(
            async (tx) => {
              const now = new Date();
              const financialYear = financialYearLabel(now, timeZone);

              // Authoritative prices are the ones committed when this transaction runs:
              // re-read the products and recompute so a price change between the
              // preview and the checkout can never be persisted silently (the fixed
              // tender amounts would no longer match and the engine rejects it).
              const txProducts = await this.loadProducts(actor.shopId, lines.map((l) => l.productId), tx);
              txProducts.forEach((p, id) => products.set(id, p));
              math = this.runEngine({
                items: lines.map((l) => this.toMathItem(l, products.get(l.productId)!, isInterState)),
                discountAmount: dto.discountAmount,
                discountPercentage: dto.discountPercentage,
                discountType: dto.discountType,
                discountReason: dto.discountReason,
                payment: paymentInput,
              });
              const payment = math.payment!;

              // a. Shift (explicit or the cashier's open one), locked for the whole transaction.
              const shiftId = await this.lockShift(tx, actor, dto.shiftId);

              // b. Customer lock + credit-limit check.
              let customer: LockedCustomer | null = null;
              if (dto.customerId) {
                customer = await this.lockCustomer(tx, actor.shopId, dto.customerId);
                if (payment.udharAmount.greaterThan(0)) {
                  const projected = customer.outstandingBalance.plus(money(payment.udharAmount));
                  if (projected.greaterThan(customer.creditLimit) && !isManager(actor.role)) {
                    throw new ConflictException({
                      message: `Credit limit exceeded for ${customer.name}.`,
                      code: 'CREDIT_LIMIT_EXCEEDED',
                      details: {
                        creditLimit: customer.creditLimit.toNumber(),
                        currentBalance: customer.outstandingBalance.toNumber(),
                        requestedAmount: payment.udharAmount.toNumber(),
                        projectedBalance: projected.toNumber(),
                      },
                    });
                  }
                }
              }

              // c. Gapless number.
              const { number: invoiceNumber } = await this.invoiceNumbers.next(tx, actor.shopId, 'POS_INVOICE', `INV-${financialYear}-`);

              // d. Invoice + lines + tenders.
              const discountApplied = math.invoiceDiscount.greaterThan(0);
              const invoice = await tx.invoice.create({
                data: {
                  invoiceNumber,
                  financialYear,
                  shopId: actor.shopId,
                  idempotencyKey: dto.idempotencyKey,
                  requestHash,
                  customerId: dto.customerId ?? null,
                  cashierId: actor.userId,
                  paymentMode: payment.paymentMode,
                  status: 'COMPLETED',
                  type: 'SALE',
                  subtotal: money(math.subtotal),
                  discountAmount: money(math.totalDiscount),
                  discountPercentage: dto.discountPercentage !== undefined ? new Prisma.Decimal(dto.discountPercentage) : null,
                  discountType: discountApplied ? (dto.discountType ?? 'FIXED_AMOUNT') : null,
                  discountReason: discountApplied ? dto.discountReason ?? null : null,
                  approvedBy: discountApplied ? actor.userId : null,
                  approvalTimestamp: discountApplied ? now : null,
                  taxableAmount: money(math.taxableTotal),
                  taxAmount: money(math.totalTax),
                  cgstAmount: money(math.totalCgst),
                  sgstAmount: money(math.totalSgst),
                  igstAmount: money(math.totalIgst),
                  roundOffAmount: money(math.roundOff),
                  totalAmount: money(math.finalTotal),
                  paidAmount: money(payment.paidAmount),
                  changeAmount: money(payment.changeAmount),
                  udharAmount: money(payment.udharAmount),
                  paymentRef: payment.tenders.map((t) => t.reference).filter(Boolean).join(',') || null,
                  isInterState,
                  notes: dto.notes ?? null,
                  shiftId,
                  items: {
                    create: math.lines.map((line) => {
                      const product = products.get(line.productId)!;
                      const dtoLine = lines.find((l) => l.productId === line.productId)!;
                      return {
                        productId: line.productId,
                        productName: product.name,
                        productSku: product.sku,
                        quantity: qty(line.quantity),
                        unit: product.unit,
                        costPrice: product.costPrice,
                        sellingPrice: product.sellingPrice,
                        mrp: product.mrp,
                        discountPercent: new Prisma.Decimal(dtoLine.discountPercent),
                        discountAmount: money(line.discountAmount),
                        taxableAmount: money(line.taxableAmount),
                        gstRate: product.gstRate,
                        cgstAmount: money(line.cgstAmount),
                        sgstAmount: money(line.sgstAmount),
                        igstAmount: money(line.igstAmount),
                        cessAmount: money(line.cessAmount),
                        totalAmount: money(line.lineTotal),
                      };
                    }),
                  },
                  payments: {
                    create: payment.tenders
                      .filter((t) => t.amount.greaterThan(0) || t.changeAmount.greaterThan(0))
                      .map((t) => ({
                        shopId: actor.shopId,
                        tender: t.type as TenderType,
                        amount: money(t.amount),
                        tenderedAmount: money(t.tenderedAmount),
                        changeAmount: money(t.changeAmount),
                        reference: t.reference ?? null,
                      })),
                  },
                },
                include: INVOICE_INCLUDE,
              });

              // e. Stock, one engine call per line (OCC on the product version).
              const stock: StockOutcome[] = [];
              for (const line of lines) {
                const product = products.get(line.productId)!;
                try {
                  const result = await this.inventoryMutationEngine.mutateStock(tx, {
                    shopId: actor.shopId,
                    locationId,
                    productId: line.productId,
                    quantity: line.quantity,
                    mutationType: MutationType.SALE,
                    reason: `Sale ${invoiceNumber}`,
                    referenceId: invoice.id,
                    performedBy: actor.userId,
                    occurredAt: now,
                    allowNegative: false,
                  });
                  if (!result.bypassed) {
                    stock.push({
                      productId: line.productId,
                      quantity: line.quantity,
                      balanceAfter: result.balanceAfter.toNumber(),
                      productStockAfter: result.productStockAfter.toNumber(),
                    });
                  }
                } catch (e) {
                  if (e instanceof OptimisticLockConflictError) throw new Error(OCC_RETRY_MARKER);
                  if (e instanceof InsufficientStockError) {
                    throw this.insufficientStock(product, line.quantity, Number(e.details?.availableQty ?? 0));
                  }
                  throw e;
                }
              }

              // f. Customer credit and purchase stats.
              if (customer) {
                if (payment.udharAmount.greaterThan(0)) {
                  const before = customer.outstandingBalance;
                  const after = before.plus(money(payment.udharAmount));
                  await tx.udharTransaction.create({
                    data: {
                      customerId: customer.id,
                      invoiceId: invoice.id,
                      shopId: actor.shopId,
                      recordedById: actor.userId,
                      type: 'CREDIT',
                      amount: money(payment.udharAmount),
                      balanceBefore: before,
                      balanceAfter: after,
                      notes: `Credit sale ${invoiceNumber}`,
                    },
                  });
                  await tx.customer.update({
                    where: { id: customer.id },
                    data: { outstandingBalance: after, totalPurchases: { increment: money(math.finalTotal) }, lastPurchaseAt: now },
                  });
                } else {
                  await tx.customer.update({
                    where: { id: customer.id },
                    data: { totalPurchases: { increment: money(math.finalTotal) }, lastPurchaseAt: now },
                  });
                }
              }

              // g. Shift counters (cash expected = cash applied, i.e. tendered - change).
              if (shiftId) {
                const buckets = this.tenderBuckets(payment.tenders);
                await tx.shift.update({
                  where: { id: shiftId },
                  data: {
                    totalSales: { increment: money(math.finalTotal) },
                    cashSales: { increment: buckets.cash },
                    upiSales: { increment: buckets.upi },
                    cardSales: { increment: buckets.card },
                    udharSales: { increment: money(payment.udharAmount) },
                    expectedCash: { increment: buckets.cash },
                  },
                });
              }

              // h. Balanced double-entry ledger.
              await this.ledger.post(tx, {
                shopId: actor.shopId,
                invoiceId: invoice.id,
                description: `Sale ${invoiceNumber}`,
                entries: this.saleLedgerEntries(payment.tenders, payment.udharAmount, math, products, lines),
              });

              // i. Audit.
              await tx.auditLog.create({
                data: {
                  shopId: actor.shopId,
                  userId: actor.userId,
                  action: 'INVOICE_CREATED',
                  entity: 'Invoice',
                  entityId: invoice.id,
                  ipAddress: actor.ipAddress ?? null,
                  afterData: {
                    invoiceNumber,
                    totalAmount: math.finalTotal.toFixed(2),
                    itemCount: lines.length,
                    paymentMode: payment.paymentMode,
                    tenders: payment.tenders.map((t) => ({ type: t.type, amount: t.amount.toFixed(2), change: t.changeAmount.toFixed(2) })),
                    udharAmount: payment.udharAmount.toFixed(2),
                    discount: discountApplied
                      ? { amount: math.invoiceDiscount.toFixed(2), reason: dto.discountReason ?? null, approvedBy: actor.userId, approverRole: actor.role }
                      : null,
                    customerId: dto.customerId ?? null,
                    shiftId,
                  },
                },
              });

              // j. Outbox.
              await this.billingHelpers.stageEvent(tx, actor, 'INVOICE_CREATED', invoice.id, {
                invoiceId: invoice.id,
                invoiceNumber,
                type: 'SALE',
                customerId: dto.customerId ?? null,
                amount: math.finalTotal.toNumber(),
                paymentMode: payment.paymentMode,
                items: stock.map((s) => ({ productId: s.productId, quantity: s.quantity, balanceAfter: s.productStockAfter })),
              });

              return { invoice, stock, shiftId };
            },
            {
              timeout: this.billingConfig.gatewayTimeoutMs,
              maxWait: this.billingConfig.transactionMaxWaitMs,
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            },
          );

          // Committed: make the caches and listeners agree with the database.
          await this.billingHelpers.afterStockChange(actor, outcome.stock);
          return { ...outcome, replayed: false };
        } catch (error) {
          if (this.isIdempotencyRace(error)) {
            const duplicate = await this.prisma.invoice.findFirst({
              where: { idempotencyKey: dto.idempotencyKey, shopId: actor.shopId },
              include: INVOICE_INCLUDE,
            });
            if (duplicate) {
              await this.restoreRedis(decrementedInRedis);
              return { invoice: duplicate, stock: [], shiftId: duplicate.shiftId, replayed: true };
            }
          }
          if (error instanceof Error && error.message === OCC_RETRY_MARKER && attempt < MAX_RETRIES) {
            this.logger.warn(`Optimistic lock conflict on attempt ${attempt}, retrying`);
            await this.jitter();
            const fresh = await this.loadProducts(actor.shopId, lines.map((l) => l.productId));
            fresh.forEach((p, id) => products.set(id, p));
            continue;
          }
          throw error;
        }
      }
      throw new ConflictException({ message: 'Could not complete the bill due to concurrent activity. Please try again.', code: 'MAX_RETRIES_EXCEEDED' });
    } catch (error) {
      await this.restoreRedis(decrementedInRedis);
      if (error instanceof ConflictException) {
        const body = error.getResponse() as { code?: string; details?: unknown };
        if (body?.code === 'CREDIT_LIMIT_EXCEEDED' || body?.code === 'INSUFFICIENT_STOCK') {
          await this.billingHelpers.auditRejected(actor, body.code, body.details);
        }
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers shared with the reversal service
  // ---------------------------------------------------------------------------

  normaliseLines(items: InvoiceItemDto[]): NormalisedLine[] {
    const merged = new Map<string, NormalisedLine>();
    for (const item of items) {
      const discount = item.discountPercent ?? 0;
      const existing = merged.get(item.productId);
      if (existing) {
        if (existing.discountPercent !== discount) {
          throw new BadRequestException({
            message: `Product ${item.productId} appears twice with different discounts.`,
            code: 'ERR_DUPLICATE_LINE',
          });
        }
        existing.quantity = Number(new Decimal(existing.quantity).plus(item.quantity).toFixed(3));
      } else {
        merged.set(item.productId, { productId: item.productId, quantity: Number(new Decimal(item.quantity).toFixed(3)), discountPercent: discount });
      }
    }
    return Array.from(merged.values());
  }

  async loadProducts(shopId: string, productIds: string[], db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Map<string, ProductRow>> {
    const rows = await db.product.findMany({
      where: { id: { in: productIds }, shopId, isDeleted: false, isActive: true },
      select: {
        id: true, name: true, sku: true, type: true, unit: true, currentStock: true, stockVersion: true,
        sellingPrice: true, costPrice: true, mrp: true, gstRate: true, cessRate: true,
      },
    });
    const map = new Map<string, ProductRow>(rows.map((r) => [r.id, r]));
    const missing = productIds.filter((id) => !map.has(id));
    if (missing.length > 0) {
      throw new NotFoundException({ message: `Products not found or inactive: ${missing.join(', ')}`, code: 'PRODUCT_NOT_FOUND', details: { productIds: missing } });
    }
    return map;
  }

  private async loadAvailability(shopId: string, locationId: string, products: Map<string, ProductRow>): Promise<Map<string, number>> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { shopId, locationId, variantId: null, isDeleted: false, productId: { in: Array.from(products.keys()) } },
      select: { productId: true, onHand: true, reserved: true },
    });
    const anyItems = await this.prisma.inventoryItem.groupBy({
      by: ['productId'],
      where: { shopId, isDeleted: false, productId: { in: Array.from(products.keys()) } },
      _count: { _all: true },
    });
    const hasItems = new Set(anyItems.map((a) => a.productId));
    const map = new Map<string, number>();
    for (const [id, product] of products) {
      const item = items.find((i) => i.productId === id);
      if (item) map.set(id, item.onHand.minus(item.reserved).toNumber());
      // Legacy products without any InventoryItem: the engine bootstraps from currentStock.
      else if (!hasItems.has(id)) map.set(id, product.currentStock.toNumber());
      else map.set(id, 0);
    }
    return map;
  }

  async resolveInterState(shopId: string, customerId?: string | null) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { state: true } });
    const shopState = shop?.state ?? null;
    let customerState: string | null = null;
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, shopId, isDeleted: false }, select: { state: true } });
      if (!customer) throw new NotFoundException({ message: 'Customer not found.', code: 'CUSTOMER_NOT_FOUND' });
      customerState = customer.state ?? null;
    }
    const isInterState = !!(shopState && customerState && normaliseState(shopState) !== normaliseState(customerState));
    return { isInterState, shopState, customerState };
  }

  toMathItem(line: NormalisedLine, product: ProductRow, isInterState: boolean) {
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: product.sellingPrice.toString(),
      discountPercent: line.discountPercent,
      gstRateStr: product.gstRate,
      cessRate: product.cessRate.toString(),
      isInterState,
    };
  }

  toPaymentInput(payments: PaymentTenderDto[], udharAmount?: number) {
    return {
      tenders: payments.map((p) => ({ type: p.tender as 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER', amount: p.amount, tenderedAmount: p.tenderedAmount, reference: p.reference })),
      udharAmount: new Decimal(udharAmount ?? 0),
    };
  }

  runEngine(input: InvoiceMathInput): InvoiceCalculationResultV1 {
    try {
      return InvoiceMathEngine.calculate(input);
    } catch (e) {
      if (e instanceof InvoiceMathError || (e as { name?: string })?.name === 'InvoiceMathError') {
        throw new BadRequestException({ message: (e as Error).message, code: (e as { code: string }).code });
      }
      throw e;
    }
  }

  private legacyPayments(dto: CreateInvoiceDto): PaymentTenderDto[] {
    const mode = dto.paymentMode ?? 'CASH';
    const paid = dto.amountPaid ?? 0;
    if (mode === 'UDHAR' || paid === 0) return [];
    const tender: TenderType = mode === 'SPLIT' ? 'CASH' : (mode as TenderType);
    return [{ tender, amount: paid }];
  }

  private legacyUdhar(dto: CreateInvoiceDto): number {
    if (dto.paymentMode === 'UDHAR') return dto.udharAmount ?? dto.amountPaid ?? 0;
    return dto.udharAmount ?? 0;
  }

  private hashRequest(payload: { lines: NormalisedLine[]; dto: CreateInvoiceDto; paymentInput: ReturnType<BillingService['toPaymentInput']> }): string {
    const canonical = {
      lines: [...payload.lines].sort((a, b) => a.productId.localeCompare(b.productId)),
      customerId: payload.dto.customerId ?? null,
      discountAmount: payload.dto.discountAmount ?? null,
      discountPercentage: payload.dto.discountPercentage ?? null,
      discountType: payload.dto.discountType ?? null,
      tenders: payload.paymentInput.tenders.map((t) => ({ type: t.type, amount: Number(t.amount), tendered: t.tenderedAmount ?? null })),
      udhar: payload.paymentInput.udharAmount.toFixed(2),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  async lockShift(tx: Tx, actor: BillingActor, shiftId?: string | null): Promise<string | null> {
    if (shiftId) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM Shift WHERE id = ${shiftId} AND shopId = ${actor.shopId} AND status = 'OPEN' AND isDeleted = false FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new ConflictException({ message: 'Shift is closed, invalid, or belongs to another shop.', code: 'SHIFT_INVALID' });
      }
      return rows[0].id;
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM Shift WHERE shopId = ${actor.shopId} AND openedById = ${actor.userId} AND status = 'OPEN' AND isDeleted = false
      ORDER BY openedAt DESC LIMIT 1 FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }

  async lockCustomer(tx: Tx, shopId: string, customerId: string): Promise<LockedCustomer> {
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; state: string | null; outstandingBalance: unknown; creditLimit: unknown; isActive: number | boolean }>>`
      SELECT id, name, state, outstandingBalance, creditLimit, isActive FROM Customer
      WHERE id = ${customerId} AND shopId = ${shopId} AND isDeleted = false FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException({ message: 'Customer not found.', code: 'CUSTOMER_NOT_FOUND' });
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      state: row.state,
      outstandingBalance: new Prisma.Decimal(String(row.outstandingBalance)),
      creditLimit: new Prisma.Decimal(String(row.creditLimit)),
      isActive: Boolean(row.isActive),
    };
  }

  tenderBuckets(tenders: ReadonlyArray<{ type: string; amount: Decimal }>) {
    const sum = (types: string[]) => money(tenders.filter((t) => types.includes(t.type)).reduce((a, t) => a.plus(t.amount), new Decimal(0)));
    return { cash: sum(['CASH']), upi: sum(['UPI']), card: sum(['CARD', 'BANK_TRANSFER']), bank: sum(['UPI', 'CARD', 'BANK_TRANSFER']) };
  }

  saleLedgerEntries(
    tenders: ReadonlyArray<{ type: string; amount: Decimal }>,
    udhar: Decimal,
    math: InvoiceCalculationResultV1,
    products: Map<string, ProductRow>,
    lines: NormalisedLine[],
  ): LedgerEntryInput[] {
    const buckets = this.tenderBuckets(tenders);
    const entries: LedgerEntryInput[] = [
      { account: LedgerAccount.CASH, type: LedgerEntryType.DEBIT, amount: buckets.cash },
      { account: LedgerAccount.BANK, type: LedgerEntryType.DEBIT, amount: buckets.bank },
      { account: LedgerAccount.ACCOUNTS_RECEIVABLE, type: LedgerEntryType.DEBIT, amount: money(udhar) },
      { account: LedgerAccount.SALES_REVENUE, type: LedgerEntryType.CREDIT, amount: money(math.taxableTotal.plus(math.roundOff)) },
      { account: LedgerAccount.GST_PAYABLE, type: LedgerEntryType.CREDIT, amount: money(math.totalTax) },
    ];
    const cost = lines.reduce((acc, l) => acc.plus(new Decimal(products.get(l.productId)!.costPrice.toString()).mul(l.quantity)), new Decimal(0));
    if (cost.greaterThan(0)) {
      entries.push({ account: LedgerAccount.COST_OF_GOODS, type: LedgerEntryType.DEBIT, amount: money(cost) });
      entries.push({ account: LedgerAccount.INVENTORY, type: LedgerEntryType.CREDIT, amount: money(cost) });
    }
    return entries;
  }

  insufficientStock(product: ProductRow, requestedQty: number, availableQty: number) {
    return new ConflictException({
      message: `Insufficient stock for "${product.name}": requested ${requestedQty}, available ${availableQty}.`,
      code: 'INSUFFICIENT_STOCK',
      details: { productId: product.id, productName: product.name, requestedQty, availableQty },
    });
  }

  private isIdempotencyRace(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String((error.meta as { target?: unknown })?.target ?? '').includes('idempotencyKey')
    );
  }

  private async restoreRedis(lines: NormalisedLine[]) {
    for (const line of lines) await this.inventoryCache.restoreStock(line.productId, line.quantity);
    lines.length = 0;
  }

  private async jitter() {
    const ms = Math.random() * this.billingConfig.jitterDelayRandomMultiplier + this.billingConfig.jitterDelayBaseMs;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function normaliseState(state: string): string {
  return state.trim().toLowerCase().replace(/\s+/g, ' ');
}

export { safeTimeZone };
