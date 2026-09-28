import type { TenantContext } from './tenant-context.interface';

/**
 * Tenant context for a queue job or event handler that names its shop. Run
 * the handler inside `tenantContext.runWithContext(jobContext(...), fn)` so
 * every Prisma query it makes is scoped to that shop (see tenant-scope.ts).
 */
export function jobContext(shopId: string, jobId: string | number | undefined, correlationId?: string): TenantContext {
  const id = `job-${jobId ?? 'unknown'}`;
  return { shopId, correlationId: correlationId ?? id, requestId: id };
}
