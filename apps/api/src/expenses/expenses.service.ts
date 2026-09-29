import { Injectable, NotFoundException } from '@nestjs/common';
import { Expense, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { ListQueryDto, pageArgs, PagedResult } from '../common/pagination';

/** Shape the expenses page renders. */
export interface ExpenseView {
  id: string;
  description: string;
  category: string;
  amount: number;
  status: 'Paid' | 'Pending';
  mode: string;
  date: string;
}

function toView(expense: Expense): ExpenseView {
  return {
    id: expense.id,
    description: expense.description,
    category: expense.category,
    amount: Number(expense.amount),
    status: expense.isPaid ? 'Paid' : 'Pending',
    mode: expense.isPaid ? (expense.paymentMode ?? 'Cash') : 'Unpaid',
    date: expense.expenseDate.toISOString(),
  };
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Newest first, hard-capped page (roadmap 5.6). */
  async findAll(query?: ListQueryDto): Promise<PagedResult<ExpenseView>> {
    // shopId is injected by the tenant Prisma extension.
    const { skip, take } = pageArgs(query);
    const where = { isDeleted: false };
    const [expenses, total] = await Promise.all([
      this.prisma.expense.findMany({ where, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.expense.count({ where }),
    ]);
    return { items: expenses.map(toView), total, skip, take };
  }

  async create(dto: CreateExpenseDto): Promise<ExpenseView> {
    const isPaid = dto.isPaid ?? true;
    const expense = await this.prisma.expense.create({
      data: {
        // Scalar shopId (not shop.connect): the tenant Prisma extension
        // validates/injects shopId for tenant-owned models.
        shopId: this.tenantContext.getShopId(),
        description: dto.description,
        category: dto.category,
        amount: new Prisma.Decimal(dto.amount),
        isPaid,
        paymentMode: isPaid ? (dto.paymentMode ?? 'Cash') : null,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
      },
    });
    return toView(expense);
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseView> {
    await this.ensureExists(id);
    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.expenseDate !== undefined) data.expenseDate = new Date(dto.expenseDate);
    if (dto.isPaid !== undefined) {
      data.isPaid = dto.isPaid;
      data.paymentMode = dto.isPaid ? (dto.paymentMode ?? 'Cash') : null;
    } else if (dto.paymentMode !== undefined) {
      data.paymentMode = dto.paymentMode;
    }
    const expense = await this.prisma.expense.update({ where: { id }, data });
    return toView(expense);
  }

  async softDelete(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.expense.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  private async ensureExists(id: string): Promise<Expense> {
    const expense = await this.prisma.expense.findFirst({ where: { id, isDeleted: false } });
    if (!expense) {
      throw new NotFoundException(`Expense ${id} not found`);
    }
    return expense;
  }
}
