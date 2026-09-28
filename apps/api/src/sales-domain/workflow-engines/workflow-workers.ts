import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WorkflowOrchestrator } from './workflow-orchestrator';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { jobContext, requireJobShop } from '../../iam/tenant-context/job-context';

@Injectable()
@Processor('sales-workflow-queue')
export class SalesWorkflowWorker extends WorkerHost {
  private readonly logger = new Logger(SalesWorkflowWorker.name);

  constructor(
    private readonly orchestrator: WorkflowOrchestrator,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /** Runs in the order's shop context (roadmap 4.1, audit P2-5). */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing workflow job ${job.id} of type ${job.name}`);
    const shopId = requireJobShop(job.data, job.name);
    return this.tenantContext.runWithContext(jobContext(shopId, job.id), () => this.transition(job, shopId));
  }

  private async transition(job: Job<any, any, string>, shopId: string): Promise<void> {
    const { orderId } = job.data as { orderId: string };

    switch (job.name) {
      case 'PROCESS_RESERVATION':
        // Integration point with InventoryReservationEngine
        this.logger.log(`Reserving stock for order ${orderId}`);
        await this.orchestrator.transitionState(shopId, orderId, 'RESERVED', 'SYSTEM');
        break;

      case 'PROCESS_PICKING':
        this.logger.log(`Starting picking for order ${orderId}`);
        await this.orchestrator.transitionState(shopId, orderId, 'PICKING', 'SYSTEM');
        break;

      case 'PROCESS_SHIPMENT':
        this.logger.log(`Shipping order ${orderId}`);
        await this.orchestrator.transitionState(shopId, orderId, 'SHIPPED', 'SYSTEM');
        break;
        
      default:
        this.logger.warn(`Unknown workflow job type: ${job.name}`);
    }
  }
}
