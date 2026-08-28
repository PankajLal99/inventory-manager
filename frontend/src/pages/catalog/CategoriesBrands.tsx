import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogApi, customersApi } from '../../lib/api';
import { toast } from '../../lib/toast';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import PageHeader from '../../components/ui/PageHeader';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import { Tags, Plus, Pencil, Trash2, Search, Package, Users } from 'lucide-react';

type EntityType = 'category' | 'brand' | 'customer_group';

interface FormState {
  name: string;
  description: string;
  is_active: boolean;
  discount_percentage: string;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  is_active: true,
  discount_percentage: '0',
};

function entityLabel(type: EntityType, plural = false): string {
  if (type === 'category') return plural ? 'categories' : 'category';
  if (type === 'brand') return plural ? 'brands' : 'brand';
  return plural ? 'customer groups' : 'customer group';
}

function entityTitle(type: EntityType): string {
  if (type === 'category') return 'Category';
  if (type === 'brand') return 'Brand';
  return 'Customer Group';
}

function normalizeList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

function formatDiscount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n}%`;
}

export default function CategoriesBrands() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<EntityType>('category');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);

  const [deleteTarget, setDeleteTarget] = useState<{ type: EntityType; id: number; name: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const {
    data: categoriesData,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data || response;
    },
    retry: false,
  });

  const {
    data: brandsData,
    isLoading: brandsLoading,
    error: brandsError,
  } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data || response;
    },
    retry: false,
  });

  const {
    data: customerGroupsData,
    isLoading: customerGroupsLoading,
    error: customerGroupsError,
  } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data || response;
    },
    retry: false,
  });

  const categories = normalizeList(categoriesData);
  const brands = normalizeList(brandsData);
  const customerGroups = normalizeList(customerGroupsData);

  const matchesSearch = (item: any, q: string) =>
    [item.name, item.description].filter(Boolean).join(' ').toLowerCase().includes(q);

  const filteredCategories = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c: any) => matchesSearch(c, q));
  }, [categories, debouncedSearch]);

  const filteredBrands = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b: any) => matchesSearch(b, q));
  }, [brands, debouncedSearch]);

  const filteredCustomerGroups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return customerGroups;
    return customerGroups.filter((g: any) => matchesSearch(g, q));
  }, [customerGroups, debouncedSearch]);

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['brands'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const invalidateGroups = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  const catalogPayload = (data: FormState) => ({
    name: data.name,
    description: data.description,
    is_active: data.is_active,
  });

  const groupPayload = (data: FormState) => ({
    ...catalogPayload(data),
    discount_percentage: parseFloat(data.discount_percentage) || 0,
  });

  const createEntity = (type: EntityType, data: FormState) => {
    if (type === 'category') return catalogApi.categories.create(catalogPayload(data));
    if (type === 'brand') return catalogApi.brands.create(catalogPayload(data));
    return customersApi.groups.create(groupPayload(data));
  };

  const updateEntity = (type: EntityType, id: number, data: FormState) => {
    if (type === 'category') return catalogApi.categories.update(id, catalogPayload(data));
    if (type === 'brand') return catalogApi.brands.update(id, catalogPayload(data));
    return customersApi.groups.update(id, groupPayload(data));
  };

  const deleteEntity = (type: EntityType, id: number) => {
    if (type === 'category') return catalogApi.categories.delete(id);
    if (type === 'brand') return catalogApi.brands.delete(id);
    return customersApi.groups.delete(id);
  };

  const createMutation = useMutation({
    mutationFn: ({ type, data }: { type: EntityType; data: FormState }) => createEntity(type, data),
    onSuccess: (_res, vars) => {
      if (vars.type === 'customer_group') invalidateGroups();
      else invalidateCatalog();
      closeForm();
      toast(`${entityTitle(vars.type)} created successfully`, 'success');
    },
    onError: (error: any, vars) => {
      toast(
        error?.response?.data?.name?.[0] ||
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to create ${entityLabel(vars.type)}`,
        'error'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ type, id, data }: { type: EntityType; id: number; data: FormState }) =>
      updateEntity(type, id, data),
    onSuccess: (_res, vars) => {
      if (vars.type === 'customer_group') invalidateGroups();
      else invalidateCatalog();
      closeForm();
      toast(`${entityTitle(vars.type)} updated successfully`, 'success');
    },
    onError: (error: any, vars) => {
      toast(
        error?.response?.data?.name?.[0] ||
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to update ${entityLabel(vars.type)}`,
        'error'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: EntityType; id: number }) => deleteEntity(type, id),
    onSuccess: (_res, vars) => {
      if (vars.type === 'customer_group') invalidateGroups();
      else invalidateCatalog();
      setDeleteTarget(null);
      toast(
        vars.type === 'customer_group'
          ? 'Customer group deleted. Linked customers were kept and unlinked.'
          : `${entityTitle(vars.type)} deleted. Linked products were kept and unlinked.`,
        'success'
      );
    },
    onError: (error: any, vars) => {
      toast(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to delete ${entityLabel(vars.type)}`,
        'error'
      );
    },
  });

  const openCreate = (type: EntityType) => {
    setFormType(type);
    setEditingId(null);
    setFormData(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (type: EntityType, item: any) => {
    setFormType(type);
    setEditingId(item.id);
    setFormData({
      name: item.name || '',
      description: item.description || '',
      is_active: item.is_active !== false,
      discount_percentage:
        item.discount_percentage != null && item.discount_percentage !== ''
          ? String(item.discount_percentage)
          : '0',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    if (!name) {
      toast('Name is required', 'error');
      return;
    }
    const payload: FormState = {
      name,
      description: formData.description.trim(),
      is_active: formData.is_active,
      discount_percentage: formData.discount_percentage,
    };
    if (editingId != null) {
      updateMutation.mutate({ type: formType, id: editingId, data: payload });
    } else {
      createMutation.mutate({ type: formType, data: payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isLoading = categoriesLoading || brandsLoading || customerGroupsLoading;
  const error = categoriesError || brandsError || customerGroupsError;

  if (isLoading) {
    return <LoadingState message="Loading categories, brands, and customer groups..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading catalog settings. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const renderEntityTable = (type: EntityType, items: any[], allCount: number) => {
    const label = entityTitle(type);
    const plural = entityLabel(type, true);
    const showDiscount = type === 'customer_group';
    const EmptyIcon = type === 'category' ? Tags : type === 'brand' ? Package : Users;

    if (allCount === 0) {
      return (
        <EmptyState
          icon={EmptyIcon}
          title={`No ${plural} found`}
          message={`No ${plural} have been added yet`}
        />
      );
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={Search}
          title={`No matching ${plural}`}
          message="Try a different search term"
        />
      );
    }

    const headers = [
      { label: 'Name', align: 'left' as const },
      ...(showDiscount ? [{ label: 'Discount', align: 'center' as const }] : []),
      { label: 'Status', align: 'center' as const },
      { label: 'Actions', align: 'right' as const },
    ];

    return (
      <>
        <div className="hidden sm:block">
          <Table headers={headers}>
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium text-gray-900">{item.name}</div>
                  {item.description && (
                    <div className="text-sm text-gray-500 mt-0.5 line-clamp-1">{item.description}</div>
                  )}
                </TableCell>
                {showDiscount && (
                  <TableCell align="center">
                    <span className="text-sm text-gray-700">{formatDiscount(item.discount_percentage)}</span>
                  </TableCell>
                )}
                <TableCell align="center">
                  <Badge variant={item.is_active !== false ? 'success' : 'danger'}>
                    {item.is_active !== false ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(type, item)}
                      className="gap-1.5"
                      title={`Edit ${label.toLowerCase()}`}
                    >
                      <Pencil className="h-4 w-4" />
                      <span>Edit</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget({ type, id: item.id, name: item.name })}
                      className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      title={`Delete ${label.toLowerCase()}`}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </div>

        <div className="sm:hidden space-y-3">
          {items.map((item: any) => (
            <div key={item.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{item.name}</div>
                  {item.description && (
                    <div className="text-sm text-gray-500 mt-0.5 line-clamp-2">{item.description}</div>
                  )}
                  {showDiscount && (
                    <div className="text-sm text-gray-600 mt-1">
                      Discount: {formatDiscount(item.discount_percentage)}
                    </div>
                  )}
                </div>
                <Badge variant={item.is_active !== false ? 'success' : 'danger'}>
                  {item.is_active !== false ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(type, item)}
                  className="flex-1 gap-1.5"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget({ type, id: item.id, name: item.name })}
                  className="flex-1 gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories, Brands & Groups"
        subtitle="Manage product categories, brands, and customer groups. Deleting only unlinks related records — products and customers are not removed."
        icon={Tags}
      />

      <Card>
        <div className="p-4">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories, brands, and customer groups..."
          />
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            {filteredCategories.length} categories · {filteredBrands.length} brands · {filteredCustomerGroups.length} groups
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Categories</h2>
              <p className="text-sm text-gray-500">{categories.length} total</p>
            </div>
            <Button onClick={() => openCreate('category')} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Category
            </Button>
          </div>
          <div className="p-4">{renderEntityTable('category', filteredCategories, categories.length)}</div>
        </Card>

        <Card>
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Brands</h2>
              <p className="text-sm text-gray-500">{brands.length} total</p>
            </div>
            <Button onClick={() => openCreate('brand')} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Brand
            </Button>
          </div>
          <div className="p-4">{renderEntityTable('brand', filteredBrands, brands.length)}</div>
        </Card>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Customer Groups</h2>
            <p className="text-sm text-gray-500">{customerGroups.length} total</p>
          </div>
          <Button onClick={() => openCreate('customer_group')} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Customer Group
          </Button>
        </div>
        <div className="p-4">
          {renderEntityTable('customer_group', filteredCustomerGroups, customerGroups.length)}
        </div>
      </Card>

      {formOpen && (
        <Modal
          isOpen={formOpen}
          onClose={closeForm}
          title={editingId != null ? `Edit ${entityTitle(formType)}` : `Add ${entityTitle(formType)}`}
          size="md"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name *"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              autoFocus
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional"
              />
            </div>
            {formType === 'customer_group' && (
              <Input
                label="Discount Percentage"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formData.discount_percentage}
                onChange={(e) => setFormData({ ...formData, discount_percentage: e.target.value })}
                placeholder="0.00"
              />
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="rounded border-gray-300"
              />
              Active
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || !formData.name.trim()}>
                {isSaving ? 'Saving...' : editingId != null ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title={`Delete ${entityLabel(deleteTarget.type)}?`}
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              You are about to delete <strong>{deleteTarget.name}</strong>.
            </p>
            {deleteTarget.type === 'customer_group' ? (
              <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
                <li>Customers in this group will <strong>not</strong> be deleted</li>
                <li>Those customers will have their group cleared (set to empty)</li>
                <li>Price lists linked to this group will also have their group cleared</li>
              </ul>
            ) : (
              <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
                <li>Products linked to this {deleteTarget.type} will <strong>not</strong> be deleted</li>
                <li>
                  Those products will have their {deleteTarget.type} cleared (set to empty)
                </li>
                <li>Category and brand are independent — deleting one does not affect the other</li>
              </ul>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() =>
                  deleteMutation.mutate({ type: deleteTarget.type, id: deleteTarget.id })
                }
                disabled={deleteMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
