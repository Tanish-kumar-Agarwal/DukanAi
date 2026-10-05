/**
 * On-demand financial reconciliation from a checkout (roadmap 9.5).
 *
 *     npm run reconcile -- --shop <shopId> [--date YYYY-MM-DD] [--json]
 *
 * Runs the same engine as the nightly cron and `POST /reconciliation/run`
 * (`src/reconciliation/reconciliation-engine.ts`) for one shop and one
 * business day (today in the shop's timezone when `--date` is omitted),
 * records the run as a `ReconciliationRun` row with trigger CLI, prints every
 * check with its figures and drifts, and exits 0 when the books agree, 1 when
 * any check found drift, 2 on a usage or connection error. `--json` prints
 * the run as JSON instead of the report.
 *
 * Environment: `DATABASE_URL` (read from `.env.local` / `.env` in apps/api
 * when not already set, as the API does). The engine only reads; the one row
 * it writes is the run record. Nothing is corrected.
 */
import { parseArgs } from 'node:util';
import * as dotenv from 'dotenv';
import { Prisma, PrismaClient, ReconciliationRunStatus, ReconciliationTrigger } from '@prisma/client';
import { businessDateString, parseBusinessDate, safeTimeZone } from '../src/common/time/business-day';
import { reconcileBusinessDay, ReconciliationReport } from '../src/reconciliation/reconciliation-engine';

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
}

function parse(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      shop: { type: 'string' },
      date: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log('usage: reconcile --shop <shopId> [--date YYYY-MM-DD] [--json]');
    process.exit(0);
  }
  if (!values.shop) fail('--shop <shopId> is required');
  if (values.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) fail('--date must be YYYY-MM-DD');
  return { shopId: values.shop, date: values.date, json: values.json === true };
}

function print(report: ReconciliationReport, runId: string): void {
  const s = report.summary;
  console.log(`Reconciliation of ${report.businessDate} (${report.timeZone}), run ${runId}: ${report.status} (${report.driftCount} drift(s))`);
  console.log(
    `  ${s.sales.count} sale(s) ${s.sales.total}, ${s.returns.count} return(s) ${s.returns.total}, ${s.cancellations.count} cancellation(s) ${s.cancellations.total}, ${s.repayments.count} repayment(s) ${s.repayments.total}; net sales ${s.netSales}`,
  );
  console.log(`  tenders: cash ${s.tenders.CASH}, bank ${s.tenders.BANK}, credit ${s.tenders.UDHAR}; ${s.shiftsChecked} shift(s), ${s.itemsChecked} stock item(s), ${s.productsChecked} product(s)`);
  for (const check of report.checks) {
    const figures = Object.entries(check.figures)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`  ${check.status.padEnd(12)} ${check.name.padEnd(10)} ${figures}`);
    for (const note of check.notes) console.log(`               note: ${note}`);
    for (const d of check.drifts) {
      console.log(`               DRIFT ${d.subject}: ${d.detail}: expected ${d.expected}, actual ${d.actual}${d.difference ? ` (difference ${d.difference})` : ''}`);
    }
  }
}

async function main(): Promise<number> {
  dotenv.config({ path: '.env.local' });
  dotenv.config();
  const { shopId, date, json } = parse(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

  const prisma = new PrismaClient();
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, settings: { select: { timezone: true } } } });
    if (!shop) fail(`shop ${shopId} does not exist`);
    const timeZone = safeTimeZone(shop.settings?.timezone);
    const now = new Date();
    const businessDate = date ?? businessDateString(now, timeZone);
    const start = parseBusinessDate(businessDate, timeZone);
    if (!start) fail(`${businessDate} is not a calendar day`);
    if (start > now) fail(`${businessDate} has not started in ${timeZone}`);

    let report: ReconciliationReport;
    try {
      report = await reconcileBusinessDay(prisma, { shopId: shop.id, timeZone, businessDate, now });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      await prisma.reconciliationRun.create({
        data: { shopId: shop.id, businessDate, timeZone, trigger: ReconciliationTrigger.CLI, status: ReconciliationRunStatus.FAILED, checks: [], error: message.slice(0, 4000), startedAt: now, finishedAt: new Date() },
      });
      fail(`reconciliation failed: ${message}`);
    }
    const run = await prisma.reconciliationRun.create({
      data: {
        shopId: shop.id,
        businessDate,
        timeZone,
        trigger: ReconciliationTrigger.CLI,
        status: report.status === 'DRIFT' ? ReconciliationRunStatus.DRIFT : ReconciliationRunStatus.CLEAN,
        driftCount: report.driftCount,
        checks: report.checks as unknown as Prisma.InputJsonValue,
        summary: report.summary as unknown as Prisma.InputJsonValue,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
      },
    });
    if (json) console.log(JSON.stringify({ ...run, shop: { id: shop.id, name: shop.name } }, null, 2));
    else {
      console.log(`Shop ${shop.id} (${shop.name})`);
      print(report, run.id);
    }
    return report.status === 'DRIFT' ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => fail((error as Error).message ?? String(error)),
);
