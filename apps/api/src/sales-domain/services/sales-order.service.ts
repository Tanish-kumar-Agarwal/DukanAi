import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderValidationEngine } from './order-validation-engine';
import { OrderNumberEngine } from './order-number-engine';
import { SnapshotEngine } from './snapshot-engine';
import { SalesOrderStateMachine } from './sales-order-state-machine';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { EventPublisherService } from '../../events-domain/services/event-publisher.service';
import { SalesDomainEventType } from '../interfaces/sales-domain-events';

@Injectable()
export class SalesOrderService {
  private readonly logger = new Logger(SalesOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationEngine: OrderValidationEngine,
    private readonly orderNumberEngine: OrderNumberEngine,
    private readonly snapshotEngine: SnapshotEngine,
    private readonly stateMachine: SalesOrderStateMachine,
    private readonly eventPublisher: EventPublisherService
  ) {}

  async createOrder(shopId: string, tenantId: string | undefined, dto: CreateSalesOrderDto, actorId: string) {
    this.logger.log(`Creating Sales Order for shop ${shopId}`);

    // 1. Validate Business Rules
    await this.validationEngine.validateOrder(shopId, dto);

    // 2. Generate Transaction-Safe Order Number
    const orderNumber = await this.orderNumberEngine.generateOrderNumber(shopId);

    const productIds = dto.lines.map(l => l.productId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId },
      include: { variants: true }
    });

    const productMap = new Map(products.map(p => [p.id, p]));

    // 4. Execute Transaction (Outbox Pattern included)
    const result = await this.prisma.$transaction(async (tx) => {
      // 3. Calculate Financials securely
      let subTotal = 0;
      let taxTotal = 0;
      let discountTotal = 0;

      const serverLines = dto.lines.map(l => {
        const product = productMap.get(l.productId);
        if (!product) throw new Error(`Product ${l.productId} not found`);
        const variant = l.variantId ? product.variants.find(v => v.id === l.variantId) : null;

        const unitPrice = variant ? Number(variant.sellingPrice) : Number(product.sellingPrice);
        const discount = 0; // Configurable discount not provided safely, fallback to 0
        const taxRate = 0; // Tax engine should provide this, fallback to 0

        const lineNet = l.quantity * (unitPrice - discount);
        const lineTax = lineNet * (taxRate / 100);
        
        subTotal += lineNet;
        taxTotal += lineTax;
        discountTotal += discount * l.quantity;

        return {
          shopId,
          productId: l.productId,
          variantId: l.variantId,
          sku: variant?.sku || null,
          productName: product.name,
          quantity: l.quantity,
          unitPrice,
          discount,
          taxRate,
          lineTotal: lineNet
        };
      });

      const grandTotal = subTotal + taxTotal;

      // Create Core Order
      const order = await tx.salesOrder.create({
        data: {
          shopId,
          tenantId,
          orderNumber,
          customerId: dto.customerId,
          status: 'DRAFT',
          subTotal,
          taxTotal,
          discountTotal,
          grandTotal,
          createdBy: actorId,
          lines: {
            create: serverLines
          }
        },
        include: { lines: true }
      });

      // Status History
      await tx.salesOrderStatusHistory.create({
        data: {
          orderId: order.id,
          shopId,
          newStatus: 'DRAFT',
          actorId
        }
      });

      // Audit Log
      await tx.salesOrderAudit.create({
        data: {
          orderId: order.id,
          shopId,
          field: 'CREATED',
          actorId
        }
      });

      // Publish Outbox Event
      await this.eventPublisher.publish(
        tx,
        shopId,
        {
          type: SalesDomainEventType.SalesOrderCreated,
          entityType: 'SalesOrder',
          entityId: order.id,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            totalAmount: order.grandTotal.toString(),
            lines: order.lines.map(l => ({
              productId: l.productId,
              variantId: l.variantId,
              quantity: l.quantity.toString(),
              unitPrice: l.unitPrice.toString()
            }))
          }
        }
      );

      // 5. Asynchronous Snapshotting moved inside TX to preserve audit integrity
      await this.snapshotEngine.createSnapshotsBulk(order.id, shopId, dto.lines, tx);

      return order;
    });

    return result;
  }
}
