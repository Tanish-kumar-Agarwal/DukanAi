import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseReturnValidationService } from './purchase-return-validation.service';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('PurchaseReturnValidationService', () => {
  let service: PurchaseReturnValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseReturnValidationService],
    }).compile();

    service = module.get<PurchaseReturnValidationService>(PurchaseReturnValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject if grnLineId is missing', async () => {
    const tx = {} as Prisma.TransactionClient;
    await expect(service.validateReturnLines(tx, 'shop-1', [{ returnQuantity: 5 }]))
      .rejects.toThrow(BadRequestException);
  });

  it('should reject if returning more than accepted minus previously returned', async () => {
    const tx = {
      goodsReceiptLine: {
        findFirst: jest.fn().mockResolvedValue({ acceptedQuantity: 10 })
      },
      purchaseReturnLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { returnQuantity: 5 } })
      }
    } as unknown as Prisma.TransactionClient;

    await expect(service.validateReturnLines(tx, 'shop-1', [{ grnLineId: 'grn-1', returnQuantity: 6 }]))
      .rejects.toThrow(BadRequestException);
  });

  it('should allow if returning exactly remaining balance', async () => {
    const tx = {
      goodsReceiptLine: {
        findFirst: jest.fn().mockResolvedValue({ acceptedQuantity: 10 })
      },
      purchaseReturnLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { returnQuantity: 5 } })
      }
    } as unknown as Prisma.TransactionClient;

    await expect(service.validateReturnLines(tx, 'shop-1', [{ grnLineId: 'grn-1', returnQuantity: 5 }]))
      .resolves.toBeUndefined();
  });
});
