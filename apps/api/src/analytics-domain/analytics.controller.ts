import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import { RevenueEngine } from './engines/revenue-engine';
import { ProfitMarginEngine } from './engines/profit-margin-engine';
import { TrendEngine } from './engines/trend-engine';
import { ForecastEngine } from './engines/forecast-engine';
import { AnalyticsCacheService } from './services/analytics-cache.service';
import { AnalyticsPageService } from './services/analytics-page.service';
import type { AnalyticsRange } from './services/analytics-page.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboard')
export class AnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenueEngine: RevenueEngine,
    private readonly profitMarginEngine: ProfitMarginEngine,
    private readonly trendEngine: TrendEngine,
    private readonly forecastEngine: ForecastEngine,
    private readonly cache: AnalyticsCacheService,
    private readonly analyticsPage: AnalyticsPageService,
  ) {}

  /**
   * Single payload backing the web Reports & Analytics page: KPIs, revenue
   * trend, payment-mode split, category sales, and top customers — all
   * computed live from invoices for the requested range.
   */
  @Get('analytics')
  getAnalyticsPage(
    @CurrentShop() shopId: string,
    @Query('range') range: AnalyticsRange = 'week',
  ) {
    return this.analyticsPage.getAnalytics(shopId, range);
  }

  @Get('kpis')
  async getDashboardKpis(@CurrentShop() shopId: string) {
    // Attempt cache hit
    const cached = await this.cache.getDashboardCache(shopId);
    if (cached) return cached;

    // Cache miss -> Derive
    const todayRevenue = await this.revenueEngine.getTodayRevenue(shopId);
    // Expand to YTD, MTD, etc.
    
    const kpiData = {
      todayRevenue,
      timestamp: new Date()
    };

    await this.cache.setDashboardCache(shopId, kpiData);
    return kpiData;
  }

  /** Single tenant-scoped source for dashboard cards and recent activity. */
  @Get('summary')
  async getDashboardSummary(@CurrentShop() shopId: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const completed = { shopId, status: InvoiceStatus.COMPLETED, isDeleted: false };
    const todayCompleted = { ...completed, createdAt: { gte: startOfToday, lte: endOfToday } };

    const [
      revenueAllTime,
      revenueToday,
      orderCountToday,
      totalInvoices,
      customerCount,
      productCount,
      recentInvoices,
      paymentGroups,
      udharAgg,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({ where: completed, _sum: { totalAmount: true } }),
      this.prisma.invoice.aggregate({ where: todayCompleted, _sum: { totalAmount: true } }),
      this.prisma.invoice.count({ where: todayCompleted }),
      this.prisma.invoice.count({ where: completed }),
      this.prisma.customer.count({ where: { shopId, isDeleted: false } }),
      this.prisma.product.count({ where: { shopId, isDeleted: false } }),
      this.prisma.invoice.findMany({
        where: completed,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, invoiceNumber: true, totalAmount: true, paymentMode: true, createdAt: true, customer: { select: { name: true } } },
      }),
      this.prisma.invoice.groupBy({ where: completed, by: ['paymentMode'], _sum: { totalAmount: true } }),
      this.prisma.customer.aggregate({ where: { shopId, isDeleted: false }, _sum: { outstandingBalance: true } }),
    ]);

    // Raw queries for profit today
    const profitTodayStats = await this.prisma.$queryRaw<{ profit: number }[]>`
      SELECT SUM((ii.sellingPrice * (1 - ii.discountPercent / 100) - ii.costPrice) * ii.quantity) as profit
      FROM InvoiceItem ii
      INNER JOIN Invoice iv ON iv.id = ii.invoiceId
      WHERE iv.shopId = ${shopId}
        AND iv.status = ${InvoiceStatus.COMPLETED}
        AND iv.isDeleted = false
        AND iv.createdAt >= ${startOfToday}
        AND iv.createdAt <= ${endOfToday}
        AND ii.isDeleted = false
    `;
    const todayProfit = Number(profitTodayStats[0]?.profit ?? 0);

    // Raw queries for inventory
    const inventoryStats = await this.prisma.$queryRaw<{ lowStock: bigint, outOfStock: bigint, totalValue: number }[]>`
      SELECT 
        SUM(CASE WHEN currentStock <= reorderPoint AND currentStock > 0 THEN 1 ELSE 0 END) as lowStock,
        SUM(CASE WHEN currentStock <= 0 THEN 1 ELSE 0 END) as outOfStock,
        SUM(currentStock * costPrice) as totalValue
      FROM Product 
      WHERE shopId = ${shopId} AND isDeleted = false
    `;

    const stats = inventoryStats[0] || { lowStock: 0n, outOfStock: 0n, totalValue: 0 };

    return {
      totalRevenue: Number(revenueAllTime._sum.totalAmount ?? 0),
      todaySales: Number(revenueToday._sum.totalAmount ?? 0),
      todayProfit: todayProfit,
      todayOrders: orderCountToday,
      totalOrders: totalInvoices,
      totalCustomers: customerCount,
      totalProducts: productCount,
      outstandingUdhar: Number(udharAgg._sum.outstandingBalance ?? 0),
      lowStockCount: Number(stats.lowStock),
      outOfStockCount: Number(stats.outOfStock),
      inventoryValue: Number(stats.totalValue ?? 0),
      recentInvoices: recentInvoices.map((invoice) => ({ ...invoice, totalAmount: Number(invoice.totalAmount) })),
      paymentModes: paymentGroups.map((group) => ({ mode: group.paymentMode, amount: Number(group._sum.totalAmount ?? 0) })),
    };
  }


  @Get('products')
  async getTopProducts(@CurrentShop() shopId: string, @Query('limit') limit: number = 10) {
    return this.profitMarginEngine.getTopProductsByProfit(shopId, Number(limit));
  }

  @Get('trends')
  async getRevenueTrends(@CurrentShop() shopId: string, @Query('days') days: number = 30) {
    // Computed live from invoices (not the background aggregation tables) so
    // the dashboard chart works without any aggregation job having run.
    return this.analyticsPage.getTrendSeries(shopId, Number(days));
  }

  @Get('forecast')
  async getRevenueForecast(@CurrentShop() shopId: string) {
    return this.forecastEngine.generateNextDayRevenueForecast(shopId);
  }

  @Post('export')
  async triggerExport(
    @CurrentShop() shopId: string,
    @CurrentUser() user: SafeUserDto,
    @Body() payload: { type: string, reportName: string },
  ) {
    // Injects an AnalyticsExportJob and queues it to BullMQ
    const job = await this.prisma.analyticsExportJob.create({
      data: {
        shopId,
        type: payload.type,
        reportName: payload.reportName,
        requestedById: user.id,
      }
    });

    // In a full impl, we emit to BullMQ here
    return { message: 'Export queued successfully.', jobId: job.id };
  }
}
