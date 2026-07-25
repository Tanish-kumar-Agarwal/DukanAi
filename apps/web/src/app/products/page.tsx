'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { 
  PackageSearch, Plus, Search, Filter, MoreVertical, 
  AlertTriangle, ChevronDown, PackageOpen, Box, TrendingUp, IndianRupee 
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SlidingPanel } from '@/components/ui/SlidingPanel';
import { useToast } from '@/components/ui/Toast';
import { productsApi } from '@/lib/api-client';
import apiClient from '@/lib/api';
import { describeApiError } from '@/lib/api-error';
import type { Product } from '@/types';
import { AnimatePresence, motion } from 'framer-motion';

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals & Panels
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isStockAdjustModalOpen, setIsStockAdjustModalOpen] = useState(false);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState('Details');

  // Dropdowns
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  
  const filterRef = useRef<HTMLDivElement>(null);

  // Filters & Sorting
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Form State
  const [newName, setNewName] = useState('');
  const [newSKU, setNewSKU] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newQty, setNewQty] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('CORRECTION');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [isAdjustingStock, setIsAdjustingStock] = useState(false);
  
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await productsApi.list();
      setProducts(data);
    } catch (err) {
      setError(describeApiError(err, 'Loading products (GET /products)'));
    } finally {
      setIsLoading(false);
    }
  };

  const resolveCategoryId = async (categoryName: string) => {
    const trimmedCategory = categoryName.trim();

    if (!trimmedCategory) {
      return undefined;
    }

    const { data: categories } = await apiClient.get<Array<{ id: string; name: string }>>('/categories');
    const existingCategory = categories.find(
      (category) => category.name.toLowerCase() === trimmedCategory.toLowerCase()
    );

    if (existingCategory) {
      return existingCategory.id;
    }

    const { data: createdCategory } = await apiClient.post<{ id: string }>('/categories', {
      name: trimmedCategory,
    });

    return createdCategory.id;
  };

  const applyInitialStock = async (productId: string, quantity: number) => {
    if (quantity <= 0) {
      return;
    }

    const { data: inventoryItem } = await apiClient.post<{ id: string }>('/inventory-domain', { productId });

    await apiClient.post(`/inventory-domain/${inventoryItem.id}/adjust`, {
      reason: 'OPENING_BALANCE',
      quantityChange: quantity,
      notes: 'Opening stock from Products page',
    });
  };

  const resetProductForm = () => {
    setNewName('');
    setNewSKU('');
    setNewCategory('');
    setNewPrice('');
    setNewCost('');
    setNewQty('');
  };

  useEffect(() => {
    void fetchProducts();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Derived Stats
  const totalProducts = products.length;
  const lowStockCount = products.filter(p => p.quantity <= 15 && p.quantity > 0).length;
  const outOfStockCount = products.filter(p => p.quantity === 0).length;
  const totalValue = products.reduce((acc, curr) => acc + (curr.cost * curr.quantity), 0);
  const renderStatValue = (value: number | string) => {
    if (isLoading) {
      return <div className="mt-1 h-6 w-16 rounded-md bg-gray-200 animate-pulse" />;
    }

    if (error) {
      return <h3 className="text-xl font-bold text-gray-400 tracking-tight">—</h3>;
    }

    return <h3 className="text-xl font-bold text-gray-800 tracking-tight">{value}</h3>;
  };

  // Filter Logic
  let processedProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (categoryFilter !== 'All') {
    processedProducts = processedProducts.filter(p => p.category === categoryFilter);
  }

  if (statusFilter !== 'All') {
    processedProducts = processedProducts.filter(p => {
      const status = p.quantity === 0 ? 'Out of Stock' : p.quantity <= 15 ? 'Low Stock' : 'In Stock';
      return status === statusFilter;
    });
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPrice) return;

    const initialQuantity = Number(newQty) || 0;

    try {
      const categoryId = await resolveCategoryId(newCategory);
      const createdProduct = await productsApi.create({
        name: newName.trim(),
        sku: newSKU.trim() || `SKU-${Math.floor(Math.random() * 1000)}`,
        sellingPrice: Number(newPrice),
        costPrice: Number(newCost) || Number(newPrice) * 0.8,
        mrp: Number(newPrice),
        categoryId,
      });

      let stockAdjusted = true;
      try {
        await applyInitialStock(createdProduct.id, initialQuantity);
      } catch (stockError) {
        console.error('[api] Setting initial stock (POST /inventory-domain/:id/adjust) failed:', stockError);
        stockAdjusted = false;
      }

      const savedProduct = await productsApi.get(createdProduct.id).catch(() => ({
        ...createdProduct,
        category: newCategory.trim() || createdProduct.category,
        quantity: stockAdjusted && initialQuantity > 0 ? initialQuantity : createdProduct.quantity,
      }));

      setProducts((currentProducts) => [savedProduct, ...currentProducts]);
      toast(
        stockAdjusted ? 'Product added successfully' : 'Product added, but initial stock could not be set.',
        stockAdjusted ? 'success' : 'info'
      );
      setIsAddModalOpen(false);
      resetProductForm();
    } catch (err) {
      toast(describeApiError(err, 'Saving product (POST /products)'), 'error');
    }
  };

  const handleAction = async (action: string, product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenActionMenuId(null);
    setSelectedProduct(product);
    
    switch (action) {
      case 'View Details': 
        setIsSidePanelOpen(true);
        break;
      case 'Update Stock':
        setAdjustmentQuantity('');
        setAdjustmentReason('CORRECTION');
        setAdjustmentNotes('');
        setIsStockAdjustModalOpen(true);
        break;
      case 'Edit Product':
        toast(`Edit modal for ${product.name} coming soon`, 'info');
        break;
      case 'Delete':
        try {
          await productsApi.delete(product.id);
          setProducts((currentProducts) => currentProducts.filter((currentProduct) => currentProduct.id !== product.id));
          toast(`${product.name} deleted successfully`, 'success');
        } catch (err) {
          toast(describeApiError(err, `Deleting ${product.name} (DELETE /products/:id)`), 'error');
        }
        break;
    }
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    const quantityChange = Number(adjustmentQuantity);
    if (!Number.isFinite(quantityChange) || quantityChange === 0) {
      toast('Enter a non-zero stock adjustment.', 'error');
      return;
    }

    try {
      setIsAdjustingStock(true);
      const { data: inventoryItem } = await apiClient.post<{ id: string }>('/inventory-domain', {
        productId: selectedProduct.id,
      });
      await apiClient.post(`/inventory-domain/${inventoryItem.id}/adjust`, {
        reason: adjustmentReason,
        quantityChange,
        notes: adjustmentNotes || undefined,
      });

      const refreshedProduct = await productsApi.get(selectedProduct.id);
      setProducts((current) => current.map((product) => product.id === refreshedProduct.id ? refreshedProduct : product));
      setSelectedProduct(refreshedProduct);
      setIsStockAdjustModalOpen(false);
      toast('Stock updated successfully.', 'success');
    } catch (error) {
      toast(describeApiError(error, 'Updating stock (POST /inventory-domain/:id/adjust)'), 'error');
    } finally {
      setIsAdjustingStock(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Products & Stock</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your inventory, pricing, and stock levels.</p>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-purple-500/30 transition-all"
        >
          <Plus size={18} />
          Add Product
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-[#8B5CF6]">
            <PackageSearch size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Products</p>
            {renderStatValue(totalProducts)}
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Low Stock Alerts</p>
            {renderStatValue(lowStockCount)}
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500">
            <PackageOpen size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Out of Stock</p>
            {renderStatValue(outOfStockCount)}
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
            <IndianRupee size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Inventory Value</p>
            {renderStatValue(`₹${totalValue.toLocaleString('en-IN')}`)}
          </div>
        </Card>
      </div>

      {/* Main Content Card */}
      <Card className="p-0 overflow-visible">
        {/* Toolbar */}
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/50">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search by product name or SKU..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20 focus:border-[#8B5CF6] transition-all"
            />
          </div>
          <div className="relative" ref={filterRef}>
            <button 
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors w-full sm:w-auto justify-center"
            >
              <Filter size={16} />
              Filters <ChevronDown size={14} />
            </button>

            <AnimatePresence>
              {isFilterOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-100 shadow-xl rounded-xl z-20 p-4"
                >
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Stock Status</h4>
                      <div className="flex flex-wrap gap-2">
                        {['All', 'In Stock', 'Low Stock', 'Out of Stock'].map(s => (
                          <button 
                            key={s} 
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#8B5CF6] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category</h4>
                      <select 
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm text-gray-700 outline-none focus:border-[#8B5CF6]"
                      >
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/80 text-gray-500 text-xs uppercase font-semibold border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Product Info</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Selling Price</th>
                <th className="px-6 py-4">Stock Qty</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="h-8 w-8 rounded-full border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] animate-spin" />
                      <div>
                        <p className="font-medium text-gray-800">Loading products...</p>
                        <p className="mt-1 text-xs text-gray-500">Fetching your latest inventory data.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div>
                        <p className="font-medium text-gray-800">{error}</p>
                        <p className="mt-1 text-xs text-gray-500">Please try again.</p>
                      </div>
                      <button
                        onClick={() => void fetchProducts()}
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-100"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {processedProducts.map((product) => {
                    const isOutOfStock = product.quantity === 0;
                    const isLowStock = product.quantity > 0 && product.quantity <= 15;
                    const status = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock';
                    
                    return (
                      <tr 
                        key={product.id} 
                        onClick={() => { setSelectedProduct(product); setIsSidePanelOpen(true); }}
                        className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                              <Box size={20} />
                            </div>
                            <div>
                              <span className="font-bold text-gray-800 block">{product.name}</span>
                              <span className="text-xs text-gray-500 font-mono mt-0.5 block">{product.sku}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-600">{product.category}</td>
                        <td className="px-6 py-4 font-bold text-gray-800">₹{product.price}</td>
                        <td className="px-6 py-4 font-bold text-gray-800">{product.quantity}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            isOutOfStock ? 'bg-red-50 text-red-600' :
                            isLowStock ? 'bg-orange-50 text-orange-600' :
                            'bg-green-50 text-green-600'
                          }`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right relative">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(openActionMenuId === product.id ? null : product.id); }}
                            className="p-2 text-gray-400 hover:text-[#8B5CF6] transition-colors rounded-lg hover:bg-[#8B5CF6]/10"
                          >
                            <MoreVertical size={18} />
                          </button>

                          <AnimatePresence>
                            {openActionMenuId === product.id && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="absolute right-8 top-10 w-48 bg-white border border-gray-100 shadow-xl rounded-xl z-50 overflow-hidden text-left"
                              >
                                {['View Details', 'Update Stock', 'Edit Product'].map(action => (
                                  <button 
                                    key={action}
                                    onClick={(e) => handleAction(action, product, e)}
                                    className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                                  >
                                    {action}
                                  </button>
                                ))}
                                <div className="h-px bg-gray-100 w-full" />
                                <button 
                                  onClick={(e) => handleAction('Delete', product, e)}
                                  className="w-full text-left px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 font-bold transition-colors"
                                >
                                  Delete
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </td>
                      </tr>
                    );
                  })}
                  {processedProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        <Box className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                        <p className="font-medium text-gray-800">No products found</p>
                        <p className="text-xs mt-1">Try adjusting your filters or search.</p>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Product Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Product" size="md">
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div><label className="text-sm font-medium">Product Name *</label><input value={newName} onChange={e=>setNewName(e.target.value)} required className="w-full mt-1 border rounded-lg p-2" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium">SKU / Barcode</label><input value={newSKU} onChange={e=>setNewSKU(e.target.value)} className="w-full mt-1 border rounded-lg p-2" placeholder="Auto-generated if blank" /></div>
            <div><label className="text-sm font-medium">Category</label><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} className="w-full mt-1 border rounded-lg p-2" placeholder="e.g. Snacks" /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-sm font-medium">Selling Price (₹) *</label><input value={newPrice} onChange={e=>setNewPrice(e.target.value)} type="number" required className="w-full mt-1 border rounded-lg p-2" /></div>
            <div><label className="text-sm font-medium">Cost Price (₹)</label><input value={newCost} onChange={e=>setNewCost(e.target.value)} type="number" className="w-full mt-1 border rounded-lg p-2" /></div>
            <div><label className="text-sm font-medium">Initial Stock</label><input value={newQty} onChange={e=>setNewQty(e.target.value)} type="number" className="w-full mt-1 border rounded-lg p-2" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-6">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg text-sm font-bold shadow-lg shadow-purple-500/30">Save Product</button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isStockAdjustModalOpen}
        onClose={() => !isAdjustingStock && setIsStockAdjustModalOpen(false)}
        title={selectedProduct ? `Adjust Stock: ${selectedProduct.name}` : 'Adjust Stock'}
        size="md"
      >
        <form onSubmit={handleStockAdjustment} className="space-y-4">
          <p className="text-sm text-gray-500">Use a positive quantity to add stock or a negative quantity to reduce it.</p>
          <div>
            <label className="text-sm font-medium">Quantity change *</label>
            <input value={adjustmentQuantity} onChange={(e) => setAdjustmentQuantity(e.target.value)} type="number" step="0.001" required className="w-full mt-1 border rounded-lg p-2" placeholder="e.g. 10 or -2" />
          </div>
          <div>
            <label className="text-sm font-medium">Reason *</label>
            <select value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} className="w-full mt-1 border rounded-lg p-2">
              <option value="CORRECTION">Correction</option>
              <option value="MANUAL_COUNT">Manual count</option>
              <option value="DAMAGE">Damage</option>
              <option value="LOSS">Loss</option>
              <option value="RETURN">Return</option>
              <option value="EXPIRY">Expiry</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea value={adjustmentNotes} onChange={(e) => setAdjustmentNotes(e.target.value)} className="w-full mt-1 border rounded-lg p-2" rows={3} />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" disabled={isAdjustingStock} onClick={() => setIsStockAdjustModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isAdjustingStock} className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg text-sm font-bold disabled:opacity-50">{isAdjustingStock ? 'Saving…' : 'Save adjustment'}</button>
          </div>
        </form>
      </Modal>

      {/* Side Panel for Details */}
      <SlidingPanel isOpen={isSidePanelOpen} onClose={() => setIsSidePanelOpen(false)} title="Product Details">
        {selectedProduct && (
          <div className="p-6">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                <Box size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">{selectedProduct.name}</h2>
                <p className="text-sm text-gray-500 font-mono mt-0.5">SKU: {selectedProduct.sku}</p>
                <div className="mt-2">
                   <span className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-xs font-bold">{selectedProduct.category}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-4 border-b border-gray-100 mb-6">
              {['Details', 'Stock History'].map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setActiveTab(tab)}
                  className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === tab ? 'border-[#8B5CF6] text-[#8B5CF6]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'Details' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Selling Price</p>
                    <p className="font-bold text-gray-800 text-lg">₹{selectedProduct.price}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Cost Price</p>
                    <p className="font-bold text-gray-800 text-lg">₹{selectedProduct.cost}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Current Stock</p>
                    <p className={`font-bold text-lg ${selectedProduct.quantity === 0 ? 'text-red-500' : selectedProduct.quantity <= 15 ? 'text-orange-500' : 'text-green-500'}`}>
                      {selectedProduct.quantity} units
                    </p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Total Value</p>
                    <p className="font-bold text-gray-800 text-lg">₹{(selectedProduct.price * selectedProduct.quantity).toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="mt-6 border-t border-gray-100 pt-6">
                  <h4 className="text-sm font-bold text-gray-800 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedProduct.description || 'No description provided.'}</p>
                </div>
                
                <button 
                  onClick={() => { setIsSidePanelOpen(false); setIsStockAdjustModalOpen(true); }}
                  className="w-full mt-4 bg-purple-50 text-[#8B5CF6] hover:bg-purple-100 py-3 rounded-xl text-sm font-bold transition-colors border border-purple-200 flex items-center justify-center gap-2"
                >
                  <TrendingUp size={16} /> Update Stock Level
                </button>
              </div>
            )}

            {activeTab === 'Stock History' && (
              <div className="p-6 text-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl">
                Per-product stock movement history is not available yet. Use the
                Inventory page to review batches and adjustments.
              </div>
            )}
          </div>
        )}
      </SlidingPanel>
    </div>
  );
}
