import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesEventPublisher } from '../../sales-events-domain/services/sales-event-publisher.service';
import { WorkflowEngineService } from '../services/workflow-engine.service';
import { WorkflowApprovalService } from '../services/workflow-approval.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';

@Injectable()
export class WorkflowRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly approval: WorkflowApprovalService,
    private readonly eventPublisher: SalesEventPublisher,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  async listDefinitions(shopId: string) {
    return this.prisma.workflowDefinition.findMany({
      where: { shopId, isActive: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } }
    });
  }

  async createDefinition(shopId: string, payload: any) {
    return this.prisma.$transaction(async (tx) => {
      const def = await tx.workflowDefinition.create({
        data: {
          shopId,
          name: payload.name,
          documentType: payload.documentType,
          conditions: payload.conditions,
          steps: {
            create: payload.steps.map((s: any, idx: number) => ({
              stepOrder: idx + 1,
              name: s.name,
              approverRole: s.approverRole,
              approverId: s.approverId,
              departmentId: s.departmentId,
              isParallel: s.isParallel || false,
              conditions: s.conditions,
              slaMinutes: s.slaMinutes
            }))
          }
        }
      });
      return def;
    });
  }

  async getUserTasks(shopId: string, userId: string) {
    return this.prisma.workflowTask.findMany({
      where: {
        shopId,
        status: 'PENDING',
        OR: [
          { assignedUserId: userId },
          { delegatedToUserId: userId }
        ]
      },
      include: { workflowInstance: true }
    });
  }

  async processTaskDecision(shopId: string, taskId: string, actorId: string, decision: 'APPROVE' | 'REJECT', comments?: string, signature?: string) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.workflowTask.findUnique({
        where: { id: taskId, shopId },
        include: { workflowInstance: true }
      });

      if (!task || task.status !== 'PENDING') throw new NotFoundException('Pending Task not found');
      if (task.workflowInstance.status !== 'ACTIVE') throw new NotFoundException('Workflow is not active');

      // 1. Process Individual Task
      const nextTaskStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.workflowTask.update({
        where: { id: taskId },
        data: {
          status: nextTaskStatus,
          comments,
          digitalSignature: signature,
          completedAt: new Date()
        }
      });

      await tx.workflowTimeline.create({
        data: {
          workflowInstanceId: task.workflowInstanceId,
          shopId,
          actorId,
          action: `TASK_${nextTaskStatus}`,
          notes: comments,
          metadata: { taskId }
        }
      });

      // 2. Evaluate Step & Instance State Machine
      await this.approval.evaluateWorkflowState(tx, shopId, task.workflowInstanceId, actorId);

      const updatedInstance = await tx.workflowInstance.findUnique({ where: { id: task.workflowInstanceId } });

      if (updatedInstance?.status === 'COMPLETED') {
         await this.eventPublisher.publish(tx, shopId, {
           eventType: 'WorkflowCompleted',
           aggregateId: updatedInstance.id,
           aggregateType: 'WorkflowInstance',
           payload: { documentId: this.extractDocumentId(updatedInstance) },
           actorId
         });
      }

      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private extractDocumentId(instance: any): string | null {
    return instance.purchaseOrderId || instance.goodsReceiptId || instance.vendorBillId || instance.purchaseReturnId || instance.supplierCreditId || null;
  }
}
