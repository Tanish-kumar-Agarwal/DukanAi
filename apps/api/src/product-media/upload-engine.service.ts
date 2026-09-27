import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class UploadEngineService {
  /**
   * Validates file size and basic MIME type.
   */
  validateFile(file: UploadedFile, maxSizeBytes: number = 50 * 1024 * 1024) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(`File size exceeds maximum allowed size of ${maxSizeBytes / 1024 / 1024}MB`);
    }

    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml',
      'video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv', 'text/plain',
      'model/gltf-binary', 'model/obj'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported media type: ${file.mimetype}`);
    }

    // In a real Fortune 500 system, we'd also check magic bytes here 
    // using a library like 'file-type' to prevent spoofing.
    
    return true;
  }

  /**
   * Stores the file temporarily before deduplication logic or S3 upload.
   */
  async storeLocalTemporarily(file: UploadedFile): Promise<string> {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const tempFilePath = path.join(tempDir, `${uniqueSuffix}-${file.originalname}`);
    
    await fs.promises.writeFile(tempFilePath, file.buffer);
    
    return tempFilePath;
  }
}
