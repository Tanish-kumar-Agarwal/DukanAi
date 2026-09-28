import { Injectable } from '@nestjs/common';
import { ConfigDomain, EnvVariable } from '../../registry/registry.decorators';
import { IsInt, Min } from 'class-validator';
import { IntegerFromEnv } from '../../hydrate-from-env';

/**
 * Event listing, outbox batch and webhook delivery settings. Hydrated with `hydrateFromEnv`: an unset or blank variable keeps the
 * default, `0` is a value where the bound allows it, and anything that is not
 * a number (or is out of bounds) fails boot.
 */
@Injectable()
@ConfigDomain({ owner: 'Events', feature: 'Events Domain', version: '1.1.0', description: 'Configuration for Universal Events Features' })
export class EventsFeatureConfig {
  @IsInt()
  @Min(1)
  @IntegerFromEnv()
  @EnvVariable('EVENTS_RECENT_LIMIT')
  recentEventsLimit: number = 100;

  @IsInt()
  @Min(1)
  @IntegerFromEnv()
  @EnvVariable('EVENTS_WEBHOOK_DELIVERY_LIMIT')
  webhookDeliveryLimit: number = 50;

  @IsInt()
  @Min(1)
  @IntegerFromEnv()
  @EnvVariable('EVENTS_OUTBOX_PROCESSOR_BATCH_SIZE')
  outboxProcessorBatchSize: number = 100;

  @IsInt()
  @Min(1000)
  @IntegerFromEnv()
  @EnvVariable('EVENTS_WEBHOOK_TIMEOUT_MS')
  webhookTimeoutMs: number = 10000;
}
