import { Injectable } from '@nestjs/common';
import { ConfigDomain, EnvVariable } from '../../registry/registry.decorators';
import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { IntegerFromEnv, NumberFromEnv } from '../../hydrate-from-env';

/**
 * OCR matching and timing. Hydrated with `hydrateFromEnv`: an unset or blank variable keeps the
 * default, `0` is a value where the bound allows it, and anything that is not
 * a number (or is out of bounds) fails boot.
 */
@Injectable()
@ConfigDomain({ owner: 'ocr', feature: 'OcrFeatureConfig', version: '1.1.0', description: 'OCR module parameters' })
export class OcrFeatureConfig {
  /** Similarity (0..1) above which an OCR line is matched to a product. */
  @IsNumber()
  @Min(0)
  @Max(1)
  @NumberFromEnv()
  @EnvVariable('OCR_FUZZY_MATCH_THRESHOLD')
  fuzzyMatchThreshold: number = 0.4;

  @IsInt()
  @Min(1000)
  @IntegerFromEnv()
  @EnvVariable('OCR_TIMEOUT_MS')
  timeoutMs: number = 30000;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('OCR_BACKOFF_MS')
  backoffMs: number = 2000;
}
