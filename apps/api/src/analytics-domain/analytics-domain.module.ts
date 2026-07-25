import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';

import { RevenueEngine } from './engines/revenue-engine';
import { ProfitMarginEngine } from './engines/profit-margin-engine';
import { TrendEngine } from './engines/trend-engine';
import { ForecastEngine } from './engines/forecast-engine';
import { AnalyticsCacheService } from './services/analytics-cache.service';
import { AnalyticsPageService } from './services/analytics-page.service';
import { AnalyticsAggregationWorker, AnalyticsExportWorker } from './workers/analytics-workers';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'analytics-aggregation-queue',
    }),
    BullModule.registerQueue({
      name: 'analytics-export-queue',
    }),
  ],
  controllers: [AnalyticsController],
  providers: [
    RevenueEngine,
    ProfitMarginEngine,
    TrendEngine,
    ForecastEngine,
    AnalyticsCacheService,
    AnalyticsPageService,
    AnalyticsAggregationWorker,
    AnalyticsExportWorker
  ],
  exports: [RevenueEngine, TrendEngine]
})
export class AnalyticsDomainModule {}
