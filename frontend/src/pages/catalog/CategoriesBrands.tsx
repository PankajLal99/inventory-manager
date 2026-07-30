import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../lib/api';
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
import { Tags, Plus, Pencil, Trash2, Search, Package } from 'lucide-react';

type EntityType = 'category' | 'brand';

interface FormState {
  name: string;
  description: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '',
  description: '',
  is_active: true,
};

function normalizeList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
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

  const categories = normalizeList(categoriesData);
  const brands = normalizeList(brandsData);

  const filteredCategories = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c: any) =>
      [c.name, c.description].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [categories, debouncedSearch]);

  const filteredBrands = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b: any) =>
      [b.name, b.description].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [brands, debouncedSearch]);

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['brands'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const createMutation = useMutation({
    mutationFn: ({ type, data }: { type: EntityType; data: FormState }) =>
      type === 'category'
        ? catalogApi.categories.create(data)
        : catalogApi.brands.create(data),
    onSuccess: (_res, vars) => {
      invalidateCatalog();
      closeForm();
      toast(`${vars.type === 'category' ? 'Category' : 'Brand'} created successfully`, 'success');
    },
    onError: (error: any, vars) => {
      const label = vars.type === 'category' ? 'category' : 'brand';
      toast(
        error?.response?.data?.name?.[0] ||
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to create ${label}`,
        'error'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ type, id, data }: { type: EntityType; id: number; data: FormState }) =>
      type === 'category'
        ? catalogApi.categories.update(id, data)
        : catalogApi.brands.update(id, data),
    onSuccess: (_res, vars) => {
      invalidateCatalog();
      closeForm();
      toast(`${vars.type === 'category' ? 'Category' : 'Brand'} updated successfully`, 'success');
    },
    onError: (error: any, vars) => {
      const label = vars.type === 'category' ? 'category' : 'brand';
      toast(
        error?.response?.data?.name?.[0] ||
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to update ${label}`,
        'error'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: EntityType; id: number }) =>
      type === 'category'
        ? catalogApi.categories.delete(id)
        : catalogApi.brands.delete(id),
    onSuccess: (_res, vars) => {
      invalidateCatalog();
      setDeleteTarget(null);
      toast(
        `${vars.type === 'category' ? 'Category' : 'Brand'} deleted. Linked products were kept and unlinked.`,
        'success'
      );
    },
    onError: (error: any, vars) => {
      const label = vars.type === 'category' ? 'category' : 'brand';
      toast(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          `Failed to delete ${label}`,
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
    const payload = {
      name,
      description: formData.description.trim(),
      is_active: formData.is_active,
    };
    if (editingId != null) {
      updateMutation.mutate({ type: formType, id: editingId, data: payload });
    } else {
      createMutation.mutate({ type: formType, data: payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isLoading = categoriesLoading || brandsLoading;
  const error = categoriesError || brandsError;

  if (isLoading) {
    return <LoadingState message="Loading categories and brands..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading categories and brands. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const renderEntityTable = (type: EntityType, items: any[], allCount: number) => {
    const label = type === 'category' ? 'Category' : 'Brand';
    const plural = type === 'category' ? 'categories' : 'brands';

    if (allCount === 0) {
      return (
        <EmptyState
          icon={type === 'category' ? Tags : Package}
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

    return (
      <>
        <div className="hidden sm:block">
          <Table
            headers={[
              { label: 'Name', align: 'left' },
              { label: 'Status', align: 'center' },
              { label: 'Actions', align: 'right' },
            ]}
          >
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium text-gray-900">{item.name}</div>
                  {item.description && (
                    <div className="text-sm text-gray-500 mt-0.5 line-clamp-1">{item.description}</div>
                  )}
                </TableCell>
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
        title="Categories & Brands"
        subtitle="Manage product categories and brands. Deleting either only unlinks products — products are not removed."
        icon={Tags}
      />

      <Card>
        <div className="p-4">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories and brands..."
          />
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            {filteredCategories.length} categories · {filteredBrands.length} brands
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

      {formOpen && (
        <Modal
          isOpen={formOpen}
          onClose={closeForm}
          title={
            editingId != null
              ? `Edit ${formType === 'category' ? 'Category' : 'Brand'}`
              : `Add ${formType === 'category' ? 'Category' : 'Brand'}`
          }
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
          title={`Delete ${deleteTarget.type === 'category' ? 'category' : 'brand'}?`}
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              You are about to delete <strong>{deleteTarget.name}</strong>.
            </p>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>Products linked to this {deleteTarget.type} will <strong>not</strong> be deleted</li>
              <li>
                Those products will have their {deleteTarget.type} cleared (set to empty)
              </li>
              <li>Category and brand are independent — deleting one does not affect the other</li>
            </ul>
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
