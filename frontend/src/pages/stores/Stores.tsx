import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { Navigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { Store as StoreIcon, Plus, Edit, Trash2, CheckCircle, XCircle, Filter } from 'lucide-react';

export default function Stores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get('is_active') || '');
  const [shopTypeFilter, setShopTypeFilter] = useState(searchParams.get('shop_type') || '');
  const [showForm, setShowForm] = useState(false);
  const [editingStore, setEditingStore] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    shop_type: 'retail',
    address: '',
    phone: '',
    email: '',
    is_active: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const queryClient = useQueryClient();

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const [user, setUser] = useState(auth.getUser());
  // Check admin status: is_admin flag, is_staff flag, is_superuser flag, or Admin/RetailAdmin/WholesaleAdmin group membership
  const userGroups = user?.groups || [];
  const isAdmin = Boolean(
    user?.is_admin || 
    user?.is_staff || 
    user?.is_superuser || 
    (userGroups && (userGroups.includes('Admin') || userGroups.includes('RetailAdmin') || userGroups.includes('WholesaleAdmin')))
  );

  useEffect(() => {
    if (!user) {
      auth.loadUser().then((loadedUser) => {
        setUser(loadedUser);
      });
    }
  }, [user]);

  const { data: storesResponse, isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data;
    },
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => catalogApi.stores.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      setShowForm(false);
      resetForm();
      setError(null);
      showToast('Store created successfully!', 'success');
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.detail || 'Failed to create store';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => catalogApi.stores.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      setShowForm(false);
      setEditingStore(null);
      resetForm();
      setError(null);
      showToast('Store updated successfully!', 'success');
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.detail || 'Failed to update store';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => catalogApi.stores.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      showToast('Store deleted successfully!', 'success');
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.detail || 'Failed to delete store';
      showToast(errorMessage, 'error');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      shop_type: 'retail',
      address: '',
      phone: '',
      email: '',
      is_active: true,
    });
    setEditingStore(null);
    setError(null);
  };

  const handleEdit = (store: any) => {
    setEditingStore(store);
    setFormData({
      name: store.name || '',
      code: store.code || '',
      shop_type: store.shop_type || 'retail',
      address: store.address || '',
      phone: store.phone || '',
      email: store.email || '',
      is_active: store.is_active !== undefined ? store.is_active : true,
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Trim all string fields
    const trimmedData = {
      ...formData,
      name: formData.name.trim(),
      code: formData.code.trim(),
      address: formData.address.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
    };
    if (editingStore) {
      updateMutation.mutate({ id: editingStore.id, data: trimmedData });
    } else {
      createMutation.mutate(trimmedData);
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm('Are you sure you want to delete this store? This action cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  // Sync URL params with state on mount
  useEffect(() => {
    const urlStatus = searchParams.get('is_active') || '';
    const urlShopType = searchParams.get('shop_type') || '';
    
    if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    if (urlShopType !== shopTypeFilter) setShopTypeFilter(urlShopType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('is_active', statusFilter);
    if (shopTypeFilter) params.set('shop_type', shopTypeFilter);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, shopTypeFilter]);

  const allStores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Client-side filtering
  const stores = useMemo(() => {
    let filtered = allStores;
    
    if (statusFilter) {
      const isActive = statusFilter === 'true';
      filtered = filtered.filter((s: any) => s.is_active === isActive);
    }
    
    if (shopTypeFilter) {
      filtered = filtered.filter((s: any) => s.shop_type === shopTypeFilter);
    }
    
    return filtered;
  }, [allStores, statusFilter, shopTypeFilter]);

  // Redirect if not admin
  if (user && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <StoreIcon className="h-8 w-8 text-blue-600" />
            Stores Management
          </h1>
          <p className="text-gray-600 mt-1">Manage your retail and wholesale stores</p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          <Plus className="h-5 w-5 mr-2 inline" />
          Add Store
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
          <Select
            value={shopTypeFilter}
            onChange={(e) => setShopTypeFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Shop Types</option>
            <option value="retail">Retail Shop</option>
            <option value="wholesale">Wholesale Shop</option>
          </Select>
        </div>
      </Card>

      {/* Stores List */}
      <div className="bg-white rounded-2xl shadow p-6">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : stores.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <StoreIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p>No stores found. Create your first store!</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Code</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Shop Type</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Phone</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {stores.map((store: any) => (
                  <tr key={store.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 text-sm font-medium text-gray-900">{store.name}</td>
                    <td className="py-4 px-4 text-sm text-gray-600 font-mono">{store.code}</td>
                    <td className="py-4 px-4 text-sm">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {store.shop_type === 'retail' ? 'Retail' : 'Wholesale'}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">{store.phone || <span className="text-gray-400">-</span>}</td>
                    <td className="py-4 px-4 text-sm text-gray-600">{store.email || <span className="text-gray-400">-</span>}</td>
                    <td className="py-4 px-4">
                      {store.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          <XCircle className="h-3.5 w-3.5 mr-1.5" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(store)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          title="Edit store"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(store.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete store"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Form Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          resetForm();
        }}
        title={editingStore ? 'Edit Store' : 'Create New Store'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Store Name *
              </label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Enter store name"
              />
            </div>
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                Store Code *
              </label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                required
                placeholder="Enter unique store code"
                className="font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="shop_type" className="block text-sm font-medium text-gray-700 mb-2">
              Shop Type *
            </label>
            <select
              id="shop_type"
              value={formData.shop_type}
              onChange={(e) => setFormData({ ...formData, shop_type: e.target.value })}
              required
              className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
            >
              <option value="retail">Retail Shop</option>
              <option value="wholesale">Wholesale Shop</option>
            </select>
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
              Address
            </label>
            <textarea
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={3}
              className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
              placeholder="Enter store address"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Phone
              </label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Enter phone number"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              id="is_active"
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-2 focus:ring-blue-500 border-gray-300 rounded transition-colors"
            />
            <label htmlFor="is_active" className="ml-2 block text-sm text-gray-700 cursor-pointer">
              Store is active
            </label>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingStore
                ? updateMutation.isPending
                  ? 'Updating...'
                  : 'Update Store'
                : createMutation.isPending
                ? 'Creating...'
                : 'Create Store'}
            </Button>
          </div>
        </form>
      </Modal>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

