export class InventoryError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = 'InventoryError';
  }
}

export class InsufficientStockError extends InventoryError {
  constructor(message: string, details?: any) {
    super('INSUFFICIENT_STOCK', message, details);
    this.name = 'InsufficientStockError';
  }
}

export class InventoryNotFoundError extends InventoryError {
  constructor(message: string, details?: any) {
    super('INVENTORY_NOT_FOUND', message, details);
    this.name = 'InventoryNotFoundError';
  }
}

export class NegativeStockBlockedError extends InventoryError {
  constructor(message: string, details?: any) {
    super('NEGATIVE_STOCK_BLOCKED', message, details);
    this.name = 'NegativeStockBlockedError';
  }
}

export class IdempotentConflictError extends InventoryError {
  constructor(message: string, details?: any) {
    super('IDEMPOTENT_CONFLICT', message, details);
    this.name = 'IdempotentConflictError';
  }
}


export class OptimisticLockConflictError extends InventoryError {
  constructor(message: string, details?: any) {
    super('OPTIMISTIC_LOCK_CONFLICT', message, details);
    this.name = 'OptimisticLockConflictError';
  }
}

export class TenantViolationError extends InventoryError {
  constructor(message: string, details?: any) {
    super('TENANT_VIOLATION', message, details);
    this.name = 'TenantViolationError';
  }
}

