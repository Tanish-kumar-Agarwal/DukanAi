import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfig } from '../config/domains/ai.config';
import { OcrFeatureConfig } from '../config/domains/features/ocr-feature.config';

import { TenantContextService } from '../iam/tenant-context/tenant-context.service';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfig,
    private readonly ocrConfig: OcrFeatureConfig,
    private readonly tenantContext: TenantContextService
  ) {}

  async processDocument(fileBuffer: Buffer, documentType: string) {
    this.logger.log(`Starting real OCR processing via Gemini for document type: ${documentType}`);
    
    // Step 1: Base64 encode for Gemini
    const base64Image = fileBuffer.toString('base64');
    
    // Step 2: Extract structured JSON using Gemini 1.5
    const parsedData = await this.parseWithGemini(base64Image);
    
    // Step 3: Match items to real shop inventory using Fuzzy Search
    const matchedItems = await this.fuzzyMatchProducts(parsedData.items);
    
    return {
      success: true,
      message: 'Document successfully parsed and matched via AI',
      preview: {
        parsedData,
        matchedItems
      }
    };
  }

  private async parseWithGemini(base64Image: string): Promise<any> {
    this.logger.log('Sending image to Gemini API for direct OCR to JSON...');
    const apiKey = this.aiConfig.geminiApiKey;
    if (!apiKey) {
      throw new BadRequestException('OCR service requires GEMINI_API_KEY environment variable');
    }

    const prompt = `Analyze this handwritten or printed bill/invoice.
Extract all line items. Return ONLY a valid JSON array of objects, with no markdown formatting.
Each object must have exactly these keys:
- rawName: string (the name of the item)
- qty: number (quantity, default 1)
- price: number (price per unit)
Example: [{"rawName": "Maggi Noodles", "qty": 2, "price": 14.50}]`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } }
        ]
      }]
    };

    // ━━━ P1 FIX: Exponential backoff retry for transient Gemini failures ━━━
    const MAX_RETRIES = 3;
    const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.ocrConfig.timeoutMs);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text();
          if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
            const backoffMs = Math.pow(2, attempt) * (this.ocrConfig.backoffMs / 2);
            this.logger.warn(`Gemini returned ${response.status}, retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
          this.logger.error(`Gemini API Error (attempt ${attempt}/${MAX_RETRIES}):`, errBody);
          throw new BadRequestException('Failed to process document with AI model after retries');
        }

        const data = await response.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
          const items = JSON.parse(text);
          return { items: Array.isArray(items) ? items : [] };
        } catch {
          this.logger.error('Failed to parse Gemini output as JSON:', text);
          return { items: [] };
        }
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError' && attempt < MAX_RETRIES) {
          const backoffMs = Math.pow(2, attempt) * (this.ocrConfig.backoffMs / 2);
          this.logger.warn(`Gemini request timed out, retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        if (fetchErr instanceof BadRequestException) throw fetchErr;
        this.logger.error(`Gemini fetch error (attempt ${attempt}/${MAX_RETRIES}):`, fetchErr);
        throw new BadRequestException('Failed to connect to AI model after retries');
      }
    }

    throw new BadRequestException('Gemini OCR exhausted all retry attempts');
  }

  private async fuzzyMatchProducts(extractedItems: any[]): Promise<any[]> {
    this.logger.log('Running DB-backed text search against real inventory...');
    
    const shopId = this.tenantContext.getShopId();
    
    const matched = await Promise.all(extractedItems.map(async (item) => {
      const keywords = item.rawName.split(' ').filter((k: string) => k.length > 2);
      
      const whereClause: any = { shopId, isDeleted: false, isActive: true };
      if (keywords.length > 0) {
        whereClause.AND = keywords.map((kw: string) => ({
          name: { contains: kw, mode: 'insensitive' }
        }));
      } else {
        whereClause.name = { contains: item.rawName, mode: 'insensitive' };
      }

      const results = await this.prisma.product.findMany({
        where: whereClause,
        select: { id: true, name: true, sellingPrice: true },
        take: 3
      });

      if (results.length > 0) {
        // Simple client-side exact/best match tie-breaker
        const match = results.find(r => r.name.toLowerCase() === item.rawName.toLowerCase()) || results[0];
        return {
          ...item,
          matchedSku: match.id,
          matchedName: match.name,
          dbPrice: Number(match.sellingPrice),
          confidence: 0.95
        };
      }
      return {
        ...item,
        matchedSku: null,
        matchedName: null,
        dbPrice: null,
        confidence: 0.2
      };
    }));

    return matched;
  }
}
