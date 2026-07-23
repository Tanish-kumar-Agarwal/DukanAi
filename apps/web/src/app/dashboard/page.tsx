'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  TrendingUp, Package, ShoppingBag, Users, Plus, 
  FileText, Database, ChevronDown, AlertCircle, 
  Search, Mic, Receipt, Sparkles
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { analyticsApi, customersApi, productsApi, type DashboardSummary, type TrendPoint } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-error';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

const TIME_RANGE_DAYS: Record<string, number> = {
  'Today': 1,
  'This Week': 7,
  'This Month': 30,
  'This Year': 365,
};

const NoTrendData = () => (
  <div className="mt-4 flex h-[180px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 text-center text-sm text-gray-500">
    Sales trend data will appear once invoices are recorded for the selected period.
  </div>
);


export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  
  const [productSearch, setProductSearch] = useState('magi');
  const [isProductSearchFocused, setIsProductSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [timeSelection, setTimeSelection] = useState('This Week');
  const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
  const timeDropdownRef = useRef<HTMLDivElement>(null);

  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof productsApi.list>>>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState('5000');
  const [newUdhar, setNewUdhar] = useState('0');

  useEffect(() => {
    fetchProducts();
    fetchCustomers();
    void analyticsApi
      .dashboardSummary()
      .then(setSummary)
      .catch((err) => {
        describeApiError(err, 'Loading dashboard summary (GET /dashboard/summary)');
        setSummary(null);
      });
  }, []);

  useEffect(() => {
    void analyticsApi
      .revenueTrend(TIME_RANGE_DAYS[timeSelection] ?? 7)
      .then(setTrend)
      .catch((err) => {
        describeApiError(err, 'Loading sales trend (GET /dashboard/trends)');
        setTrend([]);
      });
  }, [timeSelection]);
  
  const fetchProducts = async () => {
    try {
      setProductsLoading(true);
      setProductsError(null);
      const data = await productsApi.list();
      setProducts(data);
    } catch (err) {
      console.error('Error fetching products', err);
      setProductsError('Failed to load products.');
    } finally {
      setProductsLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      setCustomers(await customersApi.list());
    } catch (err) {
      console.error("Error fetching customers", err);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsProductSearchFocused(false);
      }
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(e.target as Node)) {
        setIsTimeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'Create Bill': router.push('/billing'); break;
      case 'Add Product': router.push('/products'); break;
      case 'Add Customer': setIsAddCustomerModalOpen(true); break;
      case 'Customer Udhar': router.push('/customers'); break;
      case 'Low Stock': router.push('/inventory?tab=low-stock'); break;
      case 'Expenses': router.push('/expenses'); break;
      case 'AI Assistant': router.push('/ai-assistant'); break;
      case 'Reports': router.push('/analytics'); break;
      case 'Database Manager': router.push('/database'); break;
    }
  };

  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;
    
    try {
      await customersApi.create({
        name: newName,
        phone: newPhone,
        email: newEmail || undefined,
        address: newAddress || undefined,
      });

      toast('Customer added successfully', 'success');
      setIsAddCustomerModalOpen(false);
      setNewName(''); setNewPhone(''); setNewEmail(''); setNewAddress(''); setNewCreditLimit('5000'); setNewUdhar('0');
      fetchCustomers();
    } catch (error) {
      toast(describeApiError(error, 'Saving customer (POST /customers)'), 'error');
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(productSearch.toLowerCase()) || 
    p.sku.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, 5);
  
  if (productsLoading) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-gray-500">Loading products...</p>
      </div>
    );
  }
  
  if (productsError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>{productsError}</span>
          <button
            onClick={fetchProducts}
            className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Total Sales */}
        <Card className="hoverable p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center text-[#8B5CF6]">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Sales</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">₹{(summary?.totalRevenue ?? 0).toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">Completed invoices</p>
          </div>
        </Card>

        {/* Total Profit */}
        <Card className="hoverable p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Profit</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">—</h3>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">Profit reporting is not configured</p>
          </div>
        </Card>

        {/* Total Udhar */}
        <Card className="hoverable p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
            <Users size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Udhar (Pending)</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">₹{customers.reduce((total, customer) => total + customer.udharAmount, 0).toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">Current customer balances</p>
          </div>
        </Card>

        {/* Low Stock Items */}
        <Card className="hoverable p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
            <Package size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Low Stock Items</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">{summary?.lowStockCount ?? 0}</h3>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">From current inventory</p>
          </div>
        </Card>

        {/* Today's Orders */}
        <Card className="hoverable p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Today's Orders</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">{summary?.totalOrders ?? 0}</h3>
            <p className="text-[10px] text-gray-500 font-medium mt-0.5">Completed invoices</p>
          </div>
        </Card>
      </div>

      {/* Main Grid: Chart + Quick Actions + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Sales Chart */}
        <Card className="lg:col-span-6 p-5 relative">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-gray-800">Sales Overview</h3>
            <div ref={timeDropdownRef} className="relative z-20">
              <div 
                onClick={() => setIsTimeDropdownOpen(!isTimeDropdownOpen)}
                className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
              >
                {timeSelection} <ChevronDown size={14} className={`transition-transform ${isTimeDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
              
              <AnimatePresence>
                {isTimeDropdownOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-1 bg-white border border-gray-100 shadow-xl rounded-xl z-50 overflow-hidden w-32"
                  >
                    {['Today', 'This Week', 'This Month', 'This Year'].map((option) => (
                      <button
                        key={option}
                        onClick={() => {
                          setTimeSelection(option);
                          setIsTimeDropdownOpen(false);
                          toast(`Showing data for ${option}`, 'info');
                        }}
                        className={`w-full text-left text-xs px-4 py-2 hover:bg-purple-50 transition-colors ${timeSelection === option ? 'font-bold text-[#8B5CF6] bg-purple-50/50' : 'text-gray-600'}`}
                      >
                        {option}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          {trend.some((point) => point.sales > 0) ? (
            <div className="mt-2 h-[190px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={6} minTickGap={24} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(val: number) => `₹${val >= 1000 ? `${Math.round(val / 100) / 10}k` : val}`} />
                  <RechartsTooltip formatter={(value: number) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Sales']} />
                  <Area type="monotone" dataKey="sales" name="Sales" stroke="#8B5CF6" strokeWidth={2.5} fillOpacity={1} fill="url(#dashboardTrendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <NoTrendData />
          )}
        </Card>

        {/* Quick Actions */}
        <Card className="lg:col-span-3 p-5 bg-gray-50/50">
          <h3 className="font-bold text-gray-800 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: FileText, label: 'Create Bill', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
              { icon: Package, label: 'Add Product', color: 'text-green-500', bg: 'bg-green-500/10' },
              { icon: Users, label: 'Add Customer', color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { icon: Users, label: 'Customer Udhar', color: 'text-orange-500', bg: 'bg-orange-500/10' },
              { icon: Package, label: 'Low Stock', color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { icon: FileText, label: 'Expenses', color: 'text-pink-500', bg: 'bg-pink-500/10' },
              { icon: Sparkles, label: 'AI Assistant', color: 'text-blue-600', bg: 'bg-blue-600/10', badge: 'Beta' },
              { icon: FileText, label: 'Reports', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
              { icon: Database, label: 'Database Manager', color: 'text-teal-500', bg: 'bg-teal-500/10' }
            ].map((action, i) => (
              <div 
                key={i} 
                onClick={() => handleQuickAction(action.label)}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer group text-center h-[76px] relative"
              >
                {action.badge && <span className="absolute -top-2 -right-1 bg-blue-100 text-blue-600 text-[8px] font-bold px-1 rounded">{action.badge}</span>}
                <div className={`w-8 h-8 rounded-full ${action.bg} ${action.color} flex items-center justify-center mb-1 group-hover:scale-110 transition-transform`}>
                  <action.icon size={14} />
                </div>
                <span className="text-[9px] font-semibold text-gray-600 leading-tight">{action.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Customers */}
        <Card className="lg:col-span-3 p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-800 text-[15px]">Top Customers (Udhar)</h3>
            <span onClick={() => router.push('/customers')} className="text-xs text-[#8B5CF6] font-semibold cursor-pointer">View All</span>
          </div>
          <div className="space-y-4">
            {customers.filter(c => c.udharAmount > 0).sort((a, b) => b.udharAmount - a.udharAmount).slice(0, 5).map((c, i) => (
              <div key={i} onClick={() => router.push(`/customers/${c.id}`)} className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-1 -mx-1 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${c.name}`} className="w-8 h-8 rounded-full bg-gray-100" alt="avatar" />
                  <div>
                    <p className="text-xs font-bold text-gray-800">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.phone}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-red-500">₹{c.udharAmount.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-red-400">Due</p>
                </div>
              </div>
            ))}
            {customers.filter(c => c.udharAmount > 0).length === 0 && (
              <p className="text-xs text-gray-500 py-2 text-center">No pending udhar</p>
            )}
            <button 
              onClick={() => setIsAddCustomerModalOpen(true)}
              className="w-full mt-2 py-2 rounded-lg border border-[#8B5CF6]/30 text-[#8B5CF6] text-xs font-bold flex items-center justify-center gap-1 hover:bg-[#8B5CF6]/5 transition-colors">
              <Plus size={14} /> Add New Customer
            </button>
          </div>
        </Card>

      </div>

      {/* Lower Middle Grid: Search + Low Stock + AI + Recent Tx */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Smart Product Search */}
        <Card className="lg:col-span-3 p-5 relative" ref={searchContainerRef}>
          <h3 className="font-bold text-gray-800 text-[15px] mb-3">Smart Product Search</h3>
          <div className="relative mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B5CF6]" />
              <input 
                type="text" 
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onFocus={() => setIsProductSearchFocused(true)}
                className="w-full bg-[#8B5CF6]/10 text-[#8B5CF6] font-semibold text-sm rounded-lg pl-8 pr-16 py-2 outline-none border border-[#8B5CF6]/30" 
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                <span className="text-[8px] bg-green-100 text-green-600 px-1 py-0.5 rounded font-bold">Fuzzy Match ON</span>
              </div>
            </div>
            <button 
              onClick={() => toast('Voice search activated — say a product name', 'info')}
              className="p-2 rounded-lg bg-[#8B5CF6] text-white hover:bg-[#7C3AED] transition-colors"
            >
              <Mic size={14} />
            </button>
          </div>
          
          <AnimatePresence>
            {isProductSearchFocused && productSearch && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute left-0 right-0 top-[110px] bg-white border border-gray-100 shadow-xl rounded-xl z-50 overflow-hidden"
              >
                {filteredProducts.length > 0 ? (
                  <div className="py-2">
                    {filteredProducts.map((p, i) => (
                      <button 
                        key={i} 
                        onClick={() => router.push(`/billing?product=${p.id}`)}
                        className="w-full flex items-center justify-between text-xs px-4 py-2 hover:bg-purple-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 bg-purple-100 text-purple-600 rounded-sm flex items-center justify-center text-[10px]">P</div>
                          <span className="font-semibold text-gray-700">{p.name}</span>
                        </div>
                        <span className="font-bold text-gray-800">₹{p.price}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4 text-center text-sm text-gray-500">
                    No products found.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3 mt-4">
            {filteredProducts.slice(0, 3).map((product) => (
              <button key={product.id} onClick={() => router.push(`/billing?product=${product.id}`)} className="flex w-full items-center justify-between text-left text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-purple-100 text-purple-600 rounded-sm flex items-center justify-center text-[10px]">P</div>
                  <span className="font-semibold text-gray-700">{product.name}</span>
                </div>
                <span className="font-bold text-gray-800">₹{product.price}</span>
              </button>
            ))}
            {filteredProducts.length === 0 && <p className="py-2 text-center text-xs text-gray-500">No matching products.</p>}
            <button onClick={() => router.push('/products')} className="w-full mt-2 pt-3 border-t border-gray-100 text-[#8B5CF6] text-xs font-bold flex items-center gap-1 hover:text-[#7C3AED] transition-colors">
              <Plus size={14} /> Add product
            </button>
          </div>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="lg:col-span-3 p-5 relative">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-800 text-[15px]">Low Stock Alerts</h3>
            <span onClick={() => router.push('/products')} className="text-xs text-[#8B5CF6] font-semibold cursor-pointer">View All</span>
          </div>
          <div className="space-y-4">
            {products.filter((product) => product.quantity <= 10).slice(0, 4).map((product) => {
              const critical = product.quantity <= 5;
              return <div key={product.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500"><Package size={15} /></div>
                  <div>
                    <p className="text-xs font-bold text-gray-800">{product.name}</p>
                    <p className="text-[10px] text-gray-500">Stock: {product.quantity} pcs</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${critical ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>{critical ? 'Critical' : 'Low'}</span>
              </div>;
            })}
            {products.filter((product) => product.quantity <= 10).length === 0 && <p className="py-2 text-center text-xs text-gray-500">No low-stock products.</p>}
          </div>
        </Card>

        {/* AI Business Insights */}
        <Card className="lg:col-span-3 p-5 bg-gradient-to-br from-[#EEF2FF] to-[#F3E8FF] border-[#8B5CF6]/20 relative overflow-hidden">
          <h3 className="font-bold text-gray-800 text-[15px] flex items-center gap-2 mb-4">
            AI Business Insights <span className="bg-[#8B5CF6]/20 text-[#8B5CF6] text-[10px] px-1.5 py-0.5 rounded">Beta</span>
          </h3>
          <div className="space-y-3 relative z-10">
            <div className="flex gap-2 items-start bg-white/60 p-2 rounded-lg text-[11px] font-medium text-gray-700 backdrop-blur-sm border border-white">
              <Sparkles size={14} className="text-[#8B5CF6] mt-0.5 flex-shrink-0" />
              <span>No AI insights have been generated for this shop yet.</span>
            </div>
            <button onClick={() => router.push('/ai-assistant')} className="bg-[#8B5CF6] text-white text-[11px] font-bold px-4 py-2 rounded-lg mt-2 flex items-center gap-1 shadow-lg shadow-[#8B5CF6]/30">
              Ask AI Assistant &rarr;
            </button>
          </div>
        </Card>

        {/* Recent Transactions */}
        <Card className="lg:col-span-3 p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-800 text-[15px]">Recent Transactions</h3>
            <span className="text-xs text-[#8B5CF6] font-semibold cursor-pointer">View All</span>
          </div>
          <div className="space-y-4">
            {(summary?.recentInvoices ?? []).map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-100 text-blue-500"><Receipt size={14} /></div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-800">{invoice.customer?.name ?? 'Walk-in customer'} ({invoice.paymentMode})</p>
                    <p className="text-[10px] text-gray-400">#{invoice.invoiceNumber}</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-green-500">₹{invoice.totalAmount.toLocaleString('en-IN')}</span>
              </div>
            ))}
            {summary && summary.recentInvoices.length === 0 && <p className="text-xs text-gray-500">No transactions yet.</p>}
            <button className="w-full text-center mt-2 pt-3 border-t border-gray-100 text-[#8B5CF6] text-[11px] font-bold flex items-center justify-center gap-1">
              See All Transactions &rarr;
            </button>
          </div>
        </Card>

      </div>

      {/* Bottom Row Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <Card className="p-5">
          <h3 className="font-bold text-gray-800 text-[15px] mb-4">Category Sales</h3>
          <p className="text-sm text-gray-500">Category sales will be shown when invoice-category reporting is available.</p>
        </Card>

        {/* Payment Modes */}
        <Card className="p-5">
          <h3 className="font-bold text-gray-800 text-[15px] mb-4">Payment Modes</h3>
          <div className="space-y-2 text-sm text-gray-600">
            {(summary?.paymentModes ?? []).map((payment) => <div key={payment.mode} className="flex justify-between"><span>{payment.mode}</span><span className="font-semibold text-gray-800">₹{payment.amount.toLocaleString('en-IN')}</span></div>)}
            {summary && summary.paymentModes.length === 0 && <p>No completed payments yet.</p>}
            {!summary && <p>Payment data is unavailable.</p>}
          </div>
        </Card>

        {/* Udhar Overview */}
        <Card className="p-5 flex flex-col justify-between">
          <h3 className="font-bold text-gray-800 text-[15px]">Udhar Overview</h3>
          <div className="mt-4 space-y-2 text-sm font-medium">
            <div className="flex justify-between"><span className="text-gray-600">Total Udhar</span><span className="font-bold text-gray-800">₹{customers.reduce((total, customer) => total + Number(customer.udharAmount || 0), 0).toLocaleString('en-IN')}</span></div>
            <p className="text-xs font-normal text-gray-500">Paid and overdue breakdowns are not available from the current ledger API.</p>
          </div>
          <button onClick={() => router.push('/customers')} className="w-full text-center mt-4 pt-3 border-t border-gray-100 text-[#8B5CF6] text-[11px] font-bold flex items-center justify-center gap-1">
            View Full Report &rarr;
          </button>
        </Card>

      </div>

      <Modal isOpen={isAddCustomerModalOpen} onClose={() => setIsAddCustomerModalOpen(false)} title="Add New Customer" size="md">
        <form onSubmit={handleAddCustomerSubmit} className="space-y-4">
          <div><label className="text-sm font-medium">Name *</label><input value={newName} onChange={e=>setNewName(e.target.value)} required className="w-full mt-1 border rounded-lg p-2" /></div>
          <div><label className="text-sm font-medium">Phone *</label><input value={newPhone} onChange={e=>setNewPhone(e.target.value)} required pattern="[0-9]{10}" maxLength={10} className="w-full mt-1 border rounded-lg p-2" /></div>
          <div><label className="text-sm font-medium">Email (Optional)</label><input value={newEmail} onChange={e=>setNewEmail(e.target.value)} type="email" className="w-full mt-1 border rounded-lg p-2" /></div>
          <div><label className="text-sm font-medium">Address (Optional)</label><textarea value={newAddress} onChange={e=>setNewAddress(e.target.value)} className="w-full mt-1 border rounded-lg p-2" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium">Credit Limit (₹)</label><input value={newCreditLimit} onChange={e=>setNewCreditLimit(e.target.value)} type="number" className="w-full mt-1 border rounded-lg p-2" /></div>
            <div><label className="text-sm font-medium">Opening Udhar</label><input value={newUdhar} onChange={e=>setNewUdhar(e.target.value)} type="number" className="w-full mt-1 border rounded-lg p-2" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" onClick={() => setIsAddCustomerModalOpen(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-[#8B5CF6] text-white rounded-lg">Save Customer</button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
