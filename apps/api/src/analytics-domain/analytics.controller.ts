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
    const completed = { shopId, status: InvoiceStatus.COMPLETED, isDeleted: false };
    const [revenue, orderCount, customerCount, productCount, lowStockCount, recentInvoices, paymentGroups] = await Promise.all([
      this.prisma.invoice.aggregate({ where: completed, _sum: { totalAmount: true } }),
      this.prisma.invoice.count({ where: completed }),
      this.prisma.customer.count({ where: { shopId, isDeleted: false } }),
      this.prisma.product.count({ where: { shopId, isDeleted: false } }),
      this.prisma.product.count({ where: { shopId, isDeleted: false, currentStock: { lte: 10 } } }),
      this.prisma.invoice.findMany({
        where: completed,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, invoiceNumber: true, totalAmount: true, paymentMode: true, createdAt: true, customer: { select: { name: true } } },
      }),
      this.prisma.invoice.groupBy({ where: completed, by: ['paymentMode'], _sum: { totalAmount: true } }),
    ]);

    return {
      totalRevenue: Number(revenue._sum.totalAmount ?? 0),
      totalOrders: orderCount,
      totalCustomers: customerCount,
      totalProducts: productCount,
      lowStockCount,
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
