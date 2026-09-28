import { Role } from '@prisma/client';

/**
 * The role sets the authorization policy is written in (roadmap phase 1.2).
 * Spread them into `@Roles(...)`: `@Roles(...MANAGEMENT_ROLES)`.
 */

/** Owner-level administration: destructive or shop-wide operations. */
export const ADMIN_ROLES: readonly Role[] = [Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN];

/** Stock, ledger, purchasing, approvals, suppliers, warehouses, webhooks, events, invoices, expenses. */
export const MANAGEMENT_ROLES: readonly Role[] = [Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER];

/** Everything a cashier does at the counter, plus management. */
export const POS_ROLES: readonly Role[] = [Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER, Role.CASHIER];
