import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { StoragePathBuilder } from './storage-path.builder';
import { StorageConfig } from '../config/domains/storage.config';
import { StorageCustomerDirectory } from './storage-security.constants';

function builder(storageRoot?: string): StoragePathBuilder {
  const config = Object.assign(new StorageConfig(), { storageRoot });
  return new StoragePathBuilder(config);
}

describe('StoragePathBuilder', () => {
  it('accepts a relative STORAGE_ROOT (the committed `./data/storage`)', () => {
    const dir = builder('./data/storage').getCustomerDirectory('shop1', 'Walk-in', StorageCustomerDirectory.Bills);
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toBe(path.resolve('./data/storage', 'shop1', 'Customers', 'Walk-in', StorageCustomerDirectory.Bills));
  });

  it('defaults to <cwd>/data/storage', () => {
    expect(builder(undefined).getShopRoot('shop1')).toBe(path.resolve(process.cwd(), 'data', 'storage', 'shop1'));
  });

  it('strips path characters from ids so a segment can never leave its directory', () => {
    const dir = builder('/srv/store').getCustomerDirectory('shop1', '../../etc', StorageCustomerDirectory.Bills);
    expect(dir).toBe(path.join('/srv/store', 'shop1', 'Customers', 'etc', StorageCustomerDirectory.Bills));
    expect(() => builder('/srv/store').getShopRoot('../')).toThrow(BadRequestException);
  });

  it('refuses a file name that resolves outside the shop root', () => {
    expect(() => builder('/srv/store').getSystemFile('shop1', '../../..')).not.toThrow();
    // Sibling-prefix bypass: `/srv/store2` starts with `/srv/store` but is not under it.
    const b = builder('/srv/store') as unknown as { secureJoin(base: string, ...segments: string[]): string };
    expect(() => b.secureJoin('/srv/store', '../store2')).toThrow(BadRequestException);
    expect(b.secureJoin('/srv/store', '.')).toBe('/srv/store');
  });
});
