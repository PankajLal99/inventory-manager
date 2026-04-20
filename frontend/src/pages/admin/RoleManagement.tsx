import { useEffect, useMemo, useState } from 'react';
import { Save, Plus, Shield, Trash2 } from 'lucide-react';
import { catalogApi, coreApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { canManageRoles } from '../../lib/access';

type AccessPermission = {
  id: number;
  codename: string;
  label: string;
  category: string;
  description?: string;
};

type Role = {
  id: number;
  retailer: number;
  name: string;
  description: string;
  permissions: number[];
  permission_codenames?: string[];
};

type AccessUser = {
  id: number;
  username: string;
  email: string;
  groups: string[];
  default_store_id: number | null;
  assigned_store_ids: number[];
  dashboard_only: boolean;
};

type Store = {
  id: number;
  name: string;
  code: string;
};

const grouped = (permissions: AccessPermission[]) =>
  permissions.reduce<Record<string, AccessPermission[]>>((acc, item) => {
    const key = item.category || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

export default function RoleManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userAssignedStores, setUserAssignedStores] = useState<number[]>([]);
  const [userDefaultStore, setUserDefaultStore] = useState<number | ''>('');
  const [userRoleId, setUserRoleId] = useState<number | ''>('');
  const [userDashboardOnly, setUserDashboardOnly] = useState(false);
  const user = auth.getUser();

  const permissionMap = useMemo(
    () => new Map(permissions.map((perm) => [perm.id, perm])),
    [permissions]
  );
  const permissionGroups = useMemo(() => grouped(permissions), [permissions]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permissionsRes] = await Promise.all([
        coreApi.roles.list(),
        coreApi.accessPermissions.list(),
      ]);
      const [usersRes, storesRes] = await Promise.all([
        coreApi.accessControl.users(),
        catalogApi.stores.list(),
      ]);
      const rolesData = rolesRes?.data || [];
      const permissionsData = permissionsRes?.data || [];
      const usersData = usersRes?.data || [];
      const storesData = storesRes?.data || [];
      setRoles(rolesData);
      setPermissions(permissionsData);
      setUsers(usersData);
      setStores(storesData);

      if (rolesData.length > 0) {
        const first = rolesData[0];
        setSelectedRoleId(first.id);
        setName(first.name || '');
        setDescription(first.description || '');
        setSelectedPermissions(first.permissions || []);
      }
      if (usersData.length > 0) {
        const firstUser = usersData[0];
        setSelectedUserId(firstUser.id);
        setUserAssignedStores(firstUser.assigned_store_ids || []);
        setUserDefaultStore(firstUser.default_store_id || '');
        setUserDashboardOnly(Boolean(firstUser.dashboard_only));
        setUserRoleId('');
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load role management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageRoles(user)) {
      setError('You do not have permission to view this page.');
      setLoading(false);
      return;
    }
    loadData();
  }, []);

  const selectRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setName(role.name || '');
    setDescription(role.description || '');
    setSelectedPermissions(role.permissions || []);
  };

  const resetNew = () => {
    setSelectedRoleId(null);
    setName('');
    setDescription('');
    setSelectedPermissions([]);
  };

  const togglePermission = (permissionId: number) => {
    setSelectedPermissions((prev) =>
      prev.includes(permissionId) ? prev.filter((id) => id !== permissionId) : [...prev, permissionId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Role name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        permissions: selectedPermissions,
      };
      if (selectedRoleId) {
        await coreApi.roles.update(selectedRoleId, payload);
      } else {
        await coreApi.roles.create(payload);
      }
      await loadData();
    } catch (e: any) {
      const serverError = e?.response?.data;
      if (typeof serverError === 'string') {
        setError(serverError);
      } else if (serverError?.name?.[0]) {
        setError(serverError.name[0]);
      } else if (serverError?.detail) {
        setError(serverError.detail);
      } else {
        setError('Could not save role.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRoleId) return;
    const role = roles.find((item) => item.id === selectedRoleId);
    if (!window.confirm(`Delete role "${role?.name || 'this role'}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      await coreApi.roles.delete(selectedRoleId);
      await loadData();
      resetNew();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not delete role.');
    } finally {
      setSaving(false);
    }
  };

  const selectUser = (u: AccessUser) => {
    setSelectedUserId(u.id);
    setUserAssignedStores(u.assigned_store_ids || []);
    setUserDefaultStore(u.default_store_id || '');
    setUserDashboardOnly(Boolean(u.dashboard_only));
    setUserRoleId('');
  };

  const toggleUserStore = (storeId: number) => {
    setUserAssignedStores((prev) =>
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]
    );
  };

  const handleSaveUserAccess = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setError(null);
    try {
      await coreApi.accessControl.updateUser(selectedUserId, {
        assigned_store_ids: userAssignedStores,
        default_store_id: userDefaultStore === '' ? '' : userDefaultStore,
        dashboard_only: userDashboardOnly,
        role_id: userRoleId === '' ? '' : userRoleId,
      });
      await loadData();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not save user access.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-600">Loading role management...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-indigo-600" />
          <h1 className="text-lg font-semibold text-gray-900">Role Management</h1>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Manage role permissions for navigation and feature visibility. Users only see pages that their effective
          permissions allow.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Roles</h2>
            <button
              onClick={resetNew}
              className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </button>
          </div>
          <div className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => selectRole(role)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedRoleId === role.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-medium">{role.name}</div>
                <div className="text-xs text-gray-500">
                  {(role.permissions || []).length} permission{(role.permissions || []).length === 1 ? '' : 's'}
                </div>
              </button>
            ))}
            {roles.length === 0 && <p className="text-sm text-gray-500">No roles yet.</p>}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">Role name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                placeholder="e.g. Store Manager"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Description
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-4">
            {Object.entries(permissionGroups).map(([category, perms]) => (
              <div key={category} className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">{category}</h3>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {perms.map((perm) => (
                    <label key={perm.id} className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(perm.id)}
                        onChange={() => togglePermission(perm.id)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm text-gray-800">{perm.label || perm.codename}</span>
                        <span className="block text-xs text-gray-500">{perm.codename}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : selectedRoleId ? 'Update Role' : 'Create Role'}
            </button>
            {selectedRoleId && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="inline-flex items-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </button>
            )}
            <span className="text-xs text-gray-500">
              Selected: {selectedPermissions.length} permission{selectedPermissions.length === 1 ? '' : 's'}
            </span>
          </div>
          {selectedPermissions.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Quick Preview</p>
              <div className="flex flex-wrap gap-2">
                {selectedPermissions.slice(0, 12).map((id) => (
                  <span key={id} className="rounded-md bg-white px-2 py-1 text-xs text-gray-700">
                    {permissionMap.get(id)?.codename || id}
                  </span>
                ))}
                {selectedPermissions.length > 12 && (
                  <span className="rounded-md bg-white px-2 py-1 text-xs text-gray-500">
                    +{selectedPermissions.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">User Store Access</h2>
          <div className="space-y-2">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => selectUser(u)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedUserId === u.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-medium">{u.username}</div>
                <div className="text-xs text-gray-500">{u.email || 'No email'}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Default Store
              </label>
              <select
                value={userDefaultStore}
                onChange={(e) => setUserDefaultStore(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              >
                <option value="">None</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Apply Role To Assigned Stores
              </label>
              <select
                value={userRoleId}
                onChange={(e) => setUserRoleId(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              >
                <option value="">No change</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
            <input
              type="checkbox"
              checked={userDashboardOnly}
              onChange={(e) => setUserDashboardOnly(e.target.checked)}
            />
            Dashboard-only mode (user can only access dashboard pages)
          </label>

          <div className="rounded-lg border border-gray-200 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">Assigned Stores</h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {stores.map((store) => (
                <label key={store.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={userAssignedStores.includes(store.id)}
                    onChange={() => toggleUserStore(store.id)}
                  />
                  <span className="text-sm text-gray-800">
                    {store.name} <span className="text-xs text-gray-500">({store.code})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveUserAccess}
              disabled={saving || !selectedUserId}
              className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="mr-2 h-4 w-4" />
              Save User Access
            </button>
            <span className="text-xs text-gray-500">
              Stores selected: {userAssignedStores.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
