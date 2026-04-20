import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Lock, Rocket } from 'lucide-react';
import { coreApi, type OnboardingRetailerRef } from '../../lib/api';
import { buildOnboardingPayload } from '../../lib/onboardingPayload';

type StoreInput = { name: string; code: string; shop_type: string; is_primary: boolean };
type RoleInput = { name: string; description: string; permission_codenames: string };
type UserInput = {
  username: string;
  password: string;
  email: string;
  groups: string[];
  default_store_code: string;
  assigned_store_codes: string[];
  role_name: string;
  dashboard_only: boolean;
};
const STEPS = ['Mode', 'Retailer', 'Locations', 'Roles', 'Users', 'Review'];
const GROUP_OPTIONS = ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair'];

export default function OnboardingSetup() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'create_retailer' | 'extend_retailer'>('create_retailer');
  const [retailers, setRetailers] = useState<OnboardingRetailerRef[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<number | ''>('');
  const [retailerCode, setRetailerCode] = useState('');
  const [retailerName, setRetailerName] = useState('');
  const [stores, setStores] = useState<StoreInput[]>([{ name: '', code: '', shop_type: 'retail', is_primary: true }]);
  const [roles, setRoles] = useState<RoleInput[]>([]);
  const [users, setUsers] = useState<UserInput[]>([
    {
      username: '',
      password: '',
      email: '',
      groups: ['Admin'],
      default_store_code: '',
      assigned_store_codes: [],
      role_name: '',
      dashboard_only: false,
    },
  ]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await coreApi.onboarding.status();
        setRetailers(Array.isArray(res.data?.retailers) ? res.data.retailers : []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const storeCodes = useMemo(() => stores.map((s) => s.code.trim().toUpperCase()).filter(Boolean), [stores]);
  const roleNames = useMemo(() => roles.map((r) => r.name.trim()).filter(Boolean), [roles]);
  const selectedRetailer = useMemo(
    () => retailers.find((r) => r.id === selectedRetailerId) || null,
    [retailers, selectedRetailerId]
  );

  const unlock = () => {
    setError(null);
    if (!password.trim()) return setError('Enter onboarding password.');
    setUnlocked(true);
  };
  const setStore = (i: number, patch: Partial<StoreInput>) => setStores((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const setRole = (i: number, patch: Partial<RoleInput>) => setRoles((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const setUser = (i: number, patch: Partial<UserInput>) => setUsers((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const markPrimary = (idx: number) => setStores((p) => p.map((x, i) => ({ ...x, is_primary: i === idx })));

  const stepError = () => {
    if (step === 0) return null;
    if (step === 1) {
      if (mode === 'create_retailer' && (!retailerCode.trim() || !retailerName.trim())) return 'Retailer code and name are required.';
      if (mode === 'extend_retailer' && !selectedRetailerId) return 'Select an existing retailer.';
    }
    if (step === 2) {
      if (!stores.length) return 'At least one location is required.';
      const codes = storeCodes;
      if (codes.length !== stores.length) return 'Every location needs code.';
      if (new Set(codes).size !== codes.length) return 'Location codes must be unique.';
      if (stores.filter((s) => s.is_primary).length !== 1) return 'Select exactly one primary location.';
    }
    if (step === 4) {
      if (!users.length) return 'At least one user is required.';
      for (const user of users) {
        if (!user.username.trim() || !user.password.trim()) return 'Each user needs username and password.';
      }
    }
    return null;
  };

  const goNext = () => {
    const issue = stepError();
    if (issue) return setError(issue);
    setError(null);
    setStep((x) => Math.min(x + 1, STEPS.length - 1));
  };
  const goBack = () => {
    setError(null);
    setStep((x) => Math.max(x - 1, 0));
  };

  const submit = async () => {
    const issue = stepError();
    if (issue) return setError(issue);
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = buildOnboardingPayload({
        password,
        mode,
        retailerCode,
        retailerName,
        selectedRetailer,
        stores,
        roles,
        users,
      });
      const res = await coreApi.onboarding.complete(payload);
      setMessage(res?.data?.detail || 'Onboarding completed.');
      setStep(0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Onboarding failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading onboarding status...</div>;
  if (!unlocked) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2"><Lock className="h-5 w-5 text-indigo-600" /><h1 className="text-lg font-semibold text-gray-900">Onboarding Unlock</h1></div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter onboarding password" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button onClick={unlock} className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Unlock Setup</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-gray-900">Onboarding Graph Wizard</h1>
        <p className="mt-1 text-sm text-gray-600">Flow: Mode -&gt; Retailer -&gt; Locations -&gt; Roles -&gt; Users -&gt; Review</p>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
          {STEPS.map((name, idx) => (
            <button key={name} onClick={() => setStep(idx)} className={`rounded-md border px-2 py-1 text-xs ${step === idx ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{idx + 1}. {name}</button>
          ))}
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      {step === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Choose onboarding mode</h2>
          <label className="mr-4 text-sm"><input type="radio" checked={mode === 'create_retailer'} onChange={() => setMode('create_retailer')} /> Create new retailer</label>
          <label className="text-sm"><input type="radio" checked={mode === 'extend_retailer'} onChange={() => setMode('extend_retailer')} /> Add shops to existing retailer</label>
        </div>
      )}

      {step === 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {mode === 'create_retailer' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input value={retailerCode} onChange={(e) => setRetailerCode(e.target.value)} placeholder="Retailer code" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={retailerName} onChange={(e) => setRetailerName(e.target.value)} placeholder="Retailer name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          ) : (
            <select value={selectedRetailerId} onChange={(e) => setSelectedRetailerId(e.target.value ? Number(e.target.value) : '')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select retailer</option>
              {retailers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
            </select>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Locations</h2><button onClick={() => setStores((p) => [...p, { name: '', code: '', shop_type: 'retail', is_primary: false }])} className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs"><Plus className="mr-1 h-3.5 w-3.5" />Add Location</button></div>
          <div className="space-y-2">
            {stores.map((s, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-5">
                <input value={s.name} onChange={(e) => setStore(i, { name: e.target.value })} placeholder="Location name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input value={s.code} onChange={(e) => setStore(i, { code: e.target.value.toUpperCase() })} placeholder="Code" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <select value={s.shop_type} onChange={(e) => setStore(i, { shop_type: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="retail">retail</option><option value="warehouse">warehouse</option><option value="wholesale">wholesale</option><option value="repair">repair</option><option value="other">other</option></select>
                <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"><input type="radio" checked={s.is_primary} onChange={() => markPrimary(i)} />Primary</label>
                <button onClick={() => setStores((p) => p.filter((_, idx) => idx !== i))} className="inline-flex items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600"><Trash2 className="mr-1 h-4 w-4" />Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Roles (optional)</h2><button onClick={() => setRoles((p) => [...p, { name: '', description: '', permission_codenames: '' }])} className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs"><Plus className="mr-1 h-3.5 w-3.5" />Add Role</button></div>
          <div className="space-y-2">
            {roles.map((r, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input value={r.name} onChange={(e) => setRole(i, { name: e.target.value })} placeholder="Role name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input value={r.description} onChange={(e) => setRole(i, { description: e.target.value })} placeholder="Description" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input value={r.permission_codenames} onChange={(e) => setRole(i, { permission_codenames: e.target.value })} placeholder="Permission codenames CSV" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Users</h2><button onClick={() => setUsers((p) => [...p, { username: '', password: '', email: '', groups: [], default_store_code: '', assigned_store_codes: [], role_name: '', dashboard_only: false }])} className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs"><Plus className="mr-1 h-3.5 w-3.5" />Add User</button></div>
          <div className="space-y-3">
            {users.map((u, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input value={u.username} onChange={(e) => setUser(i, { username: e.target.value })} placeholder="Username" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input type="password" value={u.password} onChange={(e) => setUser(i, { password: e.target.value })} placeholder="Password" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input value={u.email} onChange={(e) => setUser(i, { email: e.target.value })} placeholder="Email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <select value={u.role_name} onChange={(e) => setUser(i, { role_name: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">No role</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
                  {GROUP_OPTIONS.map((g) => (
                    <label key={g} className="rounded border border-gray-200 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={u.groups.includes(g)}
                        onChange={(e) =>
                          setUser(i, { groups: e.target.checked ? [...u.groups, g] : u.groups.filter((x) => x !== g) })
                        }
                      /> {g}
                    </label>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                  {storeCodes.map((code) => (
                    <label key={code} className="rounded border border-gray-200 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={u.assigned_store_codes.includes(code)}
                        onChange={(e) =>
                          setUser(i, {
                            assigned_store_codes: e.target.checked
                              ? [...u.assigned_store_codes, code]
                              : u.assigned_store_codes.filter((x) => x !== code),
                          })
                        }
                      /> {code}
                    </label>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select value={u.default_store_code} onChange={(e) => setUser(i, { default_store_code: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Default store</option>{storeCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"><input type="checkbox" checked={u.dashboard_only} onChange={(e) => setUser(i, { dashboard_only: e.target.checked })} />Dashboard only</label>
                  <button onClick={() => setUsers((p) => p.filter((_, idx) => idx !== i))} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Remove user</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p><strong>Mode:</strong> {mode === 'create_retailer' ? 'Create new retailer' : 'Extend existing retailer'}</p>
          <p><strong>Retailer:</strong> {mode === 'create_retailer' ? `${retailerName} (${retailerCode.toUpperCase()})` : (selectedRetailer ? `${selectedRetailer.name} (${selectedRetailer.code})` : '-')}</p>
          <p><strong>Locations:</strong> {stores.length} | <strong>Roles:</strong> {roles.filter((r) => r.name.trim()).length} | <strong>Users:</strong> {users.length}</p>
          <p className="mt-2 text-xs text-gray-600">Primary location can be retail or warehouse. Stores can transfer stock after setup.</p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={goBack} disabled={step === 0 || saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">Back</button>
        {step < STEPS.length - 1 ? (
          <button onClick={goNext} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Next</button>
        ) : (
          <button onClick={submit} disabled={saving} className="inline-flex items-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            <Rocket className="mr-2 h-4 w-4" />
            {saving ? 'Running Onboarding...' : 'Complete Onboarding'}
          </button>
        )}
      </div>
    </div>
  );
}
