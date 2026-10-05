import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { customNavLinksApi } from '../../lib/api';
import { auth } from '../../lib/auth';
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
import { Link2, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';

interface FormState {
  name: string;
  url: string;
  sort_order: string;
  is_active: boolean;
  user_ids: number[];
  group_ids: number[];
  logoFile: File | null;
}

const emptyForm: FormState = {
  name: '',
  url: '',
  sort_order: '0',
  is_active: true,
  user_ids: [],
  group_ids: [],
  logoFile: null,
};

function buildFormData(form: FormState): FormData {
  const fd = new FormData();
  fd.append('name', form.name.trim());
  fd.append('url', form.url.trim());
  fd.append('sort_order', String(parseInt(form.sort_order, 10) || 0));
  fd.append('is_active', form.is_active ? 'true' : 'false');
  fd.append('user_ids', JSON.stringify(form.user_ids));
  fd.append('group_ids', JSON.stringify(form.group_ids));
  if (form.logoFile) {
    fd.append('logo', form.logoFile);
  }
  return fd;
}

export default function CustomNavLinks() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(auth.getUser());
  const userGroups = user?.groups || [];
  const isAdminGroup = userGroups.includes('Admin');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    if (!user) {
      auth.loadUser('main').then((loaded) => setUser(loaded)).catch(() => {});
    }
  }, [user]);

  const {
    data: linksData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['custom-nav-links'],
    queryFn: async () => {
      const response = await customNavLinksApi.list();
      return response.data || response;
    },
    enabled: isAdminGroup,
    retry: false,
  });

  const { data: optionsData } = useQuery({
    queryKey: ['custom-nav-links-options'],
    queryFn: async () => {
      const response = await customNavLinksApi.options();
      return response.data || response;
    },
    enabled: isAdminGroup,
    retry: false,
  });

  const links: any[] = useMemo(() => {
    if (!linksData) return [];
    if (Array.isArray(linksData)) return linksData;
    if (Array.isArray(linksData.results)) return linksData.results;
    return [];
  }, [linksData]);

  const users: Array<{ id: number; username: string }> = optionsData?.users || [];
  const groups: Array<{ id: number; name: string }> = optionsData?.groups || [];

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormData(emptyForm);
    setLogoPreview(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setLogoPreview(null);
    setFormOpen(true);
  };

  const openEdit = (link: any) => {
    setEditingId(link.id);
    setFormData({
      name: link.name || '',
      url: link.url || '',
      sort_order: String(link.sort_order ?? 0),
      is_active: link.is_active !== false,
      user_ids: (link.users || []).map((u: any) => u.id),
      group_ids: (link.groups || []).map((g: any) => g.id),
      logoFile: null,
    });
    setLogoPreview(link.logo_url || null);
    setFormOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (data: FormData) => customNavLinksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links'] });
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links-mine'] });
      closeForm();
      toast('Custom link created', 'success');
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.url?.[0] ||
          err?.response?.data?.name?.[0] ||
          err?.response?.data?.error ||
          err?.response?.data?.detail ||
          'Failed to create custom link',
        'error'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormData }) =>
      customNavLinksApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links'] });
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links-mine'] });
      closeForm();
      toast('Custom link updated', 'success');
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.url?.[0] ||
          err?.response?.data?.name?.[0] ||
          err?.response?.data?.error ||
          err?.response?.data?.detail ||
          'Failed to update custom link',
        'error'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customNavLinksApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links'] });
      queryClient.invalidateQueries({ queryKey: ['custom-nav-links-mine'] });
      setDeleteTarget(null);
      toast('Custom link deleted', 'success');
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.error ||
          err?.response?.data?.detail ||
          'Failed to delete custom link',
        'error'
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.url.trim()) {
      toast('Name and URL are required', 'error');
      return;
    }
    const payload = buildFormData(formData);
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  if (user && !isAdminGroup) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom Links"
        subtitle="Create sidebar buttons with a name, logo, and URL. Assign them to users or groups."
        icon={Link2}
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Link
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message="Failed to load custom links" />
        ) : links.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No custom links yet"
            message="Create a link and assign it to users or groups."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Link
              </Button>
            }
          />
        ) : (
          <Table headers={['Logo', 'Name', 'URL', 'Assigned', 'Order', 'Status', '']}>
            {links.map((link) => (
              <TableRow key={link.id}>
                <TableCell>
                  {link.logo_url ? (
                    <img
                      src={link.logo_url}
                      alt=""
                      className="h-8 w-8 rounded object-contain bg-gray-50"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center">
                      <ExternalLink className="h-4 w-4 text-gray-400" />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <span className="font-medium text-gray-900">{link.name}</span>
                </TableCell>
                <TableCell>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline truncate max-w-[220px] inline-block"
                  >
                    {link.url}
                  </a>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {(link.groups || []).map((g: any) => (
                      <Badge key={`g-${g.id}`} variant="info">
                        {g.name}
                      </Badge>
                    ))}
                    {(link.users || []).map((u: any) => (
                      <Badge key={`u-${u.id}`} variant="default">
                        {u.username}
                      </Badge>
                    ))}
                    {!(link.groups || []).length && !(link.users || []).length && (
                      <span className="text-xs text-gray-400">Nobody yet</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{link.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={link.is_active ? 'success' : 'warning'}>
                    {link.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => openEdit(link)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: link.id, name: link.name })}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      <Modal
        isOpen={formOpen}
        onClose={closeForm}
        title={editingId ? 'Edit Custom Link' : 'Add Custom Link'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Button name"
            value={formData.name}
            onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="e.g. Salary Portal"
          />
          <Input
            label="URL (opens in new tab)"
            type="url"
            value={formData.url}
            onChange={(e) => setFormData((f) => ({ ...f, url: e.target.value }))}
            required
            placeholder="https://example.com"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Sort order"
              type="number"
              min={0}
              value={formData.sort_order}
              onChange={(e) => setFormData((f) => ({ ...f, sort_order: e.target.value }))}
            />
            <label className="flex items-center gap-2 pt-7 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData((f) => ({ ...f, is_active: e.target.checked }))}
                className="rounded border-gray-300"
              />
              Active
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
            <div className="flex items-center gap-4">
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt=""
                  className="h-12 w-12 rounded object-contain bg-gray-50 border border-gray-200"
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setFormData((f) => ({ ...f, logoFile: file }));
                  if (file) {
                    setLogoPreview(URL.createObjectURL(file));
                  }
                }}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign to groups
            </label>
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-1.5">
              {groups.length === 0 ? (
                <p className="text-xs text-gray-400">No groups found</p>
              ) : (
                groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formData.group_ids.includes(g.id)}
                      onChange={() =>
                        setFormData((f) => ({
                          ...f,
                          group_ids: toggleId(f.group_ids, g.id),
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    {g.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign to users
            </label>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-1.5">
              {users.length === 0 ? (
                <p className="text-xs text-gray-400">No users found</p>
              ) : (
                users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formData.user_ids.includes(u.id)}
                      onChange={() =>
                        setFormData((f) => ({
                          ...f,
                          user_ids: toggleId(f.user_ids, u.id),
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    {u.username}
                    <span className="text-xs text-gray-400">#{u.id}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? 'Save changes' : 'Create link'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete custom link"
        size="sm"
      >
        <p className="text-sm text-gray-600 mb-4">
          Delete <span className="font-medium text-gray-900">{deleteTarget?.name}</span>? This
          cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
