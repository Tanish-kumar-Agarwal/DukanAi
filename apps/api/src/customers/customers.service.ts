import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerAuditService } from './services/customer-audit.service';
import { EventPublisherService } from '../events-domain/services/event-publisher.service';
import { CreateEnterpriseCustomerDto } from './dto/enterprise-customer.dto';
import { CustomerType, CustomerLifecycleStatus, KycStatus } from './domain/enums';
import { SalesFeatureConfig } from '../config/domains/features/sales-feature.config';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly customerRepository: CustomerRepository,
    private readonly auditService: CustomerAuditService,
    private readonly eventPublisher: EventPublisherService,
    private readonly salesFeatureConfig: SalesFeatureConfig
  ) {}

  async create(data: CreateEnterpriseCustomerDto | any) {
    try {
      this.logger.log(`Attempting to create customer: ${data.name}`);
      const shopId = this.tenantContext.getShopId();
      
      const newCustomer = await this.customerRepository.create({
        name: data.name,
        phone: data.phone,
        // Scalar shopId (not shop.connect): the tenant Prisma extension injects
        // shopId for tenant-owned models, and Prisma rejects both a relation
        // connect and the scalar FK in the same create.
        shopId,
        email: data.email || null,
        address: data.address || null,
        creditLimit: this.salesFeatureConfig.defaultCreditLimit,
        outstandingBalance: 0,
        type: data.type || CustomerType.RETAIL,
        lifecycleStatus: data.lifecycleStatus || CustomerLifecycleStatus.LEAD,
        kycStatus: KycStatus.PENDING,
        
        // Connect enterprise relations if provided
        profile: data.profile ? { create: data.profile } : undefined,
        addresses: data.addresses?.length ? { create: data.addresses } : undefined,
        contacts: data.contacts?.length ? { create: data.contacts } : undefined,
      });

      await this.auditService.logAction({
        customerId: newCustomer.id,
        action: 'CUSTOMER_CREATED',
        newPayload: newCustomer
      });

      await this.eventPublisher.publish(this.prisma, shopId, {
        type: 'customer.created',
        entityType: 'Customer',
        entityId: newCustomer.id,
        payload: {
          customerId: newCustomer.id,
          shopId: shopId,
          timestamp: new Date().toISOString()
        }
      });

      return newCustomer;
    } catch (error: any) {
      this.logger.error(`Error occurred while inserting into customer table: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findAll(skip?: number, take?: number) {
    const shopId = this.tenantContext.getShopId();
    return this.customerRepository.findAll(shopId, skip, take);
  }

  async findOne(id: string) {
    const shopId = this.tenantContext.getShopId();
    const customer = await this.customerRepository.findById(id, shopId);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /**
   * Records an udhaar repayment: decrements the outstanding balance, bumps
   * totalPaid/lastPaymentAt, and writes an UdharTransaction ledger row.
   */
  async recordPayment(id: string, amount: number, mode?: string, notes?: string) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be a positive number.');
    }
    const shopId = this.tenantContext.getShopId();
    const userId = this.tenantContext.getUserId();

    const customer = await this.customerRepository.findById(id, shopId);
    if (!customer) throw new NotFoundException('Customer not found');

    const balanceBefore = Number(customer.outstandingBalance);
    const balanceAfter = Math.max(0, balanceBefore - amount);

    const [updated] = await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id },
        data: {
          outstandingBalance: balanceAfter,
          totalPaid: { increment: amount },
          lastPaymentAt: new Date(),
        },
      }),
      this.prisma.udharTransaction.create({
        data: {
          shopId,
          customerId: id,
          type: 'PAYMENT',
          amount,
          balanceBefore,
          balanceAfter,
          notes: [mode ? `Mode: ${mode}` : null, notes].filter(Boolean).join(' — ') || null,
          recordedById: userId,
        },
      }),
    ]);

    await this.auditService.logAction({
      customerId: id,
      action: 'CUSTOMER_PAYMENT_RECORDED',
      newPayload: { amount, mode, balanceBefore, balanceAfter },
    });

    return updated;
  }

  async softDelete(id: string) {
    const shopId = this.tenantContext.getShopId();
    const deleted = await this.customerRepository.softDelete(id, shopId);
    
    await this.auditService.logAction({
      customerId: id,
      action: 'CUSTOMER_DELETED'
    });

    await this.eventPublisher.publish(this.prisma, shopId, {
      type: 'customer.deleted',
      entityType: 'Customer',
      entityId: id,
      payload: { customerId: id, shopId }
    });
    return deleted;
  }
}
