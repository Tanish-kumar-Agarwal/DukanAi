import React, { useState, useRef, useEffect } from 'react';
import { Bell, Search, Mic, Sun, Moon, MessageCircle, Clock, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/hooks';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { motion, AnimatePresence } from 'framer-motion';
import { signOut, useSession } from 'next-auth/react';
import { AUTH_DISABLED } from '@/lib/auth-bypass';

export function Navbar() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: session, status } = useSession();
  
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme, mounted } = useTheme();

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearchEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      setIsSearchOpen(false);
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const startListening = () => {
    setIsListening(true);
    setTimeout(() => {
      setIsListening(false);
      setIsVoiceModalOpen(false);
      router.push('/billing?addItem=Maggi&qty=2');
      toast('Heard: Add 2 Maggi Noodles → Added to cart', 'success');
    }, 2000);
  };

  return (
    <nav className="fixed top-0 right-0 left-0 md:left-64 h-[72px] bg-white border-b border-gray-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] z-30 flex items-center justify-between px-6">
      
      {/* Search Bar */}
      <div className="flex-1 max-w-2xl flex items-center gap-4 relative" ref={searchRef}>
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchOpen(true)}
            onKeyDown={handleSearchEnter}
            placeholder="Search products, customers, invoices... (e.g. magi, coca, parl)" 
            className="w-full bg-gray-50/50 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-gray-700 placeholder:text-gray-400"
          />
          
          <AnimatePresence>
            {isSearchOpen && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full mt-2 w-full bg-white border border-gray-100 shadow-xl rounded-xl p-4 z-50 flex flex-col gap-4"
              >
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Clock size={12}/> Recent searches</h4>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setSearchQuery('Maggi')} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors">Maggi</button>
                    <button onClick={() => setSearchQuery('Ramesh Kumar')} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors">Ramesh Kumar</button>
                  </div>
                </div>
                {searchQuery && (
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quick results</h4>
                    <button onClick={() => { setIsSearchOpen(false); router.push(`/search?q=${encodeURIComponent(searchQuery)}`); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded-lg text-sm text-gray-700 transition-colors">
                      Search across products, customers & invoices for <span className="font-bold">"{searchQuery}"</span> &rarr;
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <button 
          onClick={() => { setIsVoiceModalOpen(true); startListening(); }}
          className="hidden md:flex items-center gap-2 bg-[#8B5CF6] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#7C3AED] transition-colors whitespace-nowrap shadow-md shadow-primary/20"
        >
          <Mic size={16} />
          AI Voice Billing
        </button>
      </div>

      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-5">
        {mounted && (
          <button 
            onClick={toggleTheme}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        )}

        <div className="relative" ref={notifRef}>
          <button 
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Bell size={20} />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
              6
            </span>
          </button>
          
          <AnimatePresence>
            {isNotificationsOpen && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="absolute right-0 top-full mt-3 w-80 bg-white border border-gray-100 shadow-2xl rounded-xl overflow-hidden z-50"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="font-bold text-gray-800 text-sm">Notifications</h3>
                  <button className="text-[#8B5CF6] text-xs font-semibold hover:underline flex items-center gap-1">
                    <Check size={12}/> Mark all read
                  </button>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {[
                    { icon: '🔴', title: 'Low Stock: Parle-G Biscuit', desc: 'Only 5 pcs left', time: '2 min ago' },
                    { icon: '🟡', title: 'Udhar Due: Ramesh Kumar', desc: '₹12,450 overdue', time: '1h ago' },
                    { icon: '🔴', title: 'Low Stock: Ariel Detergent', desc: 'Only 3 pcs left', time: '2h ago' },
                    { icon: '🟡', title: 'Udhar Due: Amit Verma', desc: '₹5,320 overdue', time: '3h ago' },
                    { icon: '🟢', title: 'Payment: Vikram Patel', desc: 'Paid ₹2,000', time: 'Yesterday' },
                    { icon: '🔵', title: 'System', desc: 'Daily backup completed successfully', time: 'Yesterday' },
                  ].map((n, i) => (
                    <div key={i} className="flex gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                      <span className="text-lg">{n.icon}</span>
                      <div>
                        <p className="text-xs font-bold text-gray-800">{n.title}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{n.desc}</p>
                      </div>
                      <span className="text-[9px] text-gray-400 font-medium ml-auto whitespace-nowrap">{n.time}</span>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-gray-100 text-center">
                  <button className="text-xs text-[#8B5CF6] font-bold hover:underline">View All Notifications</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button className="text-green-500 hover:text-green-600 transition-colors bg-green-50 p-1.5 rounded-full">
          <MessageCircle size={20} className="fill-current" />
        </button>

        <div className="relative">
          {status === 'authenticated' ? (
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex items-center gap-3 pl-5 border-l border-gray-100 hover:bg-gray-50 p-2 rounded-xl transition-colors"
              title="Sign out"
            >
              <div className="text-right hidden sm:block">
                <p className="text-[13px] font-bold text-gray-800 leading-tight">{session.user?.name || session.user?.email}</p>
                <p className="text-[11px] text-red-500 font-bold mt-0.5 hover:underline">Sign Out</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-violet-100 text-sm font-bold text-violet-700">{(session.user?.name || session.user?.email || 'U').slice(0, 1).toUpperCase()}</div>
            </button>
          ) : AUTH_DISABLED ? (
            <div
              className="flex items-center gap-3 pl-5 border-l border-gray-100 p-2"
              title="Auth is disabled (AUTH_DISABLED) - requests run as the system user"
            >
              <div className="text-right hidden sm:block">
                <p className="text-[13px] font-bold text-gray-800 leading-tight">System user</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Auth disabled</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-violet-100 text-sm font-bold text-violet-700">S</div>
            </div>
          ) : (
            <button onClick={() => router.push('/login')} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-700">Sign in</button>
          )}
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
    </nav>
  );
}
