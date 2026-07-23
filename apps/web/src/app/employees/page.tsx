'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { 
  Users, Plus, Search, Filter, MoreVertical, 
  UserCircle, ChevronDown, CheckCircle2, Clock, Wallet, Calculator,
  TrendingDown, FileText, Activity, AlertCircle
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SlidingPanel } from '@/components/ui/SlidingPanel';
import { useToast } from '@/components/ui/Toast';
import { AnimatePresence, motion } from 'framer-motion';
import { employeesApi } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-error';

const ROLE_COLORS: Record<string, string> = {
  'Cashier': 'bg-blue-100 text-blue-600',
  'Manager': 'bg-purple-100 text-purple-600',
  'Stock Clerk': 'bg-orange-100 text-orange-600',
  'Delivery Boy': 'bg-green-100 text-green-600',
};

const STATUS_COLORS: Record<string, string> = {
  'On Shift': 'bg-green-50 text-green-600 border-green-200',
  'Off Shift': 'bg-gray-50 text-gray-600 border-gray-200',
  'On Leave': 'bg-red-50 text-red-600 border-red-200',
};

export default function EmployeesPage() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    employeesApi.list()
      .then(setEmployees)
      .catch((err) => {
        setEmployees([]);
        toast(describeApiError(err, 'Loading employees (GET /users/employees)'), 'error');
      })
      .finally(() => setLoading(false));
  }, []);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals & Panels
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('Profile');

  // Dropdowns
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  
  const filterRef = useRef<HTMLDivElement>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Form State - Add Employee
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Cashier');
  const [newPhone, setNewPhone] = useState('');
  const [newShift, setNewShift] = useState('Morning');
  const [newSalary, setNewSalary] = useState('');

  // Form State - Payment
  const [paymentType, setPaymentType] = useState('Salary');
  const [paymentAmount, setPaymentAmount] = useState('');

  // Derived Stats
  const totalEmployees = employees.length;
  const onShiftCount = employees.filter(e => e.status === 'On Shift').length;
  const totalPayroll = employees.reduce((acc, curr) => acc + curr.salary, 0);
  const totalAdvances = employees.reduce((acc, curr) => acc + curr.advance, 0);

  // Filter Logic
  let processedEmployees = employees.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    e.phone.includes(searchTerm) ||
    e.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (statusFilter !== 'All') {
    processedEmployees = processedEmployees.filter(e => e.status === statusFilter);
  }

  if (roleFilter !== 'All') {
    processedEmployees = processedEmployees.filter(e => e.role === roleFilter);
  }

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone) return;

    const newEmp = {
      id: `EMP-0${employees.length + 1}`,
      name: newName,
      role: newRole,
      phone: newPhone,
      shift: newShift,
      salary: Number(newSalary) || 0,
      advance: 0,
      status: 'Off Shift'
    };
    
    setEmployees([newEmp, ...employees]);
    toast(`${newName} added successfully`, 'success');
    setIsAddModalOpen(false);
    
    setNewName(''); setNewPhone(''); setNewSalary('');
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentAmount || Number(paymentAmount) <= 0) return;

    if (paymentType === 'Advance') {
      setEmployees(employees.map(emp => {
        if (emp.id === selectedEmployee.id) return { ...emp, advance: emp.advance + Number(paymentAmount) };
        return emp;
      }));
      toast(`₹${paymentAmount} advance recorded for ${selectedEmployee.name}`, 'success');
    } else {
      // If paying salary, we typically deduct advance
      setEmployees(employees.map(emp => {
        if (emp.id === selectedEmployee.id) return { ...emp, advance: 0 }; // simplified
        return emp;
      }));
      toast(`Salary paid to ${selectedEmployee.name}`, 'success');
    }

    setIsPaymentModalOpen(false);
    setPaymentAmount('');
    setIsSidePanelOpen(false);
  };

  const handleAction = (action: string, employee: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenActionMenuId(null);
    setSelectedEmployee(employee);
    
    switch (action) {
      case 'View Profile':
        setIsSidePanelOpen(true);
        break;
      case 'Process Payment':
        setIsPaymentModalOpen(true);
        break;
      case 'Toggle Shift':
        setEmployees(employees.map(emp => {
          if (emp.id === employee.id) {
            return { ...emp, status: emp.status === 'On Shift' ? 'Off Shift' : 'On Shift' };
          }
          return emp;
        }));
        toast(`Shift updated for ${employee.name}`, 'success');
        break;
      case 'Delete':
        setEmployees(employees.filter(ex => ex.id !== employee.id));
        toast(`${employee.name} removed successfully`, 'success');
        break;
    }
  };
  if (loading) return <div className="p-12 text-center text-gray-500">Loading employees...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Staff & Employees</h1>
          <p className="text-sm text-gray-500 mt-1">Manage shifts, payroll, advances, and employee profiles.</p>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-purple-500/30 transition-all"
        >
          <Plus size={18} />
          Add Employee
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-[#8B5CF6]">
            <Users size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Staff</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">{totalEmployees}</h3>
          </div>
        </Card>
        
        <Card className="p-5 flex items-center gap-4 hoverable bg-green-50/50 border-green-100">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-600">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-xs text-green-600 font-bold">On Shift Currently</p>
            <h3 className="text-xl font-black text-green-700 tracking-tight">{onShiftCount}</h3>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4 hoverable">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
            <Calculator size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Monthly Payroll</p>
            <h3 className="text-xl font-bold text-gray-800 tracking-tight">₹{totalPayroll.toLocaleString('en-IN')}</h3>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4 hoverable border-l-4 border-l-orange-500">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-600">
            <TrendingDown size={24} />
          </div>
          <div>
            <p className="text-xs text-orange-500 font-bold">Pending Advances</p>
            <h3 className="text-xl font-black text-gray-800 tracking-tight">₹{totalAdvances.toLocaleString('en-IN')}</h3>
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
              placeholder="Search by name, ID or phone..." 
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
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Status</h4>
                      <div className="flex flex-wrap gap-2">
                        {['All', 'On Shift', 'Off Shift', 'On Leave'].map(s => (
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
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Role</h4>
                      <select 
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm text-gray-700 outline-none focus:border-[#8B5CF6]"
                      >
                        {['All', 'Cashier', 'Manager', 'Stock Clerk', 'Delivery Boy'].map(c => <option key={c} value={c}>{c}</option>)}
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
                <th className="px-6 py-4">Employee</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Shift & Salary</th>
                <th className="px-6 py-4">Pending Advance</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {processedEmployees.map((emp) => {
                const roleColor = ROLE_COLORS[emp.role] || 'bg-gray-100 text-gray-600';
                const statusStyle = STATUS_COLORS[emp.status];
                
                return (
                  <tr 
                    key={emp.id} 
                    onClick={() => { setSelectedEmployee(emp); setIsSidePanelOpen(true); }}
                    className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                          <UserCircle size={24} />
                        </div>
                        <div>
                          <span className="font-bold text-gray-800 block">{emp.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold inline-block mt-1 ${roleColor}`}>{emp.role}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-800 block">{emp.phone}</span>
                      <span className="text-xs text-gray-400 font-mono mt-0.5 block">{emp.id}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-black text-gray-800 text-sm block">₹{emp.salary.toLocaleString('en-IN')}/mo</span>
                      <span className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock size={12} /> {emp.shift}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-bold ${emp.advance > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {emp.advance > 0 ? `₹${emp.advance.toLocaleString('en-IN')}` : 'Nil'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusStyle}`}>
                        {emp.status === 'On Shift' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right relative">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(openActionMenuId === emp.id ? null : emp.id); }}
                        className="p-2 text-gray-400 hover:text-[#8B5CF6] transition-colors rounded-lg hover:bg-[#8B5CF6]/10"
                      >
                        <MoreVertical size={18} />
                      </button>

                      <AnimatePresence>
                        {openActionMenuId === emp.id && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute right-8 top-10 w-40 bg-white border border-gray-100 shadow-xl rounded-xl z-50 overflow-hidden text-left"
                          >
                            <button 
                              onClick={(e) => handleAction('Toggle Shift', emp, e)}
                              className="w-full text-left px-4 py-2.5 text-xs text-[#8B5CF6] hover:bg-purple-50 font-bold transition-colors"
                            >
                              {emp.status === 'On Shift' ? 'End Shift' : 'Start Shift'}
                            </button>
                            <div className="h-px bg-gray-100 w-full" />
                            <button 
                              onClick={(e) => handleAction('Process Payment', emp, e)}
                              className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                            >
                              Pay Salary/Advance
                            </button>
                            <button 
                              onClick={(e) => handleAction('View Profile', emp, e)}
                              className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                            >
                              View Profile
                            </button>
                            <div className="h-px bg-gray-100 w-full" />
                            <button 
                              onClick={(e) => handleAction('Delete', emp, e)}
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
              {processedEmployees.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <Users className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="font-medium text-gray-800">No employees found</p>
                    <p className="text-xs mt-1">Try adjusting your filters or search.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Employee Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Employee" size="md">
        <form onSubmit={handleSaveEmployee} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Full Name *</label>
            <input value={newName} onChange={e=>setNewName(e.target.value)} required className="w-full mt-1 border rounded-lg p-2" placeholder="e.g. Raju Bhai" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Role</label>
              <select value={newRole} onChange={e=>setNewRole(e.target.value)} className="w-full mt-1 border rounded-lg p-2 bg-white">
                <option>Cashier</option>
                <option>Manager</option>
                <option>Stock Clerk</option>
                <option>Delivery Boy</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Phone Number *</label>
              <input value={newPhone} onChange={e=>setNewPhone(e.target.value)} required pattern="[0-9]{10}" maxLength={10} className="w-full mt-1 border rounded-lg p-2" placeholder="10-digit number" />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Shift Timing</label>
              <select value={newShift} onChange={e=>setNewShift(e.target.value)} className="w-full mt-1 border rounded-lg p-2 bg-white">
                <option>Morning</option>
                <option>Evening</option>
                <option>Full Day</option>
                <option>Night</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Monthly Salary (₹)</label>
              <input value={newSalary} onChange={e=>setNewSalary(e.target.value)} type="number" className="w-full mt-1 border rounded-lg p-2" placeholder="0" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t mt-6">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg text-sm font-bold shadow-lg shadow-purple-500/30">Save Employee</button>
          </div>
        </form>
      </Modal>

      {/* Record Payment Modal */}
      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title={`Process Payment: ${selectedEmployee?.name}`} size="sm">
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 flex items-center justify-between mb-4">
            <span className="text-xs font-bold uppercase text-purple-600">Base Salary</span>
            <span className="font-black text-lg text-purple-700">₹{selectedEmployee?.salary.toLocaleString('en-IN')}</span>
          </div>

          {selectedEmployee?.advance > 0 && (
            <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase text-orange-600">Pending Advance</span>
              <span className="font-black text-orange-700">₹{selectedEmployee?.advance.toLocaleString('en-IN')}</span>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Payment Type</label>
            <div className="flex gap-2 mt-1">
              {['Salary', 'Advance'].map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPaymentType(type)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${paymentType === type ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Amount (₹) *</label>
            <input 
              value={paymentAmount} 
              onChange={e=>setPaymentAmount(e.target.value)} 
              type="number" 
              required 
              className="w-full mt-1 border rounded-lg p-3 text-lg font-bold" 
              placeholder="0" 
            />
          </div>
          
          <div className="flex justify-end gap-2 pt-4 border-t mt-6">
            <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-green-500/30">Confirm Payment</button>
          </div>
        </form>
      </Modal>

      {/* Side Panel for Profile */}
      <SlidingPanel isOpen={isSidePanelOpen} onClose={() => setIsSidePanelOpen(false)} title="Employee Profile">
        {selectedEmployee && (
          <div className="p-6">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                <UserCircle size={40} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">{selectedEmployee.name}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{selectedEmployee.phone}</p>
                <div className="mt-2 flex gap-2">
                   <span className={`px-2 py-0.5 rounded text-xs font-bold ${ROLE_COLORS[selectedEmployee.role] || 'bg-gray-100 text-gray-600'}`}>
                     {selectedEmployee.role}
                   </span>
                   <span className={`px-2 py-0.5 rounded border text-xs font-bold ${STATUS_COLORS[selectedEmployee.status]}`}>
                     {selectedEmployee.status}
                   </span>
                </div>
              </div>
            </div>

            <div className="flex gap-4 border-b border-gray-100 mb-6">
              {['Profile', 'Attendance', 'Payroll'].map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setActiveTab(tab)}
                  className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === tab ? 'border-[#8B5CF6] text-[#8B5CF6]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'Profile' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Employee ID</p>
                    <p className="font-bold text-gray-800 font-mono">{selectedEmployee.id}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Shift Timing</p>
                    <p className="font-bold text-gray-800">{selectedEmployee.shift}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Base Salary</p>
                    <p className="font-bold text-gray-800">₹{selectedEmployee.salary.toLocaleString()}/mo</p>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                    <p className="text-xs text-orange-500 mb-1 font-bold">Pending Advance</p>
                    <p className="font-bold text-orange-700">₹{selectedEmployee.advance.toLocaleString()}</p>
                  </div>
                </div>
                
                <button 
                  onClick={() => { setIsSidePanelOpen(false); setIsPaymentModalOpen(true); }}
                  className="w-full mt-4 bg-purple-50 text-[#8B5CF6] hover:bg-purple-100 py-3 rounded-xl text-sm font-bold transition-colors border border-purple-200 flex items-center justify-center gap-2"
                >
                  <Wallet size={16} /> Process Payroll / Advance
                </button>
              </div>
            )}

            {activeTab === 'Attendance' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between bg-green-50 p-4 rounded-xl border border-green-100">
                  <div>
                    <p className="text-xs font-bold text-green-600 uppercase">This Month</p>
                    <p className="font-black text-green-700 text-xl">20 / 22 Days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-gray-500">Leaves Taken</p>
                    <p className="font-bold text-gray-800">2</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <h4 className="font-bold text-gray-800 text-sm border-b pb-2">Recent Logs</h4>
                  {[
                    { date: 'Today, 21 May', status: 'Present', time: '09:05 AM', color: 'text-green-500' },
                    { date: 'Yesterday, 20 May', status: 'Present', time: '08:55 AM', color: 'text-green-500' },
                    { date: 'Wed, 19 May', status: 'Absent', time: '-', color: 'text-red-500' },
                    { date: 'Tue, 18 May', status: 'Present', time: '09:10 AM', color: 'text-green-500' },
                  ].map((log, i) => (
                    <div key={i} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl">
                      <div>
                        <p className="text-xs font-bold text-gray-800">{log.date}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">Punch in: {log.time}</p>
                      </div>
                      <span className={`text-xs font-bold ${log.color}`}>{log.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {activeTab === 'Payroll' && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <FileText size={40} className="text-gray-300 mb-3" />
                <h4 className="font-bold text-gray-800">Payslip Generation</h4>
                <p className="text-xs text-gray-500 max-w-[200px] mt-1">Automatic payslip generation is available in the Pro version.</p>
              </div>
            )}
          </div>
        )}
      </SlidingPanel>
    </div>
  );
}
