import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ListQueryDto, PagedList } from '../common/pagination';
import { ExpenseActor, ExpensesService } from './expenses.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { SafeUserDto } from '../users/dto/safe-user.dto';

@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** The recorder: a cash expense leaves their open drawer, and the audit row names them. */
  private actor(req: Request): ExpenseActor {
    const user = req.user as SafeUserDto;
    return { shopId: this.tenantContext.getShopId(), userId: user.id, ipAddress: req.ip ?? null };
  }

  @Get()
  @PagedList()
  findAll(@Query() query: ListQueryDto) {
    return this.expensesService.findAll(query);
  }

  /** This month's figures over every expense of the shop, not over the loaded page (roadmap 6.7). */
  @Get('summary')
  summary() {
    return this.expensesService.summary();
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(dto, this.actor(req));
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto, this.actor(req));
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.expensesService.softDelete(id, this.actor(req));
  }
}
