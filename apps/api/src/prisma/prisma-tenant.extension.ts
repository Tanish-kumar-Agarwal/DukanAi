import { Prisma } from '@prisma/client';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';

const tenantOwnedModels = new Set([
  'Category',
  'Product',
  'ProductBatch',
  'Supplier',
  'Expense',
  'Customer',
  'Shift',
  'Invoice',
  'UdharTransaction',
  'InventoryLog',
  'AuditLog',
  'PurchaseOrder',
  'Notification',
  'LedgerTransaction',
  'InventoryDriftLog',
  'ShopSettings',
]);

export function tenantExtension(tenantContextService: TenantContextService) {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Only enforce for tenant-owned models
            if (!model || !tenantOwnedModels.has(model)) {
              return query(args);
            }

            // Allow bypass for internal scripts / migrations
            if (tenantContextService.isSuperAdminBypass()) {
              return query(args);
            }

            let shopId: string;
            try {
              shopId = tenantContextService.getShopId();
            } catch (e) {
              // If there's no shopId and no bypass, we cannot proceed with a tenant-owned model query
              throw new InternalServerErrorException(
                `Missing tenant context for operation ${operation} on model ${model}`
              );
            }

            // Ensure args object exists
            args = args || ({} as any);

            const isCreateOperation = ['create', 'createMany'].includes(operation);
            
            // For operations that create records (data)
            if (isCreateOperation && (args as any).data) {
              const enforceData = (dataObj: any) => {
                if (dataObj.shopId && dataObj.shopId !== shopId) {
                  throw new ForbiddenException(`Cross-tenant violation: attempt to inject shopId ${dataObj.shopId}`);
                }
                dataObj.shopId = shopId;
              };

              if (Array.isArray((args as any).data)) {
                (args as any).data.forEach(enforceData);
              } else {
                enforceData((args as any).data);
              }
            }

            // For all operations that read/update/delete (where)
            const hasWhereClause = [
              'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 
              'findMany', 'update', 'updateMany', 'delete', 'deleteMany', 
              'upsert', 'count', 'aggregate', 'groupBy'
            ].includes(operation);

            if (hasWhereClause) {
              (args as any).where = (args as any).where || {};
              
              if ((args as any).where.shopId && (args as any).where.shopId !== shopId) {
                throw new ForbiddenException(`Cross-tenant violation: attempt to query shopId ${(args as any).where.shopId}`);
              }
              
              (args as any).where.shopId = shopId;
            }

            // For upsert, we also need to enforce 'create' payload
            if (operation === 'upsert' && (args as any).create) {
              if ((args as any).create.shopId && (args as any).create.shopId !== shopId) {
                throw new ForbiddenException(`Cross-tenant violation: attempt to inject shopId in upsert create`);
              }
              (args as any).create.shopId = shopId;
            }

            return query(args);
          },
        },
      },
    });
  });
}
