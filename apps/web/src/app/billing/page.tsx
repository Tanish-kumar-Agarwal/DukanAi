'use client';

import React, { useState, useEffect, Suspense } from 'react';

import { Card } from '@/components/ui/Card';
import { Search, Plus, Mic, Receipt, IndianRupee, Minus, CheckCircle2, ArrowRight } from 'lucide-react';
import { InvoiceMathEngine, InvoiceMathInput, DISCOUNT_TYPES } from '@dukaanai/invoice-math';
import { productsApi, customersApi } from '@/lib/api-client';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { motion } from 'framer-motion';
import { useSearchParams, useRouter } from 'next/navigation';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import apiClient from '@/lib/api';
import { describeApiError } from '@/lib/api-error';
import { useDebounce } from '@/hooks/useDebounce';

function BillingContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [cart, setCart] = useState<{product: any, qty: number}[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [activeProducts, setActiveProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // Right Sidebar State
  const [requestedDiscountAmount, setRequestedDiscountAmount] = useState<string>('');
  const [discountReason, setDiscountReason] = useState<string>('');
  const [amountPaid, setAmountPaid] = useState<string>('');
  
  const [isSuccess, setIsSuccess] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // Custom item state (Left Sidebar)
  const [customAmount, setCustomAmount] = useState('');
  const [customName, setCustomName] = useState('');

  // ENG-401: Persistent Idempotency Key
  const { key: idempotencyKey, clearKey } = useIdempotencyKey('new-bill');

  const fetchBillingData = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [productsData, customersData] = await Promise.all([
        productsApi.list(),
        customersApi.list(),
      ]);

      setProducts(productsData);
      setActiveProducts(productsData);
      setCustomers(
        customersData.map((customer: any) => ({
          ...customer,
          udharAmount: customer.udharAmount ?? customer.outstandingUdhar ?? 0,
          totalSpent: customer.totalSpent ?? customer.totalPurchases ?? 0,
        }))
      );
    } catch (err) {
      setLoadError(describeApiError(err, 'Loading billing data (GET /products, GET /customers)'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBillingData();
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
    
    if (!debouncedSearch.trim()) {
      setActiveProducts(products);
      return;
    }
    
    const abortController = new AbortController();
    setIsSearching(true);
    setSearchError(null);
    
    productsApi.search(debouncedSearch.trim(), { signal: abortController.signal })
      .then(res => {
        setActiveProducts(res);
      })
      .catch(err => {
        if (err.name !== 'AbortError' && err.name !== 'CanceledError') {
          setSearchError('Search failed');
        }
      })
      .finally(() => {
        setIsSearching(false);
      });
      
    return () => abortController.abort();
  }, [debouncedSearch, products]);

  // Handle URL query parameters for AI Voice Billing
  useEffect(() => {
    if (products.length === 0) return;

    const addItem = searchParams.get('addItem');
    const qty = Number(searchParams.get('qty')) || 1;
    const productId = searchParams.get('product');

    if (addItem) {
      const product = products.find(p => p.name.toLowerCase().includes(addItem.toLowerCase()));
      if (product) {
        addToCart(product, qty);
      }
    }
    
    if (productId) {
      const product = products.find(p => p.id === productId);
      if (product) {
        addToCart(product, 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, searchParams]);

  // POS-MATH-002: Exact replica of Backend BillingService Math using the SHARED engine.
  const requestedDiscount = Number(requestedDiscountAmount) || 0;
  
  const cartMath = React.useMemo(() => {
    try {
      const mathInput: InvoiceMathInput = {
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.qty,
          unitPrice: item.product.price,
          discountPercent: 0, // Frontend does not currently support line-item discount inputs
          gstRateStr: item.product.gstRate || 'EIGHTEEN',
          isInterState: selectedCustomer?.state ? false /* TODO: Shop state not in frontend context yet */ : false,
        })),
        discountAmount: requestedDiscount > 0 ? requestedDiscount : undefined,
        discountType: requestedDiscount > 0 ? DISCOUNT_TYPES.FIXED_AMOUNT : undefined,
        discountReason: discountReason || undefined,
        paymentMode: 'CASH', // Dummy for preview
        amountPaid: 99999999 // Dummy to bypass strict validation in preview
      };
      
      const result = InvoiceMathEngine.calculate(mathInput);
      return {
        subtotal: result.subtotal.toNumber(),
        totalTax: result.totalTax.toNumber(),
        grandTotal: result.grandTotal.toNumber(),
        finalTotal: result.finalTotal.toNumber(),
        roundOffAmount: result.roundOff.toNumber(),
      };
    } catch (e) {
      // In case of negative discount or exceeded subtotal limits during live typing
      return {
        subtotal: 0,
        totalTax: 0,
        grandTotal: 0,
        finalTotal: 0,
        roundOffAmount: 0,
      };
    }
  }, [cart, requestedDiscount, discountReason, selectedCustomer]);

  const addToCart = (product: any, quantity: number = 1) => {
    if (quantity <= 0) {
      toast('Quantity must be greater than 0', 'error');
      return;
    }
    
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      const currentQty = existing ? existing.qty : 0;
      const newQty = currentQty + quantity;
      
      if (newQty > product.quantity) {
        toast(`Cannot add more than available stock (${product.quantity})`, 'error');
        return prev;
      }
      
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, qty: newQty } : item);
      } else {
        return [...prev, { product, qty: quantity }];
      }
    });
  };

  const updateQty = (id: string | number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === id) {
        const newQty = Math.max(0, item.qty + delta);
        if (newQty > item.product.quantity) {
          toast(`Cannot add more than available stock (${item.product.quantity})`, 'error');
          return item;
        }
        return { ...item, qty: newQty };
      }
      return item;
    }).filter(item => item.qty > 0));
  };

  const handleAddCustom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const amount = Number(customAmount);
    if (!amount || amount <= 0) return;

    const product = {
      id: `custom-${Date.now()}`,
      name: customName.trim() || 'Custom Item',
      price: amount,
      barcode: '-'
    };
    
    addToCart(product, 1);
    setCustomAmount('');
    setCustomName('');
  };

  const displayTotal = Math.max(0, cartMath.finalTotal);
  const paid = Number(amountPaid) || displayTotal; // If amountPaid is empty, assume full cash paid
  const pending = Math.max(0, displayTotal - paid);
  
  const handleCheckout = async () => {
    if (displayTotal <= 0) return;
    if (!idempotencyKey) {
      toast('Idempotency key not initialized. Please refresh.', 'error');
      return;
    }

    if (requestedDiscount > 0 && !discountReason.trim()) {
      toast('Discount reason is required', 'error');
      return;
    }
    
    if (!selectedCustomer && pending > 0) {
      toast('A customer must be selected for Udhar billing', 'error');
      return;
    }
    
    if (selectedCustomer && pending > 0) {
      toast(`Udhar of ₹${pending} added to ${selectedCustomer.name}'s account`, 'info');
    }

    try {
      let derivedPaymentMode = 'CASH';
      if (pending > 0) {
        if (paid === 0) {
          derivedPaymentMode = 'UDHAR';
        } else {
          derivedPaymentMode = 'SPLIT';
        }
      }

      const payload = {
        idempotencyKey,
        customerId: selectedCustomer?.id,
        paymentMode: derivedPaymentMode,
        udharAmount: pending,
        amountPaid: paid,
        discountAmount: requestedDiscount > 0 ? requestedDiscount : undefined,
        discountReason: requestedDiscount > 0 ? discountReason : undefined,
        discountType: requestedDiscount > 0 ? 'FIXED_AMOUNT' : undefined,
        roundOffAmount: cartMath.roundOffAmount,
        items: cart.map(c => ({
          productId: c.product.id,
          quantity: c.qty
        }))
      };

      const res = await apiClient.post('/billing/invoice', payload);

      // ENG-403: Success cleanup only on 200/201
      if (res.status === 200 || res.status === 201) {
        clearKey(); // Burn the persistent key
        setIsSuccess(true);
        toast('Bill Generated successfully', 'success');
        
        setTimeout(() => {
          setCart([]);
          setSelectedCustomer(null);
          setRequestedDiscountAmount('');
          setDiscountReason('');
          setAmountPaid('');
          setIsSuccess(false);
          router.replace('/billing'); // Clear query params
        }, 2500);
      } else {
        // HTTP Error (400, 500, etc) - DO NOT clear key
        toast(`Checkout failed (HTTP ${res.status}). Retrying will use same idempotency key.`, 'error');
      }
    } catch (error) {
      // Network timeout / Gateway error - DO NOT clear key
      toast(
        `${describeApiError(error, 'Checkout (POST /billing/invoice)')} Retrying will use the same idempotency key.`,
        'error',
      );
    }
  };

  const startListening = () => {
    setIsListening(true);
    setTimeout(() => {
      setIsListening(false);
      setIsVoiceModalOpen(false);
      const p = products.find(p => p.name.includes('Maggi'));
      if (p) {
        addToCart(p, 2);
        toast('Heard: Add 2 Maggi Noodles → Added to cart', 'success');
      }
    }, 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <Card className="p-6 bg-white border border-gray-100 shadow-sm rounded-xl">
          <p className="text-sm font-medium text-gray-500">Loading billing data...</p>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <Card className="p-6 bg-white border border-gray-100 shadow-sm rounded-xl">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-red-500">{loadError}</p>
            <button
              onClick={fetchBillingData}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              Retry
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Point of Sale</h1>
          <p className="text-sm text-gray-500 mt-1">Manage billing and checkout</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => { setIsVoiceModalOpen(true); startListening(); }}
            className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
          >
            <Mic size={18} className="text-[#8B5CF6]" />
            AI Voice Billing
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Products & Cart */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-0 overflow-hidden shadow-sm border border-gray-100 bg-white">
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-center">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search products or scan barcode..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveIndex(prev => Math.min(prev + 1, activeProducts.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveIndex(prev => Math.max(prev - 1, 0));
                    } else if (e.key === 'Escape') {
                      setSearch('');
                      setActiveIndex(-1);
                    } else if (e.key === 'Tab' || (e.shiftKey && e.key === 'Tab')) {
                      // Let browser handle focus naturally
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (activeIndex >= 0 && activeProducts[activeIndex]) {
                        addToCart(activeProducts[activeIndex], 1);
                        setSearch('');
                      } else {
                        const term = search.toLowerCase().trim();
                        if (!term) return;
                        const exactMatch = activeProducts.find(p => p.barcode && p.barcode.toLowerCase() === term);
                        if (exactMatch) {
                          addToCart(exactMatch, 1);
                          setSearch('');
                        } else if (activeProducts.length === 1) {
                          addToCart(activeProducts[0], 1);
                          setSearch('');
                        }
                      }
                    }
                  }}
                  className="w-full bg-white border border-gray-200 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] transition-all"
                />
              </div>
              <form onSubmit={handleAddCustom} className="flex gap-2 w-full sm:w-auto">
                <input 
                  type="text" 
                  placeholder="Item Name (Optional)" 
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full sm:w-40 bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]"
                />
                <div className="relative w-full sm:w-32">
                  <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input 
                    type="number" 
                    placeholder="Amount" 
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]"
                  />
                </div>
                <button type="submit" className="bg-[#1e293b] hover:bg-black text-white px-4 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center transition-all whitespace-nowrap">
                  Add <Plus size={16} className="ml-1"/>
                </button>
              </form>
            </div>
            
            {/* Product Quick Grid */}
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 border-b border-gray-100 max-h-[250px] overflow-y-auto scrollbar-hide">
              {isSearching ? (
                <div className="col-span-full py-8 text-center text-gray-500 text-sm">Searching...</div>
              ) : searchError ? (
                <div className="col-span-full py-8 text-center text-red-500 text-sm">{searchError}</div>
              ) : activeProducts.length === 0 ? (
                <div className="col-span-full py-8 text-center text-gray-500 text-sm">No Results</div>
              ) : (
                activeProducts.map((prod, index) => (
                  <div 
                    key={prod.id} 
                    onClick={() => addToCart(prod, 1)}
                    className={`bg-white border p-3 rounded-xl cursor-pointer transition-all group ${
                      activeIndex === index 
                        ? 'border-[#8B5CF6] bg-purple-50 shadow-sm ring-1 ring-[#8B5CF6]' 
                        : 'border-gray-100 hover:border-[#8B5CF6] hover:shadow-sm'
                    }`}
                  >
                    <p className={`text-xs font-bold truncate transition-colors ${activeIndex === index ? 'text-[#8B5CF6]' : 'text-gray-800 group-hover:text-[#8B5CF6]'}`} title={prod.name}>
                      {prod.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-1 font-medium">₹{prod.price}</p>
                  </div>
                ))
              )}
            </div>

            {/* Cart Table */}
            <div className="p-0 min-h-[300px]">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[300px] text-center text-gray-400">
                  <Receipt size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium">Cart is empty. Click products above to add.</p>
                </div>
              ) : (
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50/50 text-gray-500 text-xs font-bold border-b border-gray-100 uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3">Price</th>
                      <th className="px-5 py-3">Qty</th>
                      <th className="px-5 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {cart.map(item => (
                      <tr key={item.product.id}>
                        <td className="px-5 py-4 font-bold text-gray-800">{item.product.name}</td>
                        <td className="px-5 py-4 font-medium">₹{item.product.price}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 bg-gray-50 w-fit rounded-lg border border-gray-100 p-1">
                            <button onClick={() => updateQty(item.product.id, -1)} className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm hover:text-red-500 transition-colors"><Minus size={14}/></button>
                            <span className="w-6 text-center font-bold text-gray-800">{item.qty}</span>
                            <button onClick={() => updateQty(item.product.id, 1)} className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm hover:text-green-500 transition-colors"><Plus size={14}/></button>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-bold text-[#8B5CF6]">
                          ₹{(item.product.price * item.qty).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Checkout Summary matches Screenshot perfectly */}
        <div className="lg:col-span-1">
          <Card className="p-6 bg-white border border-gray-100 shadow-sm rounded-xl">
            <h2 className="text-lg font-bold text-gray-800 mb-6">Bill Summary</h2>
            
            {/* Attach Customer (Hidden nicely above steps) */}
            <div className="mb-6">
              <select 
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] text-gray-700"
                value={selectedCustomer ? selectedCustomer.id : ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCustomer(customers.find(c => c.id === id) || null);
                }}
              >
                <option value="">Walk-in Customer (No Udhar)</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} (Udhar: ₹{c.udharAmount})</option>
                ))}
              </select>
            </div>

            {/* Step 1 */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center text-xs font-bold">1</span>
                <h3 className="font-bold text-gray-800 text-sm">Discount Amount (₹)</h3>
              </div>
              <p className="text-xs text-gray-400 mb-2 pl-7">Request a global discount on this bill</p>
              <div className="relative pl-7 mb-3">
                <IndianRupee className="absolute left-10 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input 
                  type="number" 
                  value={requestedDiscountAmount}
                  onChange={(e) => setRequestedDiscountAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-4 py-2.5 text-sm font-bold text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]" 
                />
              </div>
              {Number(requestedDiscountAmount) > 0 && (
                <div className="pl-7">
                  <input 
                    type="text" 
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="Reason for discount (Required)"
                    className="w-full bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]" 
                  />
                </div>
              )}
            </div>

            {/* Step 2 */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center text-xs font-bold">2</span>
                <h3 className="font-bold text-gray-800 text-sm">Payment Details</h3>
              </div>
              <p className="text-xs text-gray-400 mb-2 pl-7">Enter the amount received from customer</p>
              <div className="relative pl-7">
                <IndianRupee className="absolute left-10 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input 
                  type="number" 
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-4 py-2.5 text-sm font-bold text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#8B5CF6]" 
                />
              </div>
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-3 mb-6 text-sm font-bold pl-7 pr-1">
              <div className="flex justify-between text-gray-700">
                <span>Total Amount</span>
                <span>₹{displayTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Amount Paid</span>
                <span>₹{paid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-red-500">
                <span>Pending Amount</span>
                <span>₹{pending.toFixed(2)}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mb-6">
              <h3 className="font-bold text-gray-800 text-sm mb-3">Quick Actions</h3>
              <div className="flex gap-3">
                <button 
                  onClick={() => setAmountPaid(displayTotal.toString())}
                  className="flex-1 py-2 border border-green-500 text-green-600 hover:bg-green-50 rounded-lg text-xs font-bold transition-colors"
                >
                  Full Payment
                </button>
                <button 
                  onClick={() => {
                    setAmountPaid('');
                    setRequestedDiscountAmount('');
                    setDiscountReason('');
                    setCart([]);
                  }}
                  className="flex-1 py-2 border border-red-500 text-red-500 hover:bg-red-50 rounded-lg text-xs font-bold transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Submit Button */}
            {isSuccess ? (
              <div className="w-full bg-green-500 text-white py-3.5 rounded-lg font-bold flex items-center justify-center gap-2">
                <CheckCircle2 size={18} />
                Bill Generated!
              </div>
            ) : (
              <button 
                onClick={handleCheckout}
                disabled={displayTotal <= 0}
                className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:bg-purple-300 text-white py-3.5 rounded-lg font-bold flex justify-center items-center gap-2 transition-colors shadow-lg shadow-purple-500/30"
              >
                Complete Payment <ArrowRight size={18} />
              </button>
            )}
            
            <p className="text-center text-[10px] text-gray-400 mt-4 flex items-center justify-center gap-1 font-medium">
              🔒 Your data is secure and encrypted
            </p>
          </Card>
        </div>
      </div>

      <Modal isOpen={isVoiceModalOpen} onClose={() => { setIsVoiceModalOpen(false); setIsListening(false); }} size="md">
        <div className="flex flex-col items-center justify-center py-8 text-center bg-gray-900 rounded-xl -m-6 p-10 relative overflow-hidden text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-[#8B5CF6]/30 to-transparent pointer-events-none" />
          
          <motion.div 
            animate={{ scale: isListening ? [1, 1.2, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="w-24 h-24 rounded-full bg-[#8B5CF6] flex items-center justify-center shadow-[0_0_50px_rgba(139,92,246,0.6)] mb-6 z-10"
          >
            <Mic size={40} className="text-white" />
          </motion.div>
          
          <h3 className="text-xl font-bold mb-2 z-10">{isListening ? "Listening..." : "Processing..."}</h3>
          <p className="text-gray-300 text-sm mb-8 z-10">Say a product name and quantity</p>
          
          <div className="flex flex-wrap justify-center gap-2 mb-8 z-10">
            <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium border border-white/10">"Add 2 Maggi"</span>
            <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium border border-white/10">"3 Parle G"</span>
            <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium border border-white/10">"Amul Butter 1"</span>
          </div>
          
          <button 
            onClick={() => { setIsVoiceModalOpen(false); setIsListening(false); }}
            className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-colors z-10 border border-white/10"
          >
            Stop Listening
          </button>
        </div>
      </Modal>

    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div>Loading Billing...</div>}>
      <BillingContent />
    </Suspense>
  );
}
