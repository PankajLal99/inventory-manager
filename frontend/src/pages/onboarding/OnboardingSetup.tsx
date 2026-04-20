import { useEffect, useState } from 'react';
import { Plus, Trash2, Lock, Rocket } from 'lucide-react';
import { coreApi } from '../../lib/api';

type StoreInput = {
  name: string;
  code: string;
  shop_type: string;
  is_primary: boolean;
};

type RoleInput = {
  name: string;
  description: string;
  permission_codenames: string;
};

type UserInput = {
  username: string;
  password: string;
  email: string;
  groups: string;
  default_store_code: string;
  assigned_store_codes: string;
  role_name: string;
  dashboard_only: boolean;
};

export default function OnboardingSetup() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [retailerCode, setRetailerCode] = useState('');
  const [retailerName, setRetailerName] = useState('');
  const [stores, setStores] = useState<StoreInput[]>([
    { name: '', code: '', shop_type: 'retail', is_primary: true },
  ]);
  const [roles, setRoles] = useState<RoleInput[]>([]);
  const [users, setUsers] = useState<UserInput[]>([
    {
      username: '',
      password: '',
      email: '',
      groups: 'Admin',
      default_store_code: '',
      assigned_store_codes: '',
      role_name: '',
      dashboard_only: false,
    },
  ]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await coreApi.onboarding.status();
        setCompleted(Boolean(res?.data?.completed));
      } catch {
        setCompleted(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const unlock = () => {
    setError(null);
    if (!password.trim()) {
      setError('Enter onboarding password.');
      return;
    }
    setUnlocked(true);
  };

  const setStore = (index: number, patch: Partial<StoreInput>) => {
    setStores((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  };
  const setRole = (index: number, patch: Partial<RoleInput>) => {
    setRoles((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  };
  const setUser = (index: number, patch: Partial<UserInput>) => {
    setUsers((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        password,
        retailer: { code: retailerCode, name: retailerName },
        stores: stores.map((s) => ({
          name: s.name,
          code: s.code,
          shop_type: s.shop_type,
          is_primary: s.is_primary,
        })),
        roles: roles.map((r) => ({
          name: r.name,
          description: r.description,
          permission_codenames: r.permission_codenames
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        })),
        users: users.map((u) => ({
          username: u.username,
          password: u.password,
          email: u.email,
          groups: u.groups
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          default_store_code: u.default_store_code.trim(),
          assigned_store_codes: u.assigned_store_codes
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          role_name: u.role_name.trim(),
          dashboard_only: u.dashboard_only,
        })),
      };
      const res = await coreApi.onboarding.complete(payload);
      setMessage(res?.data?.detail || 'Onboarding completed.');
      setCompleted(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Onboarding failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Loading onboarding status...</div>;
  }

  if (completed) {
    return (
      <div className="mx-auto mt-12 max-w-2xl rounded-xl border border-green-200 bg-green-50 p-6">
        <h1 className="text-lg font-semibold text-green-800">Onboarding already completed</h1>
        <p className="mt-2 text-sm text-green-700">This setup page is one-time and now locked.</p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-indigo-600" />
          <h1 className="text-lg font-semibold text-gray-900">Onboarding Unlock</h1>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter onboarding password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={unlock}
          className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Unlock Setup
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-gray-900">New Store Onboarding</h1>
        <p className="mt-2 text-sm text-gray-600">One-time setup for retailer, stores, users, and access control.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Retailer</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input value={retailerCode} onChange={(e) => setRetailerCode(e.target.value)} placeholder="Retailer code (e.g. ACME)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <input value={retailerName} onChange={(e) => setRetailerName(e.target.value)} placeholder="Retailer name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Stores</h2>
          <button onClick={() => setStores((p) => [...p, { name: '', code: '', shop_type: 'retail', is_primary: false }])} className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Store
          </button>
        </div>
        <div className="space-y-2">
          {stores.map((s, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-5">
              <input value={s.name} onChange={(e) => setStore(i, { name: e.target.value })} placeholder="Store name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={s.code} onChange={(e) => setStore(i, { code: e.target.value })} placeholder="Store code" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <select value={s.shop_type} onChange={(e) => setStore(i, { shop_type: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="retail">retail</option><option value="wholesale">wholesale</option><option value="repair">repair</option><option value="warehouse">warehouse</option><option value="other">other</option>
              </select>
              <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <input type="checkbox" checked={s.is_primary} onChange={(e) => setStore(i, { is_primary: e.target.checked })} /> Primary
              </label>
              <button onClick={() => setStores((p) => p.filter((_, idx) => idx !== i))} className="inline-flex items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">
                <Trash2 className="mr-1 h-4 w-4" /> Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Roles (optional)</h2>
          <button onClick={() => setRoles((p) => [...p, { name: '', description: '', permission_codenames: '' }])} className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Role
          </button>
        </div>
        <div className="space-y-2">
          {roles.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <input value={r.name} onChange={(e) => setRole(i, { name: e.target.value })} placeholder="Role name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={r.description} onChange={(e) => setRole(i, { description: e.target.value })} placeholder="Description" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={r.permission_codenames} onChange={(e) => setRole(i, { permission_codenames: e.target.value })} placeholder="nav.dashboard,nav.search" className="rounded-lg border border-gray-300 px-3 py-2 text-sm md:col-span-2" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Users</h2>
          <button
            onClick={() =>
              setUsers((p) => [
                ...p,
                { username: '', password: '', email: '', groups: '', default_store_code: '', assigned_store_codes: '', role_name: '', dashboard_only: false },
              ])
            }
            className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add User
          </button>
        </div>
        <div className="space-y-3">
          {users.map((u, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-4">
              <input value={u.username} onChange={(e) => setUser(i, { username: e.target.value })} placeholder="Username" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input type="password" value={u.password} onChange={(e) => setUser(i, { password: e.target.value })} placeholder="Password" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={u.email} onChange={(e) => setUser(i, { email: e.target.value })} placeholder="Email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={u.groups} onChange={(e) => setUser(i, { groups: e.target.value })} placeholder="Groups CSV (Admin,RetailAdmin)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={u.default_store_code} onChange={(e) => setUser(i, { default_store_code: e.target.value })} placeholder="Default store code" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={u.assigned_store_codes} onChange={(e) => setUser(i, { assigned_store_codes: e.target.value })} placeholder="Assigned stores CSV" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={u.role_name} onChange={(e) => setUser(i, { role_name: e.target.value })} placeholder="Apply role name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <input type="checkbox" checked={u.dashboard_only} onChange={(e) => setUser(i, { dashboard_only: e.target.checked })} />
                Dashboard only
              </label>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="inline-flex items-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        <Rocket className="mr-2 h-4 w-4" />
        {saving ? 'Running Onboarding...' : 'Complete One-Time Onboarding'}
      </button>
    </div>
  );
}
