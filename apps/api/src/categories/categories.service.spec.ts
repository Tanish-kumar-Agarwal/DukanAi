import { BadRequestException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

describe('CategoriesService.update (roadmap 5.7)', () => {
  const tx = { category: { update: jest.fn() }, $executeRaw: jest.fn() };
  const prisma = {
    category: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const tenantContext = { getShopId: () => 'shop-1' };
  let service: CategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    service = new CategoriesService(prisma as never, tenantContext as never);
  });

  it('moves a category and re-roots its whole subtree with one UPDATE inside the same transaction', async () => {
    prisma.category.findFirst
      .mockResolvedValueOnce({ id: 'cat-1', parentId: 'old-parent', path: '/root/old-parent/', depth: 2, name: 'Drinks' })
      .mockResolvedValueOnce({ id: 'new-parent', path: '/', depth: 0 });
    tx.category.update.mockResolvedValue({ id: 'cat-1', path: '/new-parent/', depth: 1 });
    tx.$executeRaw.mockResolvedValue(7);

    const updated = await service.update('cat-1', { name: 'Drinks', parentId: 'new-parent' } as never);

    expect(updated).toEqual({ id: 'cat-1', path: '/new-parent/', depth: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.category.update).toHaveBeenCalledWith({ where: { id: 'cat-1' }, data: { name: 'Drinks', parentId: 'new-parent', path: '/new-parent/', depth: 1 } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...params] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = sql.join('?');
    expect(text).toMatch(/UPDATE `Category`/);
    expect(text).toMatch(/SET `path` = CONCAT\(\?, SUBSTRING\(`path`, CHAR_LENGTH\(\?\) \+ 1\)\)/);
    expect(text).toMatch(/`depth` = `depth` \+ \?/);
    expect(text).toMatch(/WHERE `shopId` = \?\s+AND `isDeleted` = 0\s+AND `path` LIKE \?/);
    // new prefix, old prefix, depth delta (1 - 2), shop, LIKE pattern on the old prefix
    expect(params).toEqual(['/new-parent/cat-1/', '/root/old-parent/cat-1/', -1, 'shop-1', '/root/old-parent/cat-1/%']);
    // Never one update per descendant.
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('escapes LIKE wildcards in the prefix', async () => {
    prisma.category.findFirst
      .mockResolvedValueOnce({ id: 'c_1', parentId: null, path: '/', depth: 0 })
      .mockResolvedValueOnce({ id: 'p%', path: '/', depth: 0 });
    tx.category.update.mockResolvedValue({ id: 'c_1', path: '/p%/', depth: 1 });
    tx.$executeRaw.mockResolvedValue(0);
    await service.update('c_1', { name: 'x', parentId: 'p%' } as never);
    const params = tx.$executeRaw.mock.calls[0].slice(1);
    expect(params[4]).toBe('/c\\_1/%');
    expect(params[0]).toBe('/p%/c_1/');
  });

  it('refuses a cycle and a self-parent before touching anything', async () => {
    prisma.category.findFirst.mockResolvedValueOnce({ id: 'cat-1', parentId: null, path: '/', depth: 0 });
    await expect(service.update('cat-1', { name: 'x', parentId: 'cat-1' } as never)).rejects.toBeInstanceOf(BadRequestException);
    prisma.category.findFirst
      .mockResolvedValueOnce({ id: 'cat-1', parentId: null, path: '/', depth: 0 })
      .mockResolvedValueOnce({ id: 'child', path: '/cat-1/', depth: 1 });
    await expect(service.update('cat-1', { name: 'x', parentId: 'child' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('a plain rename neither opens a transaction nor touches descendants', async () => {
    prisma.category.findFirst.mockResolvedValueOnce({ id: 'cat-1', parentId: 'p', path: '/p/', depth: 1 });
    prisma.category.update.mockResolvedValue({ id: 'cat-1', name: 'Renamed' });
    await expect(service.update('cat-1', { name: 'Renamed' } as never)).resolves.toEqual({ id: 'cat-1', name: 'Renamed' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
