export type User = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'manager' | 'cashier' | 'owner';
  shopId: string;
};

export type Shop = {
  id: string;
  name: string;
  location: string;
  owner: string;
  phone: string;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  cost: number;
  quantity: number;
  category: string;
  image?: string;
  description?: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  udharAmount: number;
  totalSpent: number;
  lastPurchase?: string;
  creditLimit?: number;
  joinedAt?: string;
};

export type Invoice = {
  id: string;
  invoiceNo: string;
  customerId: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'udhar';
  status: 'draft' | 'completed' | 'paid' | 'pending';
  createdAt: string;
  dueDate?: string;
};

export type InvoiceItem = {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
};

export type DashboardStats = {
  totalSales: number;
  totalProfit: number;
  totalUdhar: number;
  lowStockItems: number;
  todayOrders: number;
  topCustomers: Customer[];
};

export type SalesData = {
  date: string;
  sales: number;
};

export type AnalyticsData = {
  period: 'daily' | 'weekly' | 'monthly';
  sales: SalesData[];
  products: ProductSalesData[];
  customers: CustomerAnalytics[];
};

export type ProductSalesData = {
  id: string;
  name: string;
  sales: number;
  revenue: number;
  quantity: number;
};

export type CustomerAnalytics = {
  id: string;
  name: string;
  spent: number;
  frequency: number;
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
  read: boolean;
};

export type Transaction = {
  id: string;
  invoiceNo: string;
  customerName: string;
  amount: number;
  method: string;
  status: string;
  timestamp: string;
};
