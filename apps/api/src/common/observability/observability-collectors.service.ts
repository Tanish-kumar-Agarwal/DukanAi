import { Injectable, Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { promises as fs } from 'fs';
import * as path from 'path';
import { MonitoringConfig } from '../../config/domains/monitoring.config';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { queueInstances } from '../lifecycle/queue-readiness';
import { backupLastSuccessTimestampSeconds, outboxOldestPendingAgeSeconds, outboxRows, queueJobs } from './metrics';

const OUTBOX_STATUSES = ['PENDING', 'CLAIMED', 'PROCESSING', 'DONE', 'FAILED'] as const;
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** `<kind>.last-success`: the kind is lower-case letters only (dump, binlog, documents, offsite). */
const STATUS_FILE = /^([a-z]+)\.last-success$/;

/**
 * Gauges that are read, not counted (roadmap 7.6): outbox lag and depth from
 * the database, queue depth from BullMQ, and the backup jobs' last success
 * from the status files (roadmap 9.4). Refreshed on every scrape by
 * `MetricsController`, each source independently, so a Redis outage still
 * leaves the outbox figures current (and vice versa).
 */
@Injectable()
export class ObservabilityCollectorsService {
  private readonly logger = new Logger(ObservabilityCollectorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly modules: ModulesContainer,
    private readonly monitoring: MonitoringConfig,
  ) {}

  async refresh(): Promise<void> {
    await Promise.all([this.refreshOutbox(), this.refreshQueues(), this.refreshBackupStatus()]);
  }

  /**
   * One series per `<kind>.last-success` file in `BACKUP_STATUS_DIR`, valued
   * with the UTC time on its first line. The gauge is cleared before the
   * files are read, so a kind whose file disappears loses its series (and the
   * "never recorded" alert fires) instead of reporting a stale success
   * forever; an unreadable directory keeps the previous values and logs.
   */
  async refreshBackupStatus(): Promise<void> {
    const dir = this.monitoring.backupStatusDir?.trim();
    if (!dir) return;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      this.logger.warn(`Backup status not refreshed: cannot read ${dir}: ${(error as Error).message}`);
      return;
    }
    const found: Array<{ kind: string; seconds: number }> = [];
    for (const name of names) {
      const match = STATUS_FILE.exec(name);
      if (!match) continue;
      const kind = match[1];
      try {
        const firstLine = (await fs.readFile(path.join(dir, name), 'utf8')).split('\n')[0]?.trim() ?? '';
        const millis = Date.parse(firstLine);
        if (!Number.isFinite(millis)) {
          this.logger.warn(`Backup status ${name} has no readable time on its first line ("${firstLine.slice(0, 40)}")`);
          continue;
        }
        found.push({ kind, seconds: Math.floor(millis / 1000) });
      } catch (error) {
        this.logger.warn(`Backup status ${name} not read: ${(error as Error).message}`);
      }
    }
    backupLastSuccessTimestampSeconds.reset();
    for (const { kind, seconds } of found) backupLastSuccessTimestampSeconds.set({ kind }, seconds);
  }

  /** Outbox rows by status and the age of the oldest row still waiting (PENDING or CLAIMED). */
  async refreshOutbox(now: Date = new Date()): Promise<void> {
    try {
      const rows = await this.tenantContext.runAsSuperAdmin(async () => {
        const counts = await this.prisma.$queryRaw<Array<{ status: string; n: bigint | number }>>`
          SELECT status, COUNT(*) AS n FROM OutboxEvent GROUP BY status
        `;
        const oldest = await this.prisma.$queryRaw<Array<{ createdAt: Date | null }>>`
          SELECT MIN(createdAt) AS createdAt FROM OutboxEvent WHERE status IN ('PENDING', 'CLAIMED', 'PROCESSING')
        `;
        return { counts, oldest: oldest[0]?.createdAt ?? null };
      });
      const byStatus = new Map(rows.counts.map((r) => [r.status, Number(r.n)]));
      for (const status of OUTBOX_STATUSES) outboxRows.set({ status }, byStatus.get(status) ?? 0);
      outboxOldestPendingAgeSeconds.set(rows.oldest ? Math.max(0, (now.getTime() - new Date(rows.oldest).getTime()) / 1000) : 0);
    } catch (error) {
      this.logger.warn(`Outbox metrics not refreshed: ${(error as Error).message}`);
    }
  }

  /** Job counts per BullMQ queue, from the queue clients already open in this process. */
  async refreshQueues(): Promise<void> {
    const { queues } = queueInstances(this.modules);
    await Promise.all(
      queues.map(async (queue) => {
        try {
          const counts = await (queue as unknown as { getJobCounts(...states: string[]): Promise<Record<string, number>> }).getJobCounts(...QUEUE_STATES);
          for (const state of QUEUE_STATES) queueJobs.set({ queue: queue.name, state }, counts[state] ?? 0);
        } catch (error) {
          this.logger.warn(`Queue metrics for ${queue.name} not refreshed: ${(error as Error).message}`);
        }
      }),
    );
  }
}
