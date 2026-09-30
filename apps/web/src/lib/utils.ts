/**
 * Utility functions for the application
 */

export const formatCurrency = (value: number, currency: string = '₹'): string => {
  return `${currency}${value.toLocaleString('en-IN')}`;
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





export const clsx = (...classes: (string | boolean | null | undefined)[]): string => {
  return classes.filter(Boolean).join(' ');
};
