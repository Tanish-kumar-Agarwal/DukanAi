import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { CliUsageError } from './run-cli';
import { shopDataCommand, SHOP_DATA_USAGE } from './shop-data';

/** Roadmap 9.24: the operator command refuses an unsafe request before it touches the database. */
describe('shop-data command', () => {
  const lines: string[] = [];
  const connect = jest.fn(() => {
    throw new Error('the database must not be reached');
  });
  const command = shopDataCommand({ connect: connect as never, out: (l) => lines.push(l), env: {}, cwd: () => tmpdir(), now: () => new Date('2026-10-11T00:00:00Z') });

  beforeEach(() => {
    lines.length = 0;
    connect.mockClear();
  });

  it('prints its usage', async () => {
    await expect(command(['--help'])).resolves.toBe(0);
    expect(lines.join('\n')).toBe(SHOP_DATA_USAGE);
  });

  it.each([
    [[], /usage: shop-data/],
    [['drop', '--shop', 's1'], /usage: shop-data/],
    [['export'], /--shop <id> is required/],
    [['export', '--shop', 's1'], /--out <dir> is required/],
    [['erase', '--shop', 's1'], /--export <archive> is required/],
    [['erase', '--shop', 's1', '--export', '/x/dukaanai-export-OTHER-20261011T000000Z.tar.gz'], /this shop's export archive/],
    [['erase', '--shop', 's1', '--export', '/x/dukaanai-export-s1-20261011T000000Z.tar.gz'], /does not exist/],
    [['erase-customer', '--shop', 's1'], /--customer <id> is required/],
  ])('%j is refused with the reason', async (argv, reason) => {
    await expect(command(argv as string[])).rejects.toThrow(CliUsageError);
    await expect(command(argv as string[])).rejects.toThrow(reason);
    expect(connect).not.toHaveBeenCalled();
  });

  it('an export archive without its checksum sidecar is refused', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shop-data-cli-'));
    const archive = path.join(dir, 'dukaanai-export-s1-20261011T000000Z.tar.gz');
    writeFileSync(archive, 'x');
    await expect(command(['erase', '--shop', 's1', '--export', archive])).rejects.toThrow(/no .sha256 sidecar/);
    writeFileSync(`${archive}.sha256`, 'not-a-sum');
    await expect(command(['erase', '--shop', 's1', '--export', archive])).rejects.toThrow(/not a SHA-256 sidecar/);
    expect(connect).not.toHaveBeenCalled();
  });
});
