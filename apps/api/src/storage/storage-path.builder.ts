import * as path from 'path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageConfig } from '../config/domains/storage.config';
import { StorageCustomerDirectory } from './storage-security.constants';

@Injectable()
export class StoragePathBuilder {
  private readonly storageRoot: string;

  constructor(private storageConfig: StorageConfig) {
    // Resolved once: `secureJoin` compares absolute paths, and a relative
    // STORAGE_ROOT (the committed `./data/storage`) used to fail every upload
    // as a "traversal" because the resolved path never started with it.
    this.storageRoot = path.resolve(this.storageConfig.storageRoot || path.join(process.cwd(), 'data', 'storage'));
  }

  private sanitizeSegment(segment: string): string {
    if (!segment || typeof segment !== 'string') {
      throw new BadRequestException('Invalid path segment');
    }
    const sanitized = segment.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized) {
      throw new BadRequestException('Path segment contains invalid characters');
    }
    return sanitized;
  }

  private secureJoin(base: string, ...segments: string[]): string {
    const resolved = path.resolve(base, ...segments);
    // Anti-traversal check: the resolved path must be the base or live under it
    // (a plain prefix test would accept a sibling such as `<base>2`).
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new BadRequestException('Directory traversal detected');
    }
    return resolved;
  }

  /**
   * Root path for all data of a single tenant.
   * Format: data/storage/{shopId}
   */
  getShopRoot(shopId: string): string {
    const safeShopId = this.sanitizeSegment(shopId);
    return this.secureJoin(this.storageRoot, safeShopId);
  }

  /**
   * Path for a specific customer directory within a shop.
   * Format: data/storage/{shopId}/Customers/{customerId}/{category}
   */
  getCustomerDirectory(shopId: string, customerId: string, category: StorageCustomerDirectory | 'Profile'): string {
    const safeCustomerId = this.sanitizeSegment(customerId);
    const shopRoot = this.getShopRoot(shopId);
    return this.secureJoin(shopRoot, 'Customers', safeCustomerId, category);
  }

  /**
   * Path for tenant-specific system files.
   * Format: data/storage/{shopId}/System/{filename}
   */
  getSystemFile(shopId: string, filename: string): string {
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
    const shopRoot = this.getShopRoot(shopId);
    return this.secureJoin(shopRoot, 'System', safeFilename);
  }

  /**
   * Path for tenant-specific logs.
   * Format: data/storage/{shopId}/Logs/{filename}
   */
  getLogFile(shopId: string, filename: string): string {
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
    const shopRoot = this.getShopRoot(shopId);
    return this.secureJoin(shopRoot, 'Logs', safeFilename);
  }

  /**
   * Path for tenant backups.
   * Format: data/storage/{shopId}/Backups/{type}
   */
  getBackupDirectory(shopId: string, type: string): string {
    const safeType = this.sanitizeSegment(type);
    const shopRoot = this.getShopRoot(shopId);
    return this.secureJoin(shopRoot, 'Backups', safeType);
  }

  /**
   * Path for soft-deleted files.
   * Format: data/storage/{shopId}/Deleted/{targetFilename}
   */
  getDeletedFileTarget(shopId: string, originalFilename: string): string {
    const timestamp = Date.now();
    const randomHex = Math.random().toString(16).substring(2, 8);
    // Allow dots for extension
    const safeOriginal = originalFilename.replace(/[^a-zA-Z0-9_.-]/g, '');
    const ext = path.extname(safeOriginal);
    const targetFilename = `${timestamp}-${randomHex}${ext}`;
    const shopRoot = this.getShopRoot(shopId);
    return this.secureJoin(shopRoot, 'Deleted', targetFilename);
  }

  /**
   * Prefix for all S3 keys belonging to this tenant.
   * Format: {shopId}/{folder}
   */
  getS3Prefix(shopId: string, folder: string): string {
    const safeShopId = this.sanitizeSegment(shopId);
    const safeFolder = this.sanitizeSegment(folder);
    return `${safeShopId}/${safeFolder}`;
  }
}
