import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type AnalyticsRange = 'today' | 'week' | 'month' | 'year';

export interface AnalyticsPagePayload {
  kpis: {
    totalRevenue: number;
    netProfit: number;
    udharOutstanding: number;
    avgOrderValue: number;
    revenueChangePct: number | null;
    profitChangePct: number | null;
    aovChangePct: number | null;
  };
  revenueTrend: Array<{ date: string; sales: number }>;
  paymentModes: Array<{ name: string; value: number; amount: number }>;
  categorySales: Array<{ name: string; value: number; amount: number }>;
  topCustomers: Array<{ name: string; frequency: number; spent: number }>;
}

const RANGE_DAYS: Record<AnalyticsRange, number> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
};

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Aggregates live invoice data into the single payload the web analytics page
 * renders. All figures are computed directly from Invoice/InvoiceItem rows so
 * they never depend on background aggregation jobs having run.
 */
@Injectable()
export class AnalyticsPageService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(shopId: string, range: AnalyticsRange): Promise<AnalyticsPagePayload> {
    const days = RANGE_DAYS[range] ?? 7;
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);

    const [current, previous, udhar, trend, paymentModes, categorySales, topCustomers] =
      await Promise.all([
        this.revenueAndProfit(shopId, start, now),
        this.revenueAndProfit(shopId, prevStart, start),
        this.prisma.customer.aggregate({
          where: { isDeleted: false },
          _sum: { outstandingBalance: true },
        }),
        this.revenueTrend(shopId, start, now),
        this.paymentModes(shopId, start),
        this.categorySales(shopId, start),
        this.topCustomers(shopId, start),
      ]);

    const avgOrderValue = current.orders > 0 ? current.revenue / current.orders : 0;
    const prevAov = previous.orders > 0 ? previous.revenue / previous.orders : 0;

    return {
      kpis: {
        totalRevenue: current.revenue,
        netProfit: current.profit,
        udharOutstanding: Number(udhar._sum.outstandingBalance ?? 0),
        avgOrderValue: Math.round(avgOrderValue),
        revenueChangePct: pctChange(current.revenue, previous.revenue),
        profitChangePct: pctChange(current.profit, previous.profit),
        aovChangePct: pctChange(avgOrderValue, prevAov),
      },
      revenueTrend: trend,
      paymentModes,
      categorySales,
      topCustomers,
    };
  }

  private async revenueAndProfit(shopId: string, start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ revenue: Prisma.Decimal | null; profit: Prisma.Decimal | null; orders: bigint }>
    >`
      SELECT
        SUM(i.totalAmount) AS revenue,
        COUNT(*) AS orders,
        (
          SELECT SUM((ii.sellingPrice * (1 - ii.discountPercent / 100) - ii.costPrice) * ii.quantity)
          FROM InvoiceItem ii
          INNER JOIN Invoice iv ON iv.id = ii.invoiceId
          WHERE iv.shopId = ${shopId}
            AND iv.status = ${InvoiceStatus.COMPLETED}
            AND iv.isDeleted = false
            AND iv.createdAt >= ${start}
            AND iv.createdAt < ${end}
            AND ii.isDeleted = false
        ) AS profit
      FROM Invoice i
      WHERE i.shopId = ${shopId}
        AND i.status = ${InvoiceStatus.COMPLETED}
        AND i.isDeleted = false
        AND i.createdAt >= ${start}
        AND i.createdAt < ${end}
    `;
    const row = rows[0];
    return {
      revenue: Number(row?.revenue ?? 0),
      profit: Number(row?.profit ?? 0),
      orders: Number(row?.orders ?? 0),
    };
  }

  /** Chart-ready daily revenue series for the last `days` days, computed live. */
  async getTrendSeries(shopId: string, days: number) {
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return this.revenueTrend(shopId, start, now);
  }

  private async revenueTrend(shopId: string, start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; sales: Prisma.Decimal }>>`
      SELECT DATE_FORMAT(i.createdAt, '%Y-%m-%d') AS day, SUM(i.totalAmount) AS sales
      FROM Invoice i
      WHERE i.shopId = ${shopId}
        AND i.status = ${InvoiceStatus.COMPLETED}
        AND i.isDeleted = false
        AND i.createdAt >= ${start}
        AND i.createdAt < ${end}
      GROUP BY day
      ORDER BY day ASC
    `;
    const byDay = new Map(rows.map((r) => [r.day, Number(r.sales)]));

    // Fill missing days with 0 so the chart draws a continuous curve.
    const result: Array<{ date: string; sales: number }> = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const key = cursor.toISOString().split('T')[0];
      result.push({
        date: cursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        sales: byDay.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private async paymentModes(shopId: string, start: Date) {
    const groups = await this.prisma.invoice.groupBy({
      where: { status: InvoiceStatus.COMPLETED, isDeleted: false, createdAt: { gte: start } },
      by: ['paymentMode'],
      _sum: { totalAmount: true },
    });
    const total = groups.reduce((acc, g) => acc + Number(g._sum.totalAmount ?? 0), 0);
    return groups
      .map((g) => {
        const amount = Number(g._sum.totalAmount ?? 0);
        return {
          name: g.paymentMode as string,
          value: total > 0 ? Math.round((amount / total) * 100) : 0,
          amount,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }

  private async categorySales(shopId: string, start: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ name: string; total: Prisma.Decimal }>>`
      SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(ii.totalAmount) AS total
      FROM InvoiceItem ii
      INNER JOIN Invoice i ON i.id = ii.invoiceId
      INNER JOIN Product p ON p.id = ii.productId
      LEFT JOIN Category c ON c.id = p.categoryId
      WHERE i.shopId = ${shopId}
        AND i.status = ${InvoiceStatus.COMPLETED}
        AND i.isDeleted = false
        AND i.createdAt >= ${start}
        AND ii.isDeleted = false
      GROUP BY c.name
      ORDER BY total DESC
      LIMIT 6
    `;
    const total = rows.reduce((acc, r) => acc + Number(r.total), 0);
    return rows.map((r) => ({
      name: r.name,
      value: total > 0 ? Math.round((Number(r.total) / total) * 100) : 0,
      amount: Number(r.total),
    }));
  }

  private async topCustomers(shopId: string, start: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; frequency: bigint; spent: Prisma.Decimal }>
    >`
      SELECT cu.name AS name, COUNT(*) AS frequency, SUM(i.totalAmount) AS spent
      FROM Invoice i
      INNER JOIN Customer cu ON cu.id = i.customerId
      WHERE i.shopId = ${shopId}
        AND i.status = ${InvoiceStatus.COMPLETED}
        AND i.isDeleted = false
        AND i.createdAt >= ${start}
      GROUP BY cu.id, cu.name
      ORDER BY spent DESC
      LIMIT 5
    `;
    return rows.map((r) => ({
      name: r.name,
      frequency: Number(r.frequency),
      spent: Number(r.spent),
    }));
  }
}
