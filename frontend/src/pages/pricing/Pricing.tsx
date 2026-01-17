import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pricingApi, customersApi } from '../../lib/api';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { Coins, Plus, Tag, Edit, Trash2 } from 'lucide-react';

export default function Pricing() {
  const [activeTab, setActiveTab] = useState<'price-lists' | 'promotions'>('price-lists');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    customer_group: '',
    valid_from: new Date().toISOString().split('T')[0],
    valid_to: '',
    is_active: true,
    // Promotion-specific
    promotion_type: 'cart_total',
    discount_type: 'percentage',
    discount_value: '',
  });
  const queryClient = useQueryClient();

  const { data: priceLists, error: priceListsError } = useQuery({
    queryKey: ['price-lists'],
    queryFn: async () => {
      const response = await pricingApi.priceLists.list();
      return response.data;
    },
    enabled: activeTab === 'price-lists',
    retry: false,
  });

  const { data: promotions, error: promotionsError } = useQuery({
    queryKey: ['promotions'],
    queryFn: async () => {
      const response = await pricingApi.promotions.list();
      return response.data;
    },
    enabled: activeTab === 'promotions',
    retry: false,
  });

  // Fetch customer groups
  const { data: customerGroupsData } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data;
    },
    retry: false,
  });

  const createPriceListMutation = useMutation({
    mutationFn: (data: any) => pricingApi.priceLists.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      setShowForm(false);
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to create price list');
    },
  });

  const updatePriceListMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => pricingApi.priceLists.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to update price list');
    },
  });

  const deletePriceListMutation = useMutation({
    mutationFn: (id: number) => pricingApi.priceLists.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-lists'] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to delete price list');
    },
  });

  const createPromotionMutation = useMutation({
    mutationFn: (data: any) => pricingApi.promotions.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowForm(false);
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to create promotion');
    },
  });

  const updatePromotionMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => pricingApi.promotions.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to update promotion');
    },
  });

  const deletePromotionMutation = useMutation({
    mutationFn: (id: number) => pricingApi.promotions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to delete promotion');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      customer_group: '',
      valid_from: new Date().toISOString().split('T')[0],
      valid_to: '',
      is_active: true,
      promotion_type: 'cart_total',
      discount_type: 'percentage',
      discount_value: '',
    });
    setEditingItem(null);
  };

  const handleEdit = (item: any) => {
    setEditingItem(item.id);
    setFormData({
      name: item.name || '',
      customer_group: item.customer_group?.toString() || '',
      valid_from: item.valid_from || new Date().toISOString().split('T')[0],
      valid_to: item.valid_to || '',
      is_active: item.is_active !== false,
      promotion_type: item.promotion_type || 'cart_total',
      discount_type: item.discount_type || 'percentage',
      discount_value: item.discount_value?.toString() || '',
    });
    setShowForm(true);
  };

  const handleDelete = (id: number) => {
    const itemType = activeTab === 'price-lists' ? 'price list' : 'promotion';
    if (confirm(`Are you sure you want to delete this ${itemType}?`)) {
      if (activeTab === 'price-lists') {
        deletePriceListMutation.mutate(id);
      } else {
        deletePromotionMutation.mutate(id);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'price-lists') {
      const submitData: any = {
        name: formData.name,
        valid_from: formData.valid_from,
        is_active: formData.is_active,
      };
      if (formData.customer_group) submitData.customer_group = parseInt(formData.customer_group);
      if (formData.valid_to) submitData.valid_to = formData.valid_to;

      if (editingItem) {
        updatePriceListMutation.mutate({ id: editingItem, data: submitData });
      } else {
        createPriceListMutation.mutate(submitData);
      }
    } else {
      const submitData: any = {
        name: formData.name,
        promotion_type: formData.promotion_type,
        discount_type: formData.discount_type,
        discount_value: parseFloat(formData.discount_value || '0'),
        valid_from: formData.valid_from,
        is_active: formData.is_active,
      };
      if (formData.customer_group) submitData.customer_group = parseInt(formData.customer_group);
      if (formData.valid_to) submitData.valid_to = formData.valid_to;

      if (editingItem) {
        updatePromotionMutation.mutate({ id: editingItem, data: submitData });
      } else {
        createPromotionMutation.mutate(submitData);
      }
    }
  };

  const priceListsArray = (() => {
    if (!priceLists) return [];
    if (Array.isArray(priceLists.results)) return priceLists.results;
    if (Array.isArray(priceLists.data)) return priceLists.data;
    if (Array.isArray(priceLists)) return priceLists;
    return [];
  })();

  const promotionsArray = (() => {
    if (!promotions) return [];
    if (Array.isArray(promotions.results)) return promotions.results;
    if (Array.isArray(promotions.data)) return promotions.data;
    if (Array.isArray(promotions)) return promotions;
    return [];
  })();

  const customerGroups = (() => {
    if (!customerGroupsData) return [];
    if (Array.isArray(customerGroupsData.results)) return customerGroupsData.results;
    if (Array.isArray(customerGroupsData.data)) return customerGroupsData.data;
    if (Array.isArray(customerGroupsData)) return customerGroupsData;
    return [];
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Pricing</h1>
        <Button onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-5 w-5 mr-2 inline" />
          {activeTab === 'price-lists' ? 'New Price List' : 'New Promotion'}
        </Button>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex space-x-4">
          <button
            onClick={() => { setActiveTab('price-lists'); resetForm(); }}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
              activeTab === 'price-lists'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Coins className="h-4 w-4 mr-2" />
            Price Lists
          </button>
          <button
            onClick={() => { setActiveTab('promotions'); resetForm(); }}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
              activeTab === 'promotions'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Tag className="h-4 w-4 mr-2" />
            Promotions
          </button>
        </div>
      </div>

      {activeTab === 'price-lists' ? (
        priceListsError ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-red-600">Error loading price lists</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Table headers={['Name', 'Customer Group', 'Items', 'Status', 'Valid From', 'Valid To', 'Actions']}>
                {priceListsArray.length > 0 ? priceListsArray.map((list: any) => (
                  <tr key={list.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{list.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {list.customer_group_name || list.customer_group?.name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{list.items?.length || 0}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={list.is_active !== false ? 'success' : 'default'}>
                        {list.is_active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {list.valid_from ? new Date(list.valid_from).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {list.valid_to ? new Date(list.valid_to).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(list)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(list.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete"
                          disabled={deletePriceListMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No price lists found
                    </td>
                  </tr>
                )}
              </Table>
            </div>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {priceListsArray.length > 0 ? priceListsArray.map((list: any) => (
                <div key={list.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-semibold text-gray-900 text-base mb-1">{list.name}</h4>
                        <Badge variant={list.is_active !== false ? 'success' : 'default'} className="inline-flex">
                          {list.is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(list)}
                          className="text-blue-600 hover:text-blue-900 transition-colors p-2 hover:bg-blue-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(list.id)}
                          className="text-red-600 hover:text-red-900 transition-colors p-2 hover:bg-red-50 rounded-lg"
                          title="Delete"
                          disabled={deletePriceListMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100 space-y-2">
                      {(list.customer_group_name || list.customer_group?.name) && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-24 flex-shrink-0">Group</span>
                          <span className="text-sm text-gray-900">{list.customer_group_name || list.customer_group?.name}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Items</div>
                          <div className="text-sm font-semibold text-gray-900">{list.items?.length || 0}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Valid From</div>
                          <div className="text-sm text-gray-900">{list.valid_from ? new Date(list.valid_from).toLocaleDateString() : '-'}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Valid To</div>
                          <div className="text-sm text-gray-900">{list.valid_to ? new Date(list.valid_to).toLocaleDateString() : '-'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                  No price lists found
                </div>
              )}
            </div>
          </>
        )
      ) : (
        promotionsError ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-red-600">Error loading promotions</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Table headers={['Name', 'Type', 'Discount', 'Valid From', 'Valid To', 'Status', 'Actions']}>
                {promotionsArray.length > 0 ? promotionsArray.map((promo: any) => (
                  <tr key={promo.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{promo.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {promo.promotion_type?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {promo.discount_type === 'percentage' 
                        ? `${promo.discount_value}%` 
                        : `₹${promo.discount_value}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {promo.valid_from ? new Date(promo.valid_from).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {promo.valid_to ? new Date(promo.valid_to).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={promo.is_active !== false ? 'success' : 'default'}>
                        {promo.is_active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(promo)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(promo.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete"
                          disabled={deletePromotionMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No promotions found
                    </td>
                  </tr>
                )}
              </Table>
            </div>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {promotionsArray.length > 0 ? promotionsArray.map((promo: any) => (
                <div key={promo.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-semibold text-gray-900 text-base mb-1">{promo.name}</h4>
                        <Badge variant={promo.is_active !== false ? 'success' : 'default'} className="inline-flex">
                          {promo.is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(promo)}
                          className="text-blue-600 hover:text-blue-900 transition-colors p-2 hover:bg-blue-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(promo.id)}
                          className="text-red-600 hover:text-red-900 transition-colors p-2 hover:bg-red-50 rounded-lg"
                          title="Delete"
                          disabled={deletePromotionMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Type</div>
                          <div className="text-sm text-gray-900 capitalize">{promo.promotion_type?.replace(/_/g, ' ')}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Discount</div>
                          <div className="text-base font-bold text-gray-900">
                            {promo.discount_type === 'percentage' 
                              ? `${promo.discount_value}%` 
                              : `₹${promo.discount_value}`}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Valid From</div>
                          <div className="text-sm text-gray-900">{promo.valid_from ? new Date(promo.valid_from).toLocaleDateString() : '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Valid To</div>
                          <div className="text-sm text-gray-900">{promo.valid_to ? new Date(promo.valid_to).toLocaleDateString() : '-'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                  No promotions found
                </div>
              )}
            </div>
          </>
        )
      )}

      {showForm && (
        <Modal
          isOpen={showForm}
          onClose={() => { setShowForm(false); resetForm(); }}
          title={editingItem 
            ? `Edit ${activeTab === 'price-lists' ? 'Price List' : 'Promotion'}` 
            : `New ${activeTab === 'price-lists' ? 'Price List' : 'Promotion'}`}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name *"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Group</label>
              <select
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={formData.customer_group}
                onChange={(e) => setFormData({ ...formData, customer_group: e.target.value })}
              >
                <option value="">None</option>
                {customerGroups.map((group: any) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            {activeTab === 'promotions' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Promotion Type *</label>
                  <select
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={formData.promotion_type}
                    onChange={(e) => setFormData({ ...formData, promotion_type: e.target.value })}
                    required
                  >
                    <option value="cart_total">Cart Total</option>
                    <option value="buy_x_get_y">Buy X Get Y</option>
                    <option value="category">Category</option>
                    <option value="brand">Brand</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type *</label>
                  <select
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={formData.discount_type}
                    onChange={(e) => setFormData({ ...formData, discount_type: e.target.value })}
                    required
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>
                <Input
                  label="Discount Value *"
                  type="number"
                  step="0.01"
                  value={formData.discount_value}
                  onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                  required
                />
              </>
            )}
            <Input
              label="Valid From *"
              type="date"
              value={formData.valid_from}
              onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
              required
            />
            <Input
              label="Valid To"
              type="date"
              value={formData.valid_to}
              onChange={(e) => setFormData({ ...formData, valid_to: e.target.value })}
            />
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                Active
              </label>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  activeTab === 'price-lists'
                    ? createPriceListMutation.isPending || updatePriceListMutation.isPending
                    : createPromotionMutation.isPending || updatePromotionMutation.isPending
                }
              >
                {activeTab === 'price-lists'
                  ? createPriceListMutation.isPending || updatePriceListMutation.isPending
                    ? 'Saving...'
                    : 'Save'
                  : createPromotionMutation.isPending || updatePromotionMutation.isPending
                  ? 'Saving...'
                  : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
