import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { WorkflowRepository } from './repositories/workflow.repository';
import { WorkflowDelegationService } from './services/workflow-delegation.service';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('procurement-workflows')
export class ProcurementWorkflowController {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly delegation: WorkflowDelegationService
  ) {}

  @Get('tasks/pending')
  async getPendingTasks(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string) {
    return this.repository.getUserTasks(shopId, actorId);
  }

  @Post('tasks/:taskId/approve')
  async approveTask(@CurrentShop() shopId: string, @Param('taskId') taskId: string, @CurrentUser('id') actorId: string, @Body() body: any) {
    return this.repository.processTaskDecision(shopId, taskId, actorId, 'APPROVE', body.comments, body.signature);
  }

  @Post('tasks/:taskId/reject')
  async rejectTask(@CurrentShop() shopId: string, @Param('taskId') taskId: string, @CurrentUser('id') actorId: string, @Body() body: any) {
    return this.repository.processTaskDecision(shopId, taskId, actorId, 'REJECT', body.comments);
  }

  @Post('delegations')
  async createDelegation(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() body: any) {
    return this.delegation.createDelegation(shopId, actorId, body.delegateUserId, new Date(body.startDate), new Date(body.endDate), body.notes);
  }

  @Get('definitions')
  async listDefinitions(@CurrentShop() shopId: string) {
    return this.repository.listDefinitions(shopId);
  }

  @Post('definitions')
  async createDefinition(@CurrentShop() shopId: string, @Body() body: any) {
    return this.repository.createDefinition(shopId, body);
  }
}
