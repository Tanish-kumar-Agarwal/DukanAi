import { readFileSync } from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { RetentionConfig } from '../config/domains/retention.config';
import { classify, CANDIDATE_FIELD, erasableFields, gstRetentionEnds, inventory, NOT_PERSONAL, tenantModels } from './personal-data';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Roadmap 9.24: the personal-data inventory holds for the whole schema. */
describe('personal-data inventory', () => {
  const rows = inventory();

  it('every text or JSON column whose name could hold personal data is classified', () => {
    const unclassified = rows.filter((r) => CANDIDATE_FIELD.test(r.field) && r.cls === undefined).map((r) => `${r.model}.${r.field}`);
    expect(unclassified).toEqual([]);
  });

  it('every NOT_PERSONAL entry names a real column (a renamed column cannot hide behind a stale reason)', () => {
    const real = new Set(rows.map((r) => `${r.model}.${r.field}`));
    expect(Object.keys(NOT_PERSONAL).filter((key) => !real.has(key))).toEqual([]);
  });

  it('the core personal columns are erasable and credentials are secrets', () => {
    expect(classify('Customer', 'phone')).toBe('identity');
    expect(classify('User', 'password')).toBe('secret');
    expect(classify('AuditLog', 'afterData')).toBe('payload');
    expect(classify('AuditLog', 'ipAddress')).toBe('network');
    expect(classify('Invoice', 'notes')).toBe('freeText');
    expect(classify('LedgerTransaction', 'description')).toBe('keep');
    const erasable = erasableFields();
    expect(erasable.get('Customer')?.map((f) => f.field).sort()).toEqual(['address', 'city', 'email', 'name', 'notes', 'phone', 'tags']);
    // The ledger is immutable: nothing in it may need erasing.
    expect(erasable.get('LedgerTransaction')).toBeUndefined();
  });

  it('every tenant model has a key to page by and a shop column', () => {
    const models = tenantModels();
    expect(models.length).toBeGreaterThan(150);
    for (const m of models) expect({ model: m.name, keys: m.idColumns.length > 0 }).toEqual({ model: m.name, keys: true });
    // and the inventory covers each model holding a classified personal column
    const doc = readFileSync(path.join(REPO_ROOT, 'docs', 'privacy', 'DATA_INVENTORY.md'), 'utf8');
    const personalModels = new Set(rows.filter((r) => r.cls && r.cls !== 'keep').map((r) => r.model));
    const core = ['Shop', 'ShopSettings', 'User', 'Customer', 'Supplier', 'AuditLog', 'Invoice', 'UdharTransaction', 'SearchHistory', 'RefreshToken', 'LoginAttempt', 'Notification', 'Expense', 'MediaAsset', 'ImportJobRow', 'WebhookEndpoint'];
    for (const model of core) {
      expect({ model, personal: personalModels.has(model) }).toEqual({ model, personal: true });
      expect({ model, documented: doc.includes(`\`${model}\``) }).toEqual({ model, documented: true });
    }
  });

  it('the retention policy states the sweep defaults (docs/privacy/RETENTION_POLICY.md §1)', () => {
    const policy = readFileSync(path.join(REPO_ROOT, 'docs', 'privacy', 'RETENTION_POLICY.md'), 'utf8');
    const config = new RetentionConfig();
    const rows: Array<[string, number]> = [
      ['RETENTION_EXPIRED_TOKENS_DAYS', config.expiredTokensDays],
      ['RETENTION_OUTBOX_DONE_DAYS', config.outboxDoneDays],
      ['RETENTION_SEARCH_HISTORY_DAYS', config.searchHistoryDays],
      ['RETENTION_PRODUCT_EVENT_LOG_DAYS', config.productEventLogDays],
    ];
    for (const [variable, days] of rows) expect(policy).toMatch(new RegExp(`\\| \`${variable}\` \\| ${days} \\|`));
  });

  it('GST records are held until 31 December of the start year + 7 (72 months after the annual return is due)', () => {
    expect(gstRetentionEnds('2026-27').toISOString()).toBe('2033-12-31T23:59:59.000Z');
  });

  it('the DMMF still exposes what the inventory reads', () => {
    expect(Prisma.dmmf.datamodel.models.find((m) => m.name === 'Customer')).toBeDefined();
  });
});
