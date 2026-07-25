import apiClient from './api';
import type { Product, Customer } from '@/types';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
async function get<T>(url: string): Promise<T> {
  const { data } = await apiClient.get<T>(url);
  return data;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const { data } = await apiClient.post<T>(url, body);
  return data;
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const { data } = await apiClient.patch<T>(url, body);
  return data;
}

async function del(url: string): Promise<void> {
  await apiClient.delete(url);
}

/** Prisma Decimal fields serialize as strings ("12.50") — always coerce. */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Field mapping — backend Prisma shapes → frontend types
// ---------------------------------------------------------------------------

function mapProduct(raw: Record<string, unknown>): Product {
  return {
    id: raw.id as string,
    name: raw.name as string,
    sku: (raw.sku as string) ?? '',
    price: toNumber(raw.sellingPrice ?? raw.mrp),
    cost: toNumber(raw.costPrice),
    quantity: toNumber(raw.quantity ?? raw.currentStock),
    category: (raw.category as { name?: string } | undefined)?.name ?? (raw.category as string) ?? 'General',
    description: (raw.description as string) ?? undefined,
    image: ((raw.images as Array<{ url: string }>) ?? [])[0]?.url ?? (raw.image as string) ?? undefined,
  };
}

function mapCustomer(raw: Record<string, unknown>): Customer {
  return {
    id: raw.id as string,
    name: raw.name as string,
    phone: (raw.phone as string) ?? '',
    email: (raw.email as string) ?? '',
    address: (raw.address as string) ?? '',
    // Backend field is Customer.outstandingBalance (Prisma Decimal → string).
    udharAmount: toNumber(raw.outstandingBalance ?? raw.udharAmount ?? raw.outstandingUdhar),
    totalSpent: toNumber(raw.totalPurchases ?? raw.totalSpent),
    creditLimit: toNumber(raw.creditLimit, 0),
    joinedAt: (raw.createdAt as string) ?? undefined,
    lastPurchase: (raw.lastPurchaseAt as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const productsApi = {
  list: () =>
    get<unknown[]>('/products').then((arr) => arr.map((item) => mapProduct(item as Record<string, unknown>))),
  get: (id: string) =>
    get<Record<string, unknown>>(`/products/${id}`).then(mapProduct),

  create: (data: {
    name: string;
    sku: string;
    sellingPrice: number;
    costPrice: number;
    mrp: number;
    categoryId?: string;
    unit?: string;
  }) =>
    post<Record<string, unknown>>('/products', {
      ...data,
      unit: data.unit ?? 'PCS',
      mrp: data.mrp ?? data.sellingPrice,
      wholesalePrice: data.sellingPrice,
    }).then(mapProduct),

  update: (id: string, data: Record<string, unknown>) =>
    patch<Record<string, unknown>>(`/products/${id}`, data).then(mapProduct),

  delete: (id: string) => del(`/products/${id}`),
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export interface CustomerInvoiceSummary {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount: number;
  udharAmount: number;
  paymentMode: string;
  status: string;
  createdAt: string;
}

export interface CustomerUdharTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  notes: string | null;
  createdAt: string;
  recordedBy: { name: string } | null;
}

export interface CustomerDetail extends Customer {
  creditLimit: number;
  totalPaid: number;
  lastPaymentAt: string | null;
  createdAt: string | null;
  notes: string | null;
  invoices: CustomerInvoiceSummary[];
  udharTransactions: CustomerUdharTransaction[];
}

function mapCustomerDetail(raw: Record<string, unknown>): CustomerDetail {
  const invoices = ((raw.invoices as Array<Record<string, unknown>>) ?? []).map((invoice) => ({
    id: invoice.id as string,
    invoiceNumber: (invoice.invoiceNumber as string) ?? '',
    totalAmount: toNumber(invoice.totalAmount),
    paidAmount: toNumber(invoice.paidAmount),
    udharAmount: toNumber(invoice.udharAmount),
    paymentMode: (invoice.paymentMode as string) ?? '',
    status: (invoice.status as string) ?? '',
    createdAt: (invoice.createdAt as string) ?? '',
  }));
  const udharTransactions = ((raw.udharTransactions as Array<Record<string, unknown>>) ?? []).map(
    (txn) => ({
      id: txn.id as string,
      type: (txn.type as string) ?? '',
      amount: toNumber(txn.amount),
      balanceAfter: toNumber(txn.balanceAfter),
      notes: (txn.notes as string) ?? null,
      createdAt: (txn.createdAt as string) ?? '',
      recordedBy: (txn.recordedBy as { name: string } | null) ?? null,
    }),
  );
  return {
    ...mapCustomer(raw),
    creditLimit: toNumber(raw.creditLimit),
    totalPaid: toNumber(raw.totalPaid),
    lastPaymentAt: (raw.lastPaymentAt as string) ?? null,
    createdAt: (raw.createdAt as string) ?? null,
    notes: (raw.notes as string) ?? null,
    invoices,
    udharTransactions,
  };
}

export const customersApi = {
  list: () =>
    get<unknown[]>('/customers').then((arr) => arr.map((item) => mapCustomer(item as Record<string, unknown>))),
  get: (id: string) =>
    get<Record<string, unknown>>(`/customers/${id}`).then(mapCustomer),

  getDetail: (id: string) =>
    get<Record<string, unknown>>(`/customers/${id}`).then(mapCustomerDetail),

  create: (data: { name: string; phone?: string; email?: string; address?: string }) =>
    post<Record<string, unknown>>('/customers', data).then(mapCustomer),

  recordPayment: (id: string, data: { amount: number; mode?: string; notes?: string }) =>
    post<Record<string, unknown>>(`/customers/${id}/payments`, data).then(mapCustomer),
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export interface BatchItem {
  id: string;
  product: string;
  sku: string;
  batchNo: string;
  quantity: number;
  expDate: string | null;
  mfgDate: string | null;
  supplierLotNumber: string | null;
  status: string;
}

export const inventoryApi = {
  listBatches: () => get<BatchItem[]>('/batches'),

  listProducts: () => get<unknown[]>('/inventory/products'),
};

// ---------------------------------------------------------------------------
// Analytics — backed by the API's /dashboard controller
// ---------------------------------------------------------------------------
export interface DashboardSummary {
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  totalProducts: number;
  lowStockCount: number;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    paymentMode: string;
    createdAt: string;
    customer: { name: string } | null;
  }>;
  paymentModes: Array<{ mode: string; amount: number }>;
}

export interface TrendPoint {
  date: string;
  sales: number;
}

export type AnalyticsRange = 'today' | 'week' | 'month' | 'year';

export interface AnalyticsPagePayload {
  kpis: {
    totalRevenue: number;
    netProfit: number;
    udharOutstanding: number;
    avgOrderValue: number;
    revenueChangePct: number | null;
    profitChangePct: number | null;
    aovChangePct: number | null;
  };
  revenueTrend: TrendPoint[];
  paymentModes: Array<{ name: string; value: number; amount: number }>;
  categorySales: Array<{ name: string; value: number; amount: number }>;
  topCustomers: Array<{ name: string; frequency: number; spent: number }>;
}

export const analyticsApi = {
  dashboardSummary: () => get<DashboardSummary>('/dashboard/summary'),

  revenueTrend: (days = 30) => get<TrendPoint[]>(`/dashboard/trends?days=${days}`),

  analyticsPage: (range: AnalyticsRange = 'week') =>
    get<AnalyticsPagePayload>(`/dashboard/analytics?range=${range}`),
};

// ---------------------------------------------------------------------------
// Employees — API users mapped to the employees page shape
// ---------------------------------------------------------------------------
export interface EmployeeView {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string;
  shift: string;
  salary: number;
  advance: number;
  status: 'On Shift' | 'Off Shift' | 'On Leave';
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  SUPER_ADMIN: 'Owner',
  ADMIN: 'Manager',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  VIEWER: 'Stock Clerk',
};

export const employeesApi = {
  list: () =>
    get<Array<Record<string, unknown>>>('/users/employees').then((users) =>
      users.map(
        (user): EmployeeView => ({
          id: user.id as string,
          name: user.name as string,
          email: (user.email as string) ?? '',
          role: ROLE_LABELS[(user.role as string) ?? ''] ?? 'Cashier',
          phone: (user.phone as string) ?? '',
          shift: 'General',
          // Payroll is not modelled in the backend yet.
          salary: 0,
          advance: 0,
          status: user.isActive === false ? 'On Leave' : 'Off Shift',
        }),
      ),
    ),
};

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export interface SupplierView {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string | null;
  gstin: string | null;
  address: string | null;
  pendingPayables: number;
  lastDelivery: string | null;
  status: 'Active' | 'Inactive';
}

export const suppliersApi = {
  list: () => get<SupplierView[]>('/suppliers'),

  create: (data: {
    name: string;
    phone: string;
    contactPerson?: string;
    email?: string;
    gstin?: string;
    address?: string;
    openingBalance?: number;
  }) => post<SupplierView>('/suppliers', data),

  recordPayment: (id: string, amount: number) =>
    post<SupplierView>(`/suppliers/${id}/payments`, { amount }),

  update: (id: string, data: Record<string, unknown>) =>
    patch<SupplierView>(`/suppliers/${id}`, data),

  delete: (id: string) => del(`/suppliers/${id}`),
};

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export interface ExpenseView {
  id: string;
  description: string;
  category: string;
  amount: number;
  status: 'Paid' | 'Pending';
  mode: string;
  date: string;
}

export const expensesApi = {
  list: () => get<ExpenseView[]>('/expenses'),

  create: (data: {
    description: string;
    category: string;
    amount: number;
    isPaid?: boolean;
    paymentMode?: string;
    expenseDate?: string;
  }) => post<ExpenseView>('/expenses', data),

  update: (
    id: string,
    data: Partial<{
      description: string;
      category: string;
      amount: number;
      isPaid: boolean;
      paymentMode: string;
      expenseDate: string;
    }>,
  ) => patch<ExpenseView>(`/expenses/${id}`, data),

  delete: (id: string) => del(`/expenses/${id}`),
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export const notificationsApi = {
  list: () => get<NotificationView[]>('/notifications'),

  markRead: (id: string) => patch<NotificationView>(`/notifications/${id}/read`, {}),

  markAllRead: () => patch<{ updated: number }>('/notifications/read-all', {}),
};
