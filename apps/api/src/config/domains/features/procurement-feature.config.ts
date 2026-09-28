import { Injectable } from '@nestjs/common';
import { ConfigDomain, EnvVariable } from '../../registry/registry.decorators';
import { IsInt, Min } from 'class-validator';
import { IntegerFromEnv } from '../../hydrate-from-env';

/**
 * Delays of the procurement background processors. Hydrated with `hydrateFromEnv`: an unset or blank variable keeps the
 * default, `0` is a value where the bound allows it, and anything that is not
 * a number (or is out of bounds) fails boot.
 */
@Injectable()
@ConfigDomain({ owner: 'procurement', feature: 'ProcurementFeatureConfig', version: '1.1.0', description: 'Procurement module parameters' })
export class ProcurementFeatureConfig {
  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('VENDOR_BILL_PROCESSOR_DELAY_MS')
  vendorBillProcessorDelayMs: number = 2000;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('GRN_PROCESSOR_BARCODE_DELAY_MS')
  grnProcessorBarcodeDelayMs: number = 1500;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('GRN_PROCESSOR_ATTACHMENT_DELAY_MS')
  grnProcessorAttachmentDelayMs: number = 1000;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('SUPPLIER_CREDIT_PROCESSOR_DELAY_MS')
  supplierCreditProcessorDelayMs: number = 1000;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('PURCHASE_RETURN_PROCESSOR_DELAY_MS')
  purchaseReturnProcessorDelayMs: number = 2000;

  @IsInt()
  @Min(0)
  @IntegerFromEnv()
  @EnvVariable('PURCHASE_ATTACHMENT_PROCESSOR_DELAY_MS')
  purchaseAttachmentProcessorDelayMs: number = 2000;
}
