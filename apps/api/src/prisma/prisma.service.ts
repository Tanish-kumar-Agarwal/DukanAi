import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { writeSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { tenantExtension } from './prisma-tenant.extension';
import { AppConfig, Environment } from '../config/domains/app.config';
import { PrismaConfig } from '../config/domains/prisma.config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    private readonly tenantContextService: TenantContextService,
    appConfig: AppConfig,
    prismaConfig: PrismaConfig,
  ) {
    const isProduction = appConfig.nodeEnv === Environment.Production;
    const logLevels = isProduction
      ? (prismaConfig.logLevelProduction || ['warn', 'error'])
      : (prismaConfig.logLevelDevelopment || ['query', 'info', 'warn', 'error']);

    super({
      log: logLevels.map(level => ({ emit: 'stdout', level })) as any,
    });

    const extended = this.$extends(tenantExtension(this.tenantContextService));

    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in extended) {
          return extended[prop as keyof typeof extended];
        }
        return target[prop as keyof typeof target];
      }
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
    await this.assertSchemaInSync();
  }

  /**
   * Startup guard against schema/database drift.
   *
   * Probes columns and tables that have historically drifted (e.g. the
   * Customer enterprise columns and the Expense table) with cheap queries.
   * When Prisma reports a missing table (P2021) or column (P2022), boot is
   * aborted with a loud, actionable message instead of letting every request
   * that touches the drifted model 500 at runtime.
   */
  private async assertSchemaInSync(): Promise<void> {
    try {
      await this.tenantContextService.runAsSuperAdmin(() =>
        Promise.all([
          this.customer.findFirst({ select: { id: true, type: true, kycStatus: true } }),
          this.supplier.findFirst({ select: { id: true, contactPerson: true, pendingPayables: true } }),
          this.expense.findFirst({ select: { id: true } }),
          this.notification.findFirst({ select: { id: true } }),
        ]),
      );
      this.logger.log('Database schema probe passed - schema and database are in sync');
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'P2021' || code === 'P2022') {
        const detail =
          code === 'P2021'
            ? 'a table defined in prisma/schema.prisma does not exist in the database'
            : 'a column defined in prisma/schema.prisma does not exist in the database';
        // Written straight to stderr, not through the Nest logger: `bufferLogs:
        // true` in main.ts discards buffered logs when bootstrap throws, which
        // would swallow exactly the message the operator needs to see.
        writeSync(
          2,
          [
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
            `SCHEMA DRIFT DETECTED: ${detail}.`,
            `Prisma error: ${(error as Error).message?.split('\n').pop()?.trim()}`,
            'Fix it by syncing the database with the schema:',
            '    cd apps/api && npx prisma db push',
            '(Ensure DATABASE_URL points at the right database first.)',
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
            '',
          ].join('\n'),
        );
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
