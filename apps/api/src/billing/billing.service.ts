import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InventoryGateway } from '../inventory/inventory.gateway';
import { InventoryCacheService } from '../inventory/inventory-cache.service';
import { BillingHelpers } from './billing.helpers';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';


import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { BillingFeatureConfig } from '../config/domains/features/billing-feature.config';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryGateway: InventoryGateway,
    private readonly inventoryCache: InventoryCacheService,
    private readonly billingHelpers: BillingHelpers,
    private readonly tenantContext: TenantContextService,
    private readonly billingConfig: BillingFeatureConfig
  ) {}

  async createInvoice(dto: CreateInvoiceDto, ipAddress: string): Promise<any> {
    const user = {
      shopId: this.tenantContext.getShopId(),
      userId: this.tenantContext.getUserId(),
      ipAddress
    };
    
    // Step A: Pre-validate ALL items BEFORE starting the transaction
    const productIds = dto.items.map(i => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isDeleted: false, isActive: true },
      select: {
        id: true, name: true, sku: true, currentStock: true, stockVersion: true,
        sellingPrice: true, costPrice: true, mrp: true, gstRate: true, hsnCode: true, unit: true,
      }
    });

    if (products.length !== new Set(productIds).size) {
      const foundIds = products.map((p: any) => p.id);
      const missingIds = Array.from(new Set(productIds)).filter(id => !foundIds.includes(id));
      throw new NotFoundException(`Products not found: ${missingIds.join(', ')}`);
    }

    const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

    for (const item of dto.items) {
      const product = productMap.get(item.productId)!;
      if (item.quantity <= 0) {
        throw new BadRequestException(`Quantity for ${product.name} must be greater than 0`);
      }
      if (product.currentStock.toNumber() < item.quantity) {
        throw new ConflictException({
          message: `Insufficient stock for "${product.name}"`,
          productId: product.id,
          productName: product.name,
          requestedQty: item.quantity,
          availableQty: product.currentStock.toNumber(),
          code: 'INSUFFICIENT_STOCK'
        });
      }
    }

    // Step A.5: Redis Atomic Pre-check (Layer 3)
    // Redis is NEVER authoritative. If Redis fails, we skip to DB-only path.
    const decrementedInRedis: Array<{ productId: string; quantity: number }> = [];
    try {
      for (const item of dto.items) {
        const status = await this.inventoryCache.tryDecrementStock(item.productId, item.quantity);
        if (status === 'insufficient') {
          // Rollback whatever we successfully decremented in Redis before throwing
          for (const doneItem of decrementedInRedis) {
            await this.inventoryCache.restoreStock(doneItem.productId, doneItem.quantity);
          }
          throw new ConflictException({
            message: `Insufficient stock for a product (fast rejection)`,
            productId: item.productId,
            code: 'INSUFFICIENT_STOCK'
          });
        }
        if (status === 'ok') {
          decrementedInRedis.push(item);
        }
        // 'cache_miss' → silently skip, DB will be the authority
      }
    } catch (e) {
      if (e instanceof ConflictException) {
        throw e; // Already rolled back above
      }
      // Redis connection failure: rollback what we can, continue to DB-only path
      this.logger.warn('Redis pre-check failed, falling back to DB-only path', e);
      for (const doneItem of decrementedInRedis) {
        try { await this.inventoryCache.restoreStock(doneItem.productId, doneItem.quantity); } catch { /* best-effort rollback */ }
      }
      decrementedInRedis.length = 0; // Nothing to compensate later
    }

    // Step B: Idempotency check
    if (!dto.idempotencyKey) {
      throw new BadRequestException('Idempotency key is required to prevent duplicate billing');
    }

    const existing = await this.prisma.invoice.findFirst({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true, customer: true }
    });
    if (existing) {
      // If we pre-decremented, rollback since we aren't executing the transaction
      for (const doneItem of decrementedInRedis) {
        await this.inventoryCache.restoreStock(doneItem.productId, doneItem.quantity);
      }
      return existing;
    }

    const MAX_RETRIES = 3;
    let attempt = 0;
    const stockDeductions: Array<{ productId: string; newStock: number; newVersion: number }> = [];

    // ━━━ MASTER TRY/CATCH: guarantees Redis compensation on ANY failure path ━━━
    try {
      while (attempt < MAX_RETRIES) {
        attempt++;
        try {
          const result = await this.prisma.$transaction(async (tx: any) => {
            // Clear array for each retry attempt
            stockDeductions.length = 0;

            // ━━━ CRITICAL SECTION START ━━━
            for (const item of dto.items) {
              const currentProduct = productMap.get(item.productId)!;

              const updateResult = await tx.$executeRaw`
                UPDATE Product
                SET
                  currentStock = currentStock - ${item.quantity},
                  stockVersion = stockVersion + 1,
                  updatedAt = NOW()
                WHERE
                  id = ${item.productId}
                  AND shopId = ${user.shopId}
                  AND currentStock >= ${item.quantity}
                  AND stockVersion = ${currentProduct.stockVersion}
                  AND isDeleted = false
              `;

              if (updateResult === 0) {
                const freshProduct = await tx.product.findUnique({
                  where: { id: item.productId },
                  select: { currentStock: true, stockVersion: true, name: true }
                });

                if (!freshProduct) {
                  throw new NotFoundException(`Product ${item.productId} not found`);
                }

                if (freshProduct.currentStock.toNumber() < item.quantity) {
                  throw new ConflictException({
                    message: `"${freshProduct.name}" is out of stock. Only ${freshProduct.currentStock} unit(s) available.`,
                    productId: item.productId,
                    productName: freshProduct.name,
                    requestedQty: item.quantity,
                    availableQty: freshProduct.currentStock.toNumber(),
                    code: 'INSUFFICIENT_STOCK'
                  });
                }

                throw new Error('OPTIMISTIC_LOCK_CONFLICT');
              }

              // Use Decimal math to avoid floating-point precision loss
              const newStock = new Decimal(currentProduct.currentStock.toString())
                .minus(new Decimal(item.quantity.toString()))
                .toDecimalPlaces(3);

              stockDeductions.push({
                productId: item.productId,
                newStock: newStock.toNumber(),
                newVersion: currentProduct.stockVersion + 1
              });
            }
            // ━━━ STOCK DEDUCTION COMPLETE ━━━

            // Step C: Generate invoice number with deterministic date formatting
            const now = new Date();
            // Use UTC-based calculation adjusted for IST (+5:30)
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istDate = new Date(now.getTime() + istOffset);
            const year = istDate.getUTCFullYear();
            const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
            const day = String(istDate.getUTCDate()).padStart(2, '0');
            const dateStr = `${year}${month}${day}`;

            // Financial year: April to March
            const istMonth = istDate.getUTCMonth(); // 0-indexed
            const financialYear = istMonth >= 3
              ? `${year}-${(year + 1).toString().slice(2)}`
              : `${year - 1}-${year.toString().slice(2)}`;

            const lastInvoice: any[] = await tx.$queryRaw`
              SELECT invoiceNumber FROM Invoice
              WHERE shopId = ${user.shopId}
                AND invoiceNumber LIKE ${`INV-${dateStr}-%`}
              ORDER BY invoiceNumber DESC
              LIMIT 1
              FOR UPDATE
            `;

            let sequence = 1;
            if (lastInvoice.length > 0) {
              const parts = lastInvoice[0].invoiceNumber.split('-');
              const lastSeq = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(lastSeq)) {
                sequence = lastSeq + 1;
              }
            }
            const invoiceNumber = `INV-${dateStr}-${String(sequence).padStart(5, '0')}`;

            // Step D: Calculate GST
            const shop = await tx.shop.findUnique({ where: { id: user.shopId }, select: { state: true } });

            // ━━━ P0 FIX: Pessimistic shift lock via SELECT FOR SHARE ━━━
            if (dto.shiftId) {
              const shiftLock: any[] = await tx.$queryRaw`
                SELECT id FROM Shift
                WHERE id = ${dto.shiftId}
                  AND shopId = ${user.shopId}
                  AND status = 'OPEN'
                  AND isDeleted = false
                FOR SHARE
              `;
              if (!shiftLock || shiftLock.length === 0) {
                throw new BadRequestException('Shift is invalid, closed, or belongs to another shop.');
              }
            }

            let customer = null;
            if (dto.customerId) {
              customer = await tx.customer.findFirst({
                where: { id: dto.customerId },
                select: { state: true, outstandingBalance: true, creditLimit: true }
              });
              if (!customer) throw new NotFoundException('Customer not found or belongs to another shop.');
            }

            const isInterState = customer?.state ? shop!.state !== customer.state : false;

            let subtotal = new Decimal(0);
            let totalDiscount = new Decimal(0);

            const taxBrackets: Record<number, Decimal> = { 0: new Decimal(0), 5: new Decimal(0), 12: new Decimal(0), 18: new Decimal(0), 28: new Decimal(0) };
            const gstRateMap: Record<string, number> = { ZERO: 0, FIVE: 5, TWELVE: 12, EIGHTEEN: 18, TWENTYEIGHT: 28 };

            const lineItems = dto.items.map(item => {
              const product = productMap.get(item.productId)!;
              const unitPrice = new Decimal(product.sellingPrice.toString());
              const qty = new Decimal(item.quantity);
              const discPct = new Decimal(item.discountPercent ?? 0);

              const lineSubtotal = unitPrice.mul(qty);
              const discountAmt = lineSubtotal.mul(discPct).div(100).toDecimalPlaces(2);
              const taxableAmt = lineSubtotal.minus(discountAmt);

              const gstPctNum = gstRateMap[product.gstRate] ?? 18;
              taxBrackets[gstPctNum] = taxBrackets[gstPctNum].plus(taxableAmt);

              const gstPct = new Decimal(gstPctNum);
              let cgstAmt = new Decimal(0), sgstAmt = new Decimal(0), igstAmt = new Decimal(0);
              if (isInterState) {
                igstAmt = taxableAmt.mul(gstPct).div(100).toDecimalPlaces(2);
              } else {
                const halfGst = gstPct.div(2);
                cgstAmt = taxableAmt.mul(halfGst).div(100).toDecimalPlaces(2);
                sgstAmt = taxableAmt.mul(halfGst).div(100).toDecimalPlaces(2);
              }
              const taxAmt = cgstAmt.plus(sgstAmt).plus(igstAmt);
              const lineTotal = taxableAmt.plus(taxAmt);

              subtotal = subtotal.plus(lineSubtotal);
              totalDiscount = totalDiscount.plus(discountAmt);

              return {
                productId: item.productId,
                productName: product.name,
                productSku: product.sku,
                quantity: qty.toNumber(),
                unit: product.unit,
                costPrice: product.costPrice,
                sellingPrice: product.sellingPrice,
                mrp: product.mrp,
                discountPercent: discPct.toNumber(),
                gstRate: product.gstRate,
                cgstAmount: cgstAmt,
                sgstAmount: sgstAmt,
                igstAmount: igstAmt,
                totalAmount: lineTotal,
              };
            });

            // ━━━ P1 FIX: GST bracket-level aggregation with proper CGST/SGST split ━━━
            let totalTax = new Decimal(0);
            let totalCgst = new Decimal(0);
            let totalSgst = new Decimal(0);
            let totalIgst = new Decimal(0);
            for (const [rate, taxableSum] of Object.entries(taxBrackets)) {
              const rateDecimal = new Decimal(rate);
              if (!rateDecimal.isZero() && !taxableSum.isZero()) {
                if (isInterState) {
                  const igst = taxableSum.mul(rateDecimal).div(100).toDecimalPlaces(2);
                  totalIgst = totalIgst.plus(igst);
                  totalTax = totalTax.plus(igst);
                } else {
                  const halfRate = rateDecimal.div(2);
                  const cgst = taxableSum.mul(halfRate).div(100).toDecimalPlaces(2);
                  const sgst = taxableSum.mul(halfRate).div(100).toDecimalPlaces(2);
                  totalCgst = totalCgst.plus(cgst);
                  totalSgst = totalSgst.plus(sgst);
                  totalTax = totalTax.plus(cgst).plus(sgst);
                }
              }
            }

            const taxableTotal = subtotal.minus(totalDiscount);
            const grandTotal = taxableTotal.plus(totalTax);
            // Use Decimal rounding instead of Math.round to avoid precision loss
            const roundedTotal = grandTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
            const roundOff = roundedTotal.minus(grandTotal).toDecimalPlaces(2);
            const finalTotal = grandTotal.plus(roundOff);

            // Step F: Validate Udhar
            if (dto.paymentMode === 'UDHAR' || dto.paymentMode === 'SPLIT') {
              if (!dto.customerId) throw new BadRequestException('A customer must be selected for Udhar billing.');
              if (!customer) throw new NotFoundException('Customer not found.');

              const udharAmount = dto.paymentMode === 'UDHAR' ? finalTotal : new Decimal(dto.udharAmount ?? 0);
              const newBalance = new Decimal(customer.outstandingBalance.toString()).plus(udharAmount);

              if (newBalance.greaterThan(new Decimal(customer.creditLimit.toString())) && !dto.adminOverride) {
                throw new ConflictException({
                  message: `Credit limit exceeded.`,
                  code: 'CREDIT_LIMIT_EXCEEDED',
                  creditLimit: customer.creditLimit,
                  currentBalance: customer.outstandingBalance,
                  requestedAmount: udharAmount,
                  projectedBalance: newBalance
                });
              }
            }

            // Calculate payment amounts
            const udharAmt = dto.paymentMode === 'UDHAR'
              ? finalTotal
              : (dto.paymentMode === 'SPLIT' ? new Decimal(dto.udharAmount ?? 0) : new Decimal(0));
            const paidAmount = finalTotal.minus(udharAmt);
            if (dto.paymentMode === 'CASH' && dto.cashTendered !== undefined && dto.cashTendered !== null && dto.cashTendered < finalTotal.toNumber()) {
              throw new BadRequestException('Cash tendered is less than the bill amount.');
            }

            // Change amount: only relevant for cash payments, must not go negative
            const changeAmount = dto.cashTendered
              ? Decimal.max(new Decimal(dto.cashTendered).minus(finalTotal), new Decimal(0)).toDecimalPlaces(2)
              : new Decimal(0);

            // Step G: Create Invoice
            const invoice = await tx.invoice.create({
              data: {
                invoiceNumber,
                financialYear,
                shopId: user.shopId,
                idempotencyKey: dto.idempotencyKey,
                customerId: dto.customerId ?? null,
                cashierId: user.userId,
                paymentMode: dto.paymentMode,
                status: 'COMPLETED',
                subtotal,
                discountAmount: totalDiscount,
                taxableAmount: taxableTotal,
                taxAmount: totalTax,
                roundOffAmount: roundOff,
                totalAmount: finalTotal,
                paidAmount,
                changeAmount,
                udharAmount: udharAmt,
                isInterState,
                cgstAmount: totalCgst,
                sgstAmount: totalSgst,
                igstAmount: totalIgst,
                notes: dto.notes ?? null,
                shiftId: dto.shiftId ?? null,
                items: { create: lineItems }
              },
              include: { items: true, customer: true }
            });

            // Step H: InventoryLog
            await tx.inventoryLog.createMany({
              data: dto.items.map(item => {
                const product = productMap.get(item.productId)!;
                const deduction = stockDeductions.find(d => d.productId === item.productId)!;
                return {
                  productId: item.productId,
                  shopId: user.shopId,
                  type: 'SALE',
                  quantityBefore: product.currentStock,
                  quantityChange: -item.quantity,
                  quantityAfter: deduction.newStock,
                  invoiceId: invoice.id,
                  recordedById: user.userId
                };
              })
            });

            // Step H.5: InventoryItem and StockLedgerEntry (Fixes Phase 2 & 9 sync)
            for (const item of dto.items) {
              const product = productMap.get(item.productId)!;
              let invItem = await tx.inventoryItem.findFirst({
                where: { shopId: user.shopId, productId: item.productId, locationId: 'DEFAULT' }
              });
              let oldOnHand = 0;
              if (invItem) {
                oldOnHand = invItem.onHand.toNumber();
                invItem = await tx.inventoryItem.update({
                  where: { id: invItem.id },
                  data: { onHand: { decrement: item.quantity } }
                });
              } else {
                invItem = await tx.inventoryItem.create({
                  data: {
                    shopId: user.shopId,
                    productId: item.productId,
                    locationId: 'DEFAULT',
                    onHand: -item.quantity,
                    status: 'AVAILABLE'
                  }
                });
              }
              
              await tx.stockLedgerEntry.create({
                data: {
                  shopId: user.shopId,
                  inventoryItemId: invItem.id,
                  movementType: 'SALE',
                  quantity: -item.quantity,
                  unitCost: product.costPrice,
                  referenceType: 'INVOICE',
                  referenceId: invoice.id,
                  balanceAfter: oldOnHand - item.quantity,
                  createdBy: user.userId
                }
              });
            }

            // Step I: Udhar Update
            if ((dto.paymentMode === 'UDHAR' || dto.paymentMode === 'SPLIT') && dto.customerId && customer) {
              if (udharAmt.greaterThan(0)) {
                const currentBalance = new Decimal(customer.outstandingBalance.toString());
                const newBalance = currentBalance.plus(udharAmt);

                await tx.udharTransaction.create({
                  data: {
                    customerId: dto.customerId,
                    invoiceId: invoice.id,
                    shopId: user.shopId,
                    recordedById: user.userId,
                    type: 'CREDIT',
                    amount: udharAmt,
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    notes: `Bill ${invoiceNumber}`
                  }
                });

                await tx.customer.update({
                  where: { id: dto.customerId },
                  data: {
                    outstandingBalance: newBalance,
                    totalPurchases: { increment: finalTotal.toNumber() },
                    lastPurchaseAt: new Date()
                  }
                });
              }
            } else if (dto.customerId) {
              await tx.customer.update({
                where: { id: dto.customerId },
                data: {
                  totalPurchases: { increment: finalTotal.toNumber() },
                  lastPurchaseAt: new Date()
                }
              });
            }

            // Step J: Shift update
            if (dto.shiftId) {
              // For SPLIT mode, distribute sales across the correct payment buckets
              if (dto.paymentMode === 'SPLIT') {
                const cashPortion = paidAmount.toNumber();
                const udharPortion = udharAmt.toNumber();
                await tx.shift.update({
                  where: { id: dto.shiftId },
                  data: {
                    totalSales: { increment: finalTotal.toNumber() },
                    cashSales: { increment: cashPortion },
                    udharSales: { increment: udharPortion },
                  }
                });
              } else {
                const paymentFieldMap: Record<string, string> = {
                  CASH: 'cashSales', UPI: 'upiSales', CARD: 'cardSales', UDHAR: 'udharSales',
                };
                const paymentField = paymentFieldMap[dto.paymentMode] ?? 'cashSales';

                await tx.shift.update({
                  where: { id: dto.shiftId },
                  data: {
                    totalSales: { increment: finalTotal.toNumber() },
                    [paymentField]: { increment: finalTotal.toNumber() }
                  }
                });
              }
            }

            // Step K: Audit Log
            await tx.auditLog.create({
              data: {
                shopId: user.shopId,
                userId: user.userId,
                action: 'CREATE',
                entity: 'Invoice',
                entityId: invoice.id,
                afterData: { invoiceNumber, totalAmount: finalTotal.toString(), itemCount: dto.items.length },
                ipAddress: user.ipAddress
              }
            });

            // Step L: Outbox Event Integration
            const eventId = crypto.randomUUID();
            const correlationId = this.tenantContext.getCorrelationId();

            await tx.outboxEvent.create({
              data: {
                id: eventId,
                shopId: user.shopId,
                type: 'INVOICE_CREATED',
                payload: {
                  eventId,
                  correlationId,
                  invoiceId: invoice.id,
                  shopId: user.shopId,
                  openedById: user.userId,
                  type: 'CREDIT',
                  createdAt: new Date().toISOString(),
                  amount: finalTotal.toNumber(),
                  description: `Invoice ${invoiceNumber} generated`
                }
              }
            });

            // Step M: Ledger Double-Entry Creation (ENG-302)
            // Duplicate protection check
            const existingLedgers = await tx.ledgerTransaction.count({
              where: { invoiceId: invoice.id }
            });
            if (existingLedgers > 0) {
              this.logger.warn(`Ledger entries already exist for Invoice ${invoice.id}. Skipping double-entry creation to preserve immutability.`);
            } else {
              // Determine the debit account based on payment mode
              const debitAccount = dto.paymentMode === 'UDHAR' || (dto.udharAmount && dto.udharAmount > 0)
                ? 'ACCOUNTS_RECEIVABLE' as const
                : 'CASH' as const;

              // Compute running balance for debit account
              const lastDebitEntry = await tx.ledgerTransaction.findFirst({
                where: { account: debitAccount },
                orderBy: { createdAt: 'desc' }
              });
              const debitBalanceBefore = lastDebitEntry ? lastDebitEntry.balanceAfter.toNumber() : 0;
              const debitBalanceAfter = debitBalanceBefore + finalTotal.toNumber();

              // Compute running balance for credit account (SALES_REVENUE)
              const lastCreditEntry = await tx.ledgerTransaction.findFirst({
                where: { account: 'SALES_REVENUE' },
                orderBy: { createdAt: 'desc' }
              });
              const creditBalanceBefore = lastCreditEntry ? lastCreditEntry.balanceAfter.toNumber() : 0;
              const creditBalanceAfter = creditBalanceBefore + finalTotal.toNumber();

              await tx.ledgerTransaction.create({
                data: {
                  shopId: user.shopId,
                  invoiceId: invoice.id,
                  account: debitAccount,
                  type: 'DEBIT',
                  amount: finalTotal,
                  balanceAfter: debitBalanceAfter,
                  description: `Bill ${invoiceNumber} - ${debitAccount}`
                }
              });

              await tx.ledgerTransaction.create({
                data: {
                  shopId: user.shopId,
                  invoiceId: invoice.id,
                  account: 'SALES_REVENUE',
                  type: 'CREDIT',
                  amount: finalTotal,
                  balanceAfter: creditBalanceAfter,
                  description: `Bill ${invoiceNumber} - SALES_REVENUE`
                }
              });
            }

            return invoice;
          }, {
            timeout: this.billingConfig.gatewayTimeoutMs,
            maxWait: this.billingConfig.transactionMaxWaitMs,
            isolationLevel: 'ReadCommitted' as any
          });

          // ━━━ DB COMMITTED SUCCESSFULLY — Redis is now authoritative for these items ━━━
          // Sync Redis with actual DB values for absolute truth alignment
          for (const deduction of stockDeductions) {
            try {
              await this.inventoryCache.syncStock(deduction.productId, deduction.newStock);
            } catch (syncErr) {
              this.logger.warn(`Redis sync failed for product ${deduction.productId}, will self-heal`, syncErr);
            }
          }

          this.inventoryGateway.broadcastStockUpdate(stockDeductions);
          this.billingHelpers.checkLowStockAlerts(stockDeductions);

          return result;

        } catch (error: any) {
          // ━━━ P0 FIX: Handle P2002 idempotency race — return existing invoice ━━━
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002' &&
            (error.meta as any)?.target?.toString()?.includes('idempotencyKey')
          ) {
            this.logger.warn(`Idempotency race detected for key ${dto.idempotencyKey}, returning existing invoice`);
            const duplicate = await this.prisma.invoice.findFirst({
              where: { idempotencyKey: dto.idempotencyKey },
              include: { items: true, customer: true }
            });
            if (duplicate) {
              // Redis was already decremented by the winning thread's commit;
              // our pre-check decrement is a surplus — restore it
              for (const doneItem of decrementedInRedis) {
                try { await this.inventoryCache.restoreStock(doneItem.productId, doneItem.quantity); } catch { /* best-effort rollback */ }
              }
              return duplicate;
            }
            // Extremely unlikely: P2002 fired but row not found (deleted between?). Fall through to throw.
          }

          if (error.message === 'OPTIMISTIC_LOCK_CONFLICT' && attempt < MAX_RETRIES) {
            this.logger.warn(`Optimistic lock conflict on attempt ${attempt}, retrying...`);
            const jitterMs = Math.random() * this.billingConfig.jitterDelayRandomMultiplier + this.billingConfig.jitterDelayBaseMs;
            await new Promise(resolve => setTimeout(resolve, jitterMs));
            const freshProducts = await this.prisma.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true, name: true, sku: true, currentStock: true, stockVersion: true,
                sellingPrice: true, costPrice: true, mrp: true, gstRate: true, hsnCode: true, unit: true,
              }
            });
            freshProducts.forEach((p: any) => productMap.set(p.id, p));
            continue;
          }

          // Any other error: propagate up to the master catch for Redis compensation
          throw error;
        }
      }

      throw new ConflictException({
        message: 'Could not complete the bill due to high concurrent activity. Please try again.',
        code: 'MAX_RETRIES_EXCEEDED'
      });

    } catch (outerError: any) {
      // ━━━ P0 FIX: MASTER COMPENSATION — restore Redis on ANY failure path ━━━
      // This fires for: DB failures, credit limit rejects, shift lock rejects,
      // max retries exceeded, or any unexpected error.
      // It does NOT fire for P2002 idempotency (already handled above with early return).
      this.logger.warn('Billing failed, compensating Redis stock', outerError?.message);
      for (const doneItem of decrementedInRedis) {
        try {
          await this.inventoryCache.restoreStock(doneItem.productId, doneItem.quantity);
        } catch (restoreErr) {
          this.logger.error(`CRITICAL: Failed to restore Redis stock for product ${doneItem.productId}`, restoreErr);
        }
      }
      throw outerError;
    }
  }

  async processReturn(dto: { invoiceId: string, reason?: string, notes?: string }, ipAddress: string): Promise<any> {
    const user = {
      shopId: this.tenantContext.getShopId(),
      userId: this.tenantContext.getUserId(),
      ipAddress
    };

    return await this.prisma.$transaction(async (tx: any) => {
      // 1. Fetch and validate original invoice
      const original = await tx.invoice.findUnique({
        where: { id: dto.invoiceId, shopId: user.shopId },
        include: { items: true, customer: true }
      });

      if (!original) {
        throw new NotFoundException('Invoice not found');
      }

      if (original.type !== 'SALE' || original.status !== 'COMPLETED') {
        throw new BadRequestException('Only completed sales can be returned');
      }

      // Idempotency: Prisma unique constraint on originalId will prevent duplicate return invoices
      // but we also check here to provide a clear error message.
      const existingReturn = await tx.invoice.findFirst({
        where: { originalId: original.id, type: 'SALES_RETURN' }
      });

      if (existingReturn) {
        throw new ConflictException('Invoice has already been returned');
      }

      // 2. Inventory Validation
      const productIds = original.items.map((i: any) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, shopId: user.shopId, isDeleted: false }
      });

      if (products.length !== new Set(productIds).size) {
        throw new BadRequestException('One or more products from this invoice have been deleted or corrupted.');
      }

      // 3. Shift Validation for Cash
      if (original.paymentMode === 'CASH') {
        const shift = await tx.shift.findFirst({
          where: { shopId: user.shopId, status: 'OPEN', openedById: user.userId }
        });
        if (!shift) {
          throw new BadRequestException('Cannot refund a cash invoice when there is no open shift.');
        }

        // Refund cash drawer
        await tx.shift.update({
          where: { id: shift.id },
          data: {
            expectedCash: { decrement: original.totalAmount }
          }
        });
      }

      // 4. Create Compensating Invoice
      const date = new Date();
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const dateStr = month >= 4 
        ? `${year}-${(year + 1).toString().slice(2)}`
        : `${year - 1}-${year.toString().slice(2)}`;

      const lastReturn: any[] = await tx.$queryRaw`
        SELECT invoiceNumber FROM Invoice
        WHERE shopId = ${user.shopId}
          AND invoiceNumber LIKE ${`RET-${dateStr}-%`}
        ORDER BY createdAt DESC LIMIT 1 FOR UPDATE
      `;

      let seq = 1;
      if (lastReturn.length > 0) {
        const parts = lastReturn[0].invoiceNumber.split('-');
        seq = parseInt(parts[parts.length - 1], 10) + 1;
      }

      const returnInvoiceNumber = `RET-${dateStr}-${seq.toString().padStart(6, '0')}`;

      const returnInvoice = await tx.invoice.create({
        data: {
          invoiceNumber: returnInvoiceNumber,
          idempotencyKey: `RET-${original.id}`,
          financialYear: original.financialYear,
          shopId: user.shopId,
          customerId: original.customerId,
          cashierId: user.userId,
          originalId: original.id,
          subtotal: original.subtotal,
          taxableAmount: original.taxableAmount,
          cgstAmount: original.cgstAmount,
          sgstAmount: original.sgstAmount,
          igstAmount: original.igstAmount,
          taxAmount: original.taxAmount,
          discountAmount: original.discountAmount,
          roundOffAmount: original.roundOffAmount,
          totalAmount: original.totalAmount,
          paidAmount: original.paidAmount,
          udharAmount: original.udharAmount,
          changeAmount: original.changeAmount,
          paymentMode: original.paymentMode,
          paymentRef: original.paymentRef,
          isInterState: original.isInterState,
          type: 'SALES_RETURN',
          status: 'COMPLETED',
          items: {
            create: original.items.map((item: any) => ({
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              quantity: item.quantity,
              unit: item.unit,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              mrp: item.mrp,
              discountPercent: item.discountPercent,
              gstRate: item.gstRate,
              cgstAmount: item.cgstAmount,
              sgstAmount: item.sgstAmount,
              igstAmount: item.igstAmount,
              totalAmount: item.totalAmount
            }))
          }
        }
      });

      // 5. Restore Inventory & Log
      for (const item of original.items) {
        const p = products.find((x: any) => x.id === item.productId);
        
        await tx.product.update({
          where: { id: item.productId },
          data: {
            currentStock: { increment: item.quantity }
          }
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            shopId: user.shopId,
            type: 'RETURN_IN',
            quantityBefore: p.currentStock,
            quantityChange: item.quantity,
            quantityAfter: new Prisma.Decimal(p.currentStock).plus(new Prisma.Decimal(item.quantity)),
            invoiceId: returnInvoice.id,
            notes: dto.reason ? `Return Reason: ${dto.reason} - ${dto.notes || ''}` : 'Sales Return',
            recordedById: user.userId
          }
        });

        // 5.5 Dual-write to InventoryItem and StockLedgerEntry
        let invItem = await tx.inventoryItem.findFirst({
          where: { shopId: user.shopId, productId: item.productId, locationId: 'DEFAULT' }
        });
        let oldOnHand = 0;
        if (invItem) {
          oldOnHand = invItem.onHand.toNumber();
          invItem = await tx.inventoryItem.update({
            where: { id: invItem.id },
            data: { onHand: { increment: item.quantity } }
          });
        } else {
          invItem = await tx.inventoryItem.create({
            data: {
              shopId: user.shopId,
              productId: item.productId,
              locationId: 'DEFAULT',
              onHand: item.quantity,
              status: 'AVAILABLE'
            }
          });
        }
        
        await tx.stockLedgerEntry.create({
          data: {
            shopId: user.shopId,
            inventoryItemId: invItem.id,
            movementType: 'SALE_RETURN',
            quantity: item.quantity,
            unitCost: p.costPrice,
            referenceType: 'INVOICE_RETURN',
            referenceId: returnInvoice.id,
            balanceAfter: oldOnHand + item.quantity,
            createdBy: user.userId
          }
        });
      }

      // 6. Ledger Reversal (if Udhar)
      if (original.paymentMode === 'UDHAR' && original.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: original.customerId } });
        
        await tx.customer.update({
          where: { id: original.customerId },
          data: {
            outstandingBalance: { decrement: original.udharAmount }
          }
        });

        await tx.udharTransaction.create({
          data: {
            customerId: original.customerId,
            shopId: user.shopId,
            invoiceId: returnInvoice.id,
            amount: original.udharAmount,
            type: 'ADJUSTMENT',
            balanceBefore: customer.outstandingBalance,
            balanceAfter: new Prisma.Decimal(customer.outstandingBalance).minus(new Prisma.Decimal(original.udharAmount)),
            recordedById: user.userId,
            notes: `Return against Invoice ${original.invoiceNumber}`
          }
        });
      }

      // 8. Ledger Double-Entry Reversal (ENG-302)
      const existingLedgers = await tx.ledgerTransaction.count({
        where: { invoiceId: returnInvoice.id }
      });
      if (existingLedgers === 0) {
        const creditAccount = original.paymentMode === 'UDHAR' || (original.udharAmount && original.udharAmount.toNumber() > 0)
          ? 'ACCOUNTS_RECEIVABLE' as const
          : 'CASH' as const;

        // Debit SALES_REVENUE
        const lastDebitEntry = await tx.ledgerTransaction.findFirst({
          where: { account: 'SALES_REVENUE' },
          orderBy: { createdAt: 'desc' }
        });
        const debitBalanceBefore = lastDebitEntry ? lastDebitEntry.balanceAfter.toNumber() : 0;
        const debitBalanceAfter = debitBalanceBefore - original.totalAmount.toNumber();

        await tx.ledgerTransaction.create({
          data: {
            shopId: user.shopId,
            invoiceId: returnInvoice.id,
            account: 'SALES_REVENUE',
            type: 'DEBIT',
            amount: original.totalAmount,
            balanceAfter: debitBalanceAfter,
            description: `Return ${original.invoiceNumber} - SALES_REVENUE Reversal`
          }
        });

        // Credit CASH / AR
        const lastCreditEntry = await tx.ledgerTransaction.findFirst({
          where: { account: creditAccount },
          orderBy: { createdAt: 'desc' }
        });
        const creditBalanceBefore = lastCreditEntry ? lastCreditEntry.balanceAfter.toNumber() : 0;
        const creditBalanceAfter = creditBalanceBefore - original.totalAmount.toNumber();

        await tx.ledgerTransaction.create({
          data: {
            shopId: user.shopId,
            invoiceId: returnInvoice.id,
            account: creditAccount,
            type: 'CREDIT',
            amount: original.totalAmount,
            balanceAfter: creditBalanceAfter,
            description: `Return ${original.invoiceNumber} - ${creditAccount} Reversal`
          }
        });
      }

      // 9. Shift update reversal
      if (original.shiftId) {
        if (original.paymentMode === 'SPLIT') {
          const cashPortion = original.paidAmount.toNumber();
          const udharPortion = original.udharAmount.toNumber();
          await tx.shift.update({
            where: { id: original.shiftId },
            data: {
              totalSales: { decrement: original.totalAmount.toNumber() },
              cashSales: { decrement: cashPortion },
              udharSales: { decrement: udharPortion },
            }
          });
        } else {
          const paymentFieldMap: Record<string, string> = {
            CASH: 'cashSales', UPI: 'upiSales', CARD: 'cardSales', UDHAR: 'udharSales',
          };
          const paymentField = paymentFieldMap[original.paymentMode] ?? 'cashSales';
          await tx.shift.update({
            where: { id: original.shiftId },
            data: {
              totalSales: { decrement: original.totalAmount.toNumber() },
              [paymentField]: { decrement: original.totalAmount.toNumber() }
            }
          });
        }
      }

      // 10. Outbox Event Integration
      const eventId = crypto.randomUUID();
      const correlationId = this.tenantContext.getCorrelationId();

      await tx.outboxEvent.create({
        data: {
          id: eventId,
          shopId: user.shopId,
          type: 'INVOICE_RETURNED',
          payload: {
            eventId,
            correlationId,
            invoiceId: returnInvoice.id,
            originalInvoiceId: original.id,
            shopId: user.shopId,
            openedById: user.userId,
            type: 'DEBIT',
            createdAt: new Date().toISOString(),
            amount: original.totalAmount.toNumber(),
            description: `Invoice ${original.invoiceNumber} returned`
          }
        }
      });

      // 11. Audit Log
      await tx.auditLog.create({
        data: {
          action: 'RETURN_CREATED',
          entity: 'INVOICE',
          entityId: returnInvoice.id,
          shopId: user.shopId,
          userId: user.userId,
          afterData: {
            originalInvoiceId: original.id,
            reason: dto.reason,
            refundAmount: original.totalAmount,
            paymentMode: original.paymentMode
          },
          ipAddress: user.ipAddress
        }
      });

      return returnInvoice;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10000
    });
  }
}




