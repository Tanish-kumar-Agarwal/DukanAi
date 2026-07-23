'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { customersApi, type CustomerDetail } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-error';
import {
  ArrowLeft, Phone, MapPin, Calendar as CalendarIcon, MessageCircle, CreditCard,
  MoreVertical, ShoppingCart, Banknote, History, FileText, ShieldAlert,
  Eye, Download, Link as LinkIcon, PhoneCall, AlertCircle,
} from 'lucide-react';

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

function invoiceStatus(invoice: { udharAmount: number; paidAmount: number; totalAmount: number }) {
  if (invoice.udharAmount <= 0) return { label: 'Paid', className: 'bg-green-50 text-green-500' };
  if (invoice.paidAmount > 0) return { label: 'Partial', className: 'bg-orange-50 text-orange-500' };
  return { label: 'Pending', className: 'bg-red-50 text-red-500' };
}

export default function CustomerDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const customerId = Array.isArray(params.id) ? params.id[0] : params.id;

  const fetchCustomer = useCallback(() => {
    if (!customerId) return;
    setLoadError(null);
    customersApi
      .getDetail(customerId)
      .then(setCustomer)
      .catch((error) => {
        setLoadError(describeApiError(error, 'Loading customer (GET /customers/:id)'));
      });
  }, [customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !paymentAmount || Number(paymentAmount) <= 0) return;
    try {
      setSavingPayment(true);
      await customersApi.recordPayment(customer.id, {
        amount: Number(paymentAmount),
        mode: paymentMode,
        notes: paymentNotes || undefined,
      });
      toast(`₹${paymentAmount} payment recorded for ${customer.name}`, 'success');
      setIsPaymentModalOpen(false);
      setPaymentAmount('');
      setPaymentNotes('');
      fetchCustomer();
    } catch (err) {
      toast(describeApiError(err, 'Recording payment (POST /customers/:id/payments)'), 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  if (loadError) return <div className="p-10 text-center text-sm font-medium text-red-600">{loadError}</div>;
  if (!customer) return <div className="p-10 flex justify-center items-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8B5CF6]"></div></div>;

  const creditRatio = customer.creditLimit > 0 ? customer.udharAmount / customer.creditLimit : 0;
  const creditStatus =
    customer.udharAmount <= 0
      ? { label: 'Clear', className: 'text-green-600', hint: 'No pending udhaar' }
      : creditRatio < 0.5
        ? { label: 'Low Risk', className: 'text-green-600', hint: 'Well within credit limit' }
        : creditRatio < 1
          ? { label: 'Medium Risk', className: 'text-yellow-600', hint: 'Approaching credit limit' }
          : { label: 'High Risk', className: 'text-red-600', hint: 'Over credit limit' };

  const payments = customer.udharTransactions.filter((txn) => txn.type === 'PAYMENT');

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-10">

      {/* Back Button */}
      <button
        onClick={() => router.push('/customers')}
        className="flex items-center gap-2 text-sm font-bold text-gray-800 hover:text-[#8B5CF6] transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Customers
      </button>

      {/* Header Profile Section */}
      <div className="flex flex-col xl:flex-row justify-between items-start gap-6 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex gap-6 items-start">
          <img
            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${customer.name}`}
            alt={customer.name}
            className="w-24 h-24 rounded-full bg-gray-100 border-4 border-gray-50"
          />
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-800">{customer.name}</h1>
              <span className="bg-purple-50 text-[#8B5CF6] px-3 py-1 rounded-full text-xs font-bold border border-purple-100">
                {customer.totalSpent > 0 ? 'Regular Customer' : 'New Customer'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-500 mt-2">
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-gray-400" />
                {customer.phone || 'No phone recorded'}
              </div>
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-gray-400" />
                Customer ID: {customer.id.slice(-8).toUpperCase()}
              </div>
              <div className="flex items-center gap-2">
                <CalendarIcon size={14} className="text-gray-400" />
                Joined on: {formatDate(customer.createdAt)}
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-gray-400" />
                Address: {customer.address || 'Not recorded'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full xl:w-auto">
          <button onClick={() => toast(`WhatsApp Message opened for ${customer.phone}`, 'success')} className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 border border-green-500 text-green-600 rounded-xl text-sm font-bold hover:bg-green-50 transition-colors">
            <MessageCircle size={16} />
            Send WhatsApp
          </button>
          <button onClick={() => setIsPaymentModalOpen(true)} className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 text-[#8B5CF6] border border-purple-200 rounded-xl text-sm font-bold hover:bg-purple-100 transition-colors">
            <CreditCard size={16} />
            Add Payment
          </button>
          <button onClick={() => toast('Showing more actions', 'info')} className="flex items-center justify-center gap-2 px-3 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">
            More Actions <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card className="p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-purple-200 transition-colors">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-[#8B5CF6]">
              <ShoppingCart size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Purchases</p>
            <h3 className="text-xl font-bold text-gray-800">₹{customer.totalSpent.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-400 mt-1">All time</p>
          </div>
        </Card>

        <Card className="p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-green-200 transition-colors">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-500">
              <Banknote size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Paid</p>
            <h3 className="text-xl font-bold text-gray-800">₹{customer.totalPaid.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-400 mt-1">All time</p>
          </div>
        </Card>

        <Card className="p-4 border border-orange-100 shadow-sm flex flex-col justify-between bg-orange-50/30">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-500">
              <History size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Pending</p>
            <h3 className="text-xl font-bold text-gray-800">₹{customer.udharAmount.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-400 mt-1">Current udhaar</p>
          </div>
        </Card>

        <Card className="p-4 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-500">
              <CreditCard size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Credit Limit</p>
            <h3 className="text-xl font-bold text-gray-800">₹{customer.creditLimit.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-400 mt-1">Allowed udhaar</p>
          </div>
        </Card>

        <Card className="p-4 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500">
              <CalendarIcon size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Last Payment</p>
            <h3 className="text-[15px] font-bold text-gray-800 whitespace-nowrap">{formatDate(customer.lastPaymentAt)}</h3>
            <p className="text-[10px] text-gray-400 mt-1">{customer.lastPaymentAt ? 'Most recent' : 'No payments yet'}</p>
          </div>
        </Card>

        <Card className="p-4 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center text-yellow-500">
              <ShieldAlert size={16} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Credit Status</p>
            <h3 className={`text-[15px] font-bold whitespace-nowrap ${creditStatus.className}`}>{creditStatus.label}</h3>
            <p className="text-[10px] text-gray-400 mt-1">{creditStatus.hint}</p>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-gray-200">
        <button className="pb-3 text-sm font-bold text-[#8B5CF6] border-b-2 border-[#8B5CF6]">Overview</button>
        <button className="pb-3 text-sm font-bold text-gray-500 hover:text-gray-800">Invoices</button>
        <button className="pb-3 text-sm font-bold text-gray-500 hover:text-gray-800">Payments</button>
        <button className="pb-3 text-sm font-bold text-gray-500 hover:text-gray-800">Ledger</button>
        <button className="pb-3 text-sm font-bold text-gray-500 hover:text-gray-800">Notes & Reminders</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left Content Column */}
        <div className="xl:col-span-2 space-y-6">

          {/* Recent Orders / Invoices */}
          <Card className="p-0 overflow-hidden border border-gray-100 shadow-sm">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Recent Orders / Invoices</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50/50 text-gray-500 text-xs font-semibold border-b border-gray-100">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Invoice ID</th>
                    <th className="px-5 py-3">Total Amount</th>
                    <th className="px-5 py-3">Paid Amount</th>
                    <th className="px-5 py-3">Pending Amount</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {customer.invoices.map((invoice) => {
                    const status = invoiceStatus(invoice);
                    return (
                      <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-4">{formatDate(invoice.createdAt)}</td>
                        <td className="px-5 py-4 font-medium">{invoice.invoiceNumber}</td>
                        <td className="px-5 py-4">₹{invoice.totalAmount.toLocaleString('en-IN')}</td>
                        <td className="px-5 py-4">₹{invoice.paidAmount.toLocaleString('en-IN')}</td>
                        <td className="px-5 py-4">₹{invoice.udharAmount.toLocaleString('en-IN')}</td>
                        <td className="px-5 py-4"><span className={`${status.className} px-2.5 py-1 rounded-full text-[10px] font-bold`}>{status.label}</span></td>
                        <td className="px-5 py-4 flex gap-2">
                          <button className="text-[#8B5CF6] hover:bg-purple-50 p-1 rounded"><Eye size={16}/></button>
                          <button className="text-[#8B5CF6] hover:bg-purple-50 p-1 rounded"><Download size={16}/></button>
                        </td>
                      </tr>
                    );
                  })}
                  {customer.invoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
                        No invoices billed to this customer yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-gray-100 flex justify-center">
              <button className="text-[#8B5CF6] text-sm font-bold hover:underline">View All Invoices</button>
            </div>
          </Card>

          {/* Payment History */}
          <Card className="p-0 overflow-hidden border border-gray-100 shadow-sm">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Payment History</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {payments.map((txn) => (
                <div key={txn.id} className="p-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                      <Banknote size={16}/>
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">{formatDate(txn.createdAt, true)}</p>
                      <p className="text-xs text-gray-500">{txn.notes ?? 'Udhaar payment'}</p>
                    </div>
                  </div>
                  <div className="text-green-500 font-bold">₹{txn.amount.toLocaleString('en-IN')}</div>
                  <div className="text-xs text-gray-500 hidden sm:block">Balance after: ₹{txn.balanceAfter.toLocaleString('en-IN')}</div>
                  <div className="text-xs text-gray-500 hidden md:block">By: {txn.recordedBy?.name ?? '—'}</div>
                  <button className="text-gray-400 hover:text-gray-800"><MoreVertical size={16}/></button>
                </div>
              ))}
              {payments.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-500">
                  No udhaar payments recorded yet.
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-100 flex justify-center">
              <button className="text-[#8B5CF6] text-sm font-bold hover:underline">View All Payments</button>
            </div>
          </Card>

        </div>

        {/* Right Content Column */}
        <div className="xl:col-span-1 space-y-6">

          {/* Latest Invoices Thumbnail Grid */}
          <Card className="p-5 border border-gray-100 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-gray-800">Latest Invoices</h2>
              <button className="text-[#8B5CF6] text-xs font-bold hover:underline">View All</button>
            </div>

            {customer.invoices.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {customer.invoices.slice(0, 3).map((invoice) => {
                  const status = invoiceStatus(invoice);
                  return (
                    <div key={invoice.id} className="border border-gray-200 rounded-lg p-2 hover:border-[#8B5CF6] transition-colors cursor-pointer group">
                      <div className="bg-gray-50 h-24 mb-2 flex items-center justify-center rounded border border-gray-100 overflow-hidden relative">
                        <FileText size={22} className="text-gray-300" />
                      </div>
                      <p className="text-[10px] font-bold text-gray-800 truncate">{invoice.invoiceNumber}</p>
                      <p className="text-[9px] text-gray-500">{formatDate(invoice.createdAt)}</p>
                      <p className="text-[11px] font-bold text-gray-800">₹{invoice.totalAmount.toLocaleString('en-IN')}</p>
                      <span className={`${status.className} px-1.5 py-0.5 rounded text-[8px] font-bold inline-block mt-1`}>{status.label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-lg mb-4">
                Invoices will appear here after the first bill.
              </div>
            )}

            <button onClick={() => toast('Downloaded all invoices as PDF', 'success')} className="w-full flex items-center justify-center gap-2 py-2 border border-gray-200 rounded-lg text-sm font-bold text-[#8B5CF6] hover:bg-purple-50 transition-colors">
              <Download size={16} /> Download All Invoices (PDF)
            </button>
          </Card>

          {/* Notes Block */}
          <div className="bg-[#FFFDF0] border border-yellow-200 rounded-2xl p-5 shadow-sm relative">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <FileText size={16} className="text-yellow-600" />
                Notes
              </h2>
            </div>
            {customer.notes ? (
              <p className="text-sm text-gray-700 whitespace-pre-line">{customer.notes}</p>
            ) : (
              <p className="text-sm text-gray-500">No notes recorded for this customer.</p>
            )}
          </div>

          {/* Quick Actions */}
          <Card className="p-5 border border-gray-100 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <AlertCircle size={16} className="text-[#8B5CF6]" />
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => toast('WhatsApp reminder sent!', 'success')} className="flex items-center justify-center gap-2 py-2.5 border border-green-500 text-green-600 rounded-lg text-xs font-bold hover:bg-green-50 transition-colors">
                <MessageCircle size={14} /> Send WhatsApp Reminder
              </button>
              <button onClick={() => toast(`Calling ${customer.phone}...`, 'info')} className="flex items-center justify-center gap-2 py-2.5 border border-purple-200 text-[#8B5CF6] rounded-lg text-xs font-bold hover:bg-purple-50 transition-colors">
                <PhoneCall size={14} /> Call Customer
              </button>
              <button onClick={() => toast('Payment link sent via SMS', 'success')} className="flex items-center justify-center gap-2 py-2.5 border border-purple-200 text-[#8B5CF6] rounded-lg text-xs font-bold hover:bg-purple-50 transition-colors">
                <LinkIcon size={14} /> Send Payment Link
              </button>
              <button onClick={() => toast('Customer marked as High Risk', 'error')} className="flex items-center justify-center gap-2 py-2.5 border border-red-500 text-red-500 rounded-lg text-xs font-bold hover:bg-red-50 transition-colors">
                <ShieldAlert size={14} /> Mark as High Risk
              </button>
            </div>
          </Card>

        </div>
      </div>

      {/* Modals */}
      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title={`Record Payment - ${customer.name}`} size="sm">
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Amount Received (₹) *</label>
            <input
              required
              type="number"
              min="1"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="w-full mt-1 border rounded-lg p-2 text-lg font-bold"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full mt-1 border rounded-lg p-2">
              <option>Cash</option>
              <option>UPI</option>
              <option>Card</option>
              <option>Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes (Optional)</label>
            <textarea value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} className="w-full mt-1 border rounded-lg p-2" placeholder="e.g. Paid for last week's bill" rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-6">
            <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={savingPayment} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-green-500/30 disabled:opacity-60">
              {savingPayment ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
