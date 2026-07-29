/**
 * Utility functions for the application
 */
import Decimal from 'decimal.js';

export const formatCurrency = (value: number, currency: string = '₹'): string => {
  return `${currency}${value.toLocaleString('en-IN')}`;
};

export const formatNumber = (value: number): string => {
  return value.toLocaleString('en-IN');
};

export const formatDate = (date: Date | string): string => {
  return new Date(date).toLocaleDateString('en-IN');
};

export const formatTime = (date: Date | string): string => {
  return new Date(date).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDateTime = (date: Date | string): string => {
  const d = new Date(date);
  return `${formatDate(d)} ${formatTime(d)}`;
};

export const calculatePercentage = (value: number, total: number): number => {
  if (!total) return 0;
  return new Decimal(value).div(total).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
};

export const calculateTax = (amount: number, taxRate: number = 5): number => {
  return new Decimal(amount).mul(taxRate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
};

export const calculateDiscount = (amount: number, discountPercentage: number): number => {
  return new Decimal(amount).mul(discountPercentage).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
};

export const truncateText = (text: string, maxLength: number = 50): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

export const generateInvoiceNumber = (): string => {
  return `INV-${Date.now().toString().slice(-6)}`;
};

export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const clsx = (...classes: (string | boolean | null | undefined)[]): string => {
  return classes.filter(Boolean).join(' ');
};
