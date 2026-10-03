import { Prisma } from '@prisma/client';
import { GLOBAL_MODELS } from './tenant-scope';

/**
 * Data-model conventions (roadmap 8.1), read from the generated DMMF so a
 * schema edit that drops one of them fails here before it reaches a
 * migration: every tenant model is a Shop relation (the foreign key is the
 * isolation guard), every owning relation says what a delete does, no
 * implicit many-to-many table (no primary key, no shop column), stock
 * quantities share one width, free-text columns are TEXT, and money
 * defaults to the rupee.
 */
const models = Prisma.dmmf.datamodel.models;
const model = (name: string) => {
  const found = models.find((m) => m.name === name);
  if (!found) throw new Error(`model ${name} is not in the schema`);
  return found;
};

describe('schema conventions (roadmap 8.1)', () => {
  it('every model with a shopId column has a relation to Shop', () => {
    const missing = models
      .filter((m) => !GLOBAL_MODELS.has(m.name) && m.fields.some((f) => f.name === 'shopId'))
      .filter((m) => !m.fields.some((f) => f.kind === 'object' && f.type === 'Shop'))
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });

  it('every owning relation declares its onDelete action', () => {
    const silent = models.flatMap((m) =>
      m.fields
        .filter((f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0 && !f.relationOnDelete)
        .map((f) => `${m.name}.${f.name}`),
    );
    expect(silent).toEqual([]);
  });

  it('has no implicit many-to-many relation', () => {
    const implicit: string[] = [];
    for (const m of models) {
      for (const f of m.fields) {
        if (f.kind !== 'object' || !f.isList || !f.relationName || (f.relationFromFields?.length ?? 0) > 0) continue;
        const back = model(f.type).fields.find((b) => b.relationName === f.relationName && b.name !== f.name);
        if (back?.isList) implicit.push(`${m.name}.${f.name} <-> ${f.type}.${back.name}`);
      }
    }
    expect(implicit).toEqual([]);
  });

  it('the asset tag join model has a composite primary key and a shop column', () => {
    const join = model('MediaAssetTag');
    expect(join.primaryKey?.fields).toEqual(['assetId', 'tagId']);
    expect(join.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['assetId', 'tagId', 'shopId']));
    expect(join.fields.find((f) => f.name === 'asset')?.relationOnDelete).toBe('Cascade');
    expect(join.fields.find((f) => f.name === 'tag')?.relationOnDelete).toBe('Cascade');
  });

  it.each([
    ['Product', 'currentStock'],
    ['Product', 'totalUnitsSold'],
    ['ProductVariant', 'currentStock'],
    ['InventoryItem', 'onHand'],
    ['InventoryLog', 'quantityBefore'],
    ['InventoryLog', 'quantityChange'],
    ['InventoryLog', 'quantityAfter'],
    ['InventoryDriftLog', 'databaseValue'],
  ])('%s.%s is a Decimal(12, 3) stock quantity', (modelName, field) => {
    const column = model(modelName).fields.find((f) => f.name === field);
    expect(column?.nativeType).toEqual(['Decimal', ['12', '3']]);
  });

  it.each([
    ['Notification', 'message'],
    ['OutboxEvent', 'error'],
  ])('%s.%s is a TEXT column', (modelName, field) => {
    expect(model(modelName).fields.find((f) => f.name === field)?.nativeType).toEqual(['Text', []]);
  });

  it('every currency column defaults to INR', () => {
    const defaults = models.flatMap((m) => m.fields.filter((f) => f.name === 'currency').map((f) => `${m.name}=${String(f.default)}`));
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.filter((d) => !d.endsWith('=INR'))).toEqual([]);
  });

  it('VariantIdentity.sku is unique per shop', () => {
    expect(model('VariantIdentity').uniqueFields).toContainEqual(['shopId', 'sku']);
  });
});
