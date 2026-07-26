import { Injectable, Logger, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { DriftAlertService } from './drift-alert.service';
import { DriftStatus } from '@prisma/client';
import { InventoryFeatureConfig } from '../config/domains/features/inventory-feature.config';
import { CronConfig } from '../config/domains/cron.config';
import { CacheConfig } from '../config/domains/cache.config';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class InventoryReconService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InventoryReconService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private prisma: PrismaService,
    private cronLockService: CronLockService,
    private driftAlertService: DriftAlertService,
    private inventoryConfig: InventoryFeatureConfig,
    private cronConfig: CronConfig,
    private schedulerRegistry: SchedulerRegistry,
    private cacheConfig: CacheConfig,
  ) {}

  onApplicationBootstrap() {
    const job = new CronJob(this.cronConfig.inventoryReconCron, () => {
      this.handleCron();
    });
    this.schedulerRegistry.addCronJob('InventoryRecon', job);
    job.start();
  }

  // Run scheduled reconciliation
  async handleCron() {
    await this.cronLockService.withLock(
      'inventory-reconciliation',
      this.inventoryConfig.reconLockTtlMs, // Configured TTL
      async () => {
        await this.runReconciliation();
      }
    );
  }

  async runReconciliation() {
    this.logger.log({ event: 'inventory_reconciliation_started' });
    const startTime = Date.now();

    if (!this.redis) {
      this.logger.warn('Redis client unavailable. Skipping reconciliation.');
      return;
    }

    let productsChecked = 0;
    let driftsFound = 0;
    let driftsFixed = 0;

    const fifteenMinsAgo = new Date(Date.now() - this.inventoryConfig.reconLookbackMs);
    const batchSize = this.inventoryConfig.reconBatchSize;
    let skip = 0;

    try {
      while (true) {
        // Fetch from Prisma in batches
        const products = await this.prisma.product.findMany({
          where: {
            updatedAt: { gte: fifteenMinsAgo },
            isDeleted: false,
          },
          select: { id: true, shopId: true, currentStock: true },
          take: batchSize,
          skip: skip,
          orderBy: { id: 'asc' },
        });

        if (products.length === 0) break;

        productsChecked += products.length;

        // Fetch Redis values efficiently via pipeline
        const pipeline = this.redis.pipeline();
        products.forEach((p) => {
          pipeline.get(`stock:${p.shopId}:${p.id}`);
        });

        const redisResults = await pipeline.exec();

        // Compare and repair
        for (let i = 0; i < products.length; i++) {
          const product = products[i];
          const prismaStock = product.currentStock.toNumber();
          const [err, redisRaw] = redisResults![i];

          if (err) {
            this.logger.error(`Failed to read Redis stock for product ${product.id}`, err);
            continue;
          }

          if (redisRaw !== null) {
            const redisStock = parseFloat(redisRaw as string);

            // Compare: Case B (Different)
            if (redisStock !== prismaStock) {
              driftsFound++;
              
              const difference = Math.abs(prismaStock - redisStock);

              // 1. Structured Logging
              this.logger.warn({
                event: 'REDIS_STOCK_DRIFT',
                severity: 'WARN',
                shopId: product.shopId,
                productId: product.id,
                redisStock,
                databaseStock: prismaStock,
                difference,
                timestamp: new Date().toISOString(),
                correlationId: `drift-${Date.now()}-${product.id}`
              });

              // 2. Persistent Drift Audit Record (DETECTED)
              const driftLog = await this.prisma.inventoryDriftLog.create({
                data: {
                  shopId: product.shopId,
                  productId: product.id,
                  redisValue: redisStock,
                  databaseValue: prismaStock,
                  difference,
                  status: DriftStatus.DETECTED
                }
              });

              // 3. Attempt Redis Repair
              try {
                await this.redis.set(`stock:${product.shopId}:${product.id}`, prismaStock.toString(), 'EX', this.cacheConfig.inventoryDriftTtlSeconds);
                
                // Repair successful
                await this.prisma.inventoryDriftLog.update({
                  where: { id: driftLog.id },
                  data: {
                    status: DriftStatus.REPAIRED,
                    resolvedAt: new Date()
                  }
                });

                await this.driftAlertService.notifyCriticalDrift({
                  driftId: driftLog.id,
                  productId: product.id,
                  repairedValue: prismaStock
                });

                driftsFixed++;
              } catch (repairErr: any) {
                // Repair failed
                await this.prisma.inventoryDriftLog.update({
                  where: { id: driftLog.id },
                  data: {
                    status: DriftStatus.FAILED
                  }
                });

                await this.driftAlertService.notifyRepairFailure({
                  driftId: driftLog.id,
                  productId: product.id,
                  error: repairErr.message
                });
              }
            }
          }
        }

        skip += batchSize;
      }
    } catch (error: any) {
      this.logger.error('Database or Redis unavailable. Aborting reconciliation cleanly.', error);
    }

    const durationMs = Date.now() - startTime;

    this.logger.log({
      event: 'inventory_reconciliation_completed',
      productsChecked,
      driftsFound,
      driftsFixed,
      durationMs,
    });
  }
}
