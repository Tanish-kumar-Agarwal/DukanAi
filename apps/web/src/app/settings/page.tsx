'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Store, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import apiClient from '@/lib/api';
import { describeApiError } from '@/lib/api-error';

interface ShopProfile {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  settings: { gstin: string | null } | null;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [shopName, setShopName] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    apiClient
      .get<ShopProfile>('/shops/me')
      .then(({ data }) => {
        setShopName(data.name ?? '');
        setGstin(data.settings?.gstin ?? '');
        setAddress(data.address ?? '');
      })
      .catch((err) => setLoadError(describeApiError(err, 'Loading shop profile (GET /shops/me)')))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await apiClient.patch('/shops/me', {
        name: shopName.trim(),
        address: address.trim(),
        gstin: gstin.trim(),
      });
      toast('Shop profile saved', 'success');
    } catch (err) {
      toast(describeApiError(err, 'Saving shop profile (PATCH /shops/me)'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your shop profile, team members, and billing.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 space-y-2">
          {['Shop Profile', 'Account & Security', 'Notifications', 'Team Management', 'Billing & Plans'].map((item, i) => (
            <button key={item} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-colors ${i === 0 ? 'bg-[#8B5CF6] text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'}`}>
              {item}
            </button>
          ))}
        </div>

        <div className="col-span-2">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Store size={24} className="text-[#8B5CF6]" />
              <h2 className="text-xl font-bold text-gray-800">Shop Profile</h2>
            </div>

            {loading && <p className="text-sm text-gray-500">Loading shop profile...</p>}

            {!loading && loadError && (
              <div className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{loadError}</span>
              </div>
            )}

            {!loading && !loadError && (
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-bold text-gray-700">Shop Name</label>
                    <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} required className="w-full mt-1 border border-gray-200 rounded-lg p-3 bg-gray-50" />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-gray-700">GSTIN</label>
                    <input type="text" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="Not set" className="w-full mt-1 border border-gray-200 rounded-lg p-3 bg-gray-50 uppercase" />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-bold text-gray-700">Shop Address</label>
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Not set" className="w-full mt-1 border border-gray-200 rounded-lg p-3 bg-gray-50 h-24"></textarea>
                </div>

                <div className="pt-4 border-t border-gray-100 flex justify-end">
                  <button type="submit" disabled={saving} className="bg-[#8B5CF6] text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-purple-500/30 hover:bg-[#7C3AED] transition-colors disabled:opacity-60">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
