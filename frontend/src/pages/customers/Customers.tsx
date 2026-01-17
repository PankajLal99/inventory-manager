import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { customersApi } from '../../lib/api';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import { Users, Plus, Edit, Trash2, Search, X, Filter, TrendingUp, DollarSign, ArrowRight } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useNavigate } from 'react-router-dom';

export default function Customers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('is_active') || '');
  const [customerGroupFilter, setCustomerGroupFilter] = useState(searchParams.get('customer_group') || '');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<number | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupData, setNewGroupData] = useState({
    name: '',
    description: '',
    discount_percentage: '0',
  });
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    customer_group: '',
    credit_limit: '',
    is_active: true,
  });
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [debouncedNameSearch, setDebouncedNameSearch] = useState('');
  const queryClient = useQueryClient();

  // Debounce name search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNameSearch(nameSearchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [nameSearchQuery]);
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    const urlStatus = searchParams.get('is_active') || '';
    const urlGroup = searchParams.get('customer_group') || '';

    if (urlSearch !== search) setSearch(urlSearch);
    if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    if (urlGroup !== customerGroupFilter) setCustomerGroupFilter(urlGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('is_active', statusFilter);
    if (customerGroupFilter) params.set('customer_group', customerGroupFilter);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, customerGroupFilter]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', search],
    queryFn: async () => {
      const response = await customersApi.list({ search });
      return response.data;
    },
    retry: false,
    placeholderData: keepPreviousData,
  });

  // Client-side filtering
  const filteredCustomers = useMemo(() => {
    if (!data) return [];
    let allCustomers = Array.isArray(data) ? data : (data.results || data.data || []);

    if (statusFilter) {
      const isActive = statusFilter === 'true';
      allCustomers = allCustomers.filter((c: any) => c.is_active === isActive);
    }

    if (customerGroupFilter) {
      allCustomers = allCustomers.filter((c: any) =>
        c.customer_group?.toString() === customerGroupFilter ||
        c.customer_group === parseInt(customerGroupFilter)
      );
    }

    return allCustomers;
  }, [data, statusFilter, customerGroupFilter]);

  // Fetch customer groups for dropdown
  const { data: customerGroupsData } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data;
    },
    retry: false,
  });

  // Fetch existing customers for name search in modal
  const { data: existingCustomersData } = useQuery({
    queryKey: ['customers-search', debouncedNameSearch],
    queryFn: async () => {
      if (!debouncedNameSearch) return [];
      const response = await customersApi.list({ search: debouncedNameSearch });
      return response.data;
    },
    enabled: !!debouncedNameSearch && showForm && !editingCustomer, // Only run when creating new customer and typed name
  });

  const existingCustomers = useMemo(() => {
    if (!existingCustomersData) return [];
    const list = Array.isArray(existingCustomersData) ? existingCustomersData : (existingCustomersData.results || existingCustomersData.data || []);
    // Filter out exact match to show "Already exists" warning differently if needed, 
    // but request asked to "show existing names like a customer search"
    return list;
  }, [existingCustomersData]);

  const createMutation = useMutation({
    mutationFn: (data: any) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      resetForm();
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message || 'Failed to create customer', 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      setEditingCustomer(null);
      resetForm();
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message || 'Failed to update customer', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message || 'Failed to delete customer', 'error');
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: (data: any) => customersApi.groups.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
      const newGroup = response.data;
      setFormData({ ...formData, customer_group: newGroup.id.toString() });
      setShowCreateGroup(false);
      setNewGroupData({ name: '', description: '', discount_percentage: '0' });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message || 'Failed to create customer group', 'error');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      address: '',
      customer_group: '',
      credit_limit: '',
      is_active: true,
    });
    setEditingCustomer(null);
    setShowCreateGroup(false);
    setEditingCustomer(null);
    setShowCreateGroup(false);
    setNewGroupData({ name: '', description: '', discount_percentage: '0' });
    setNameSearchQuery('');
    setDebouncedNameSearch('');
  };

  const handleEdit = (customer: any) => {
    setEditingCustomer(customer.id);
    setFormData({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      customer_group: customer.customer_group?.toString() || '',
      credit_limit: customer.credit_limit?.toString() || '',
      is_active: customer.is_active !== false,
    });
    setShowForm(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this customer?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = {
      name: formData.name.trim(),
      is_active: formData.is_active,
    };

    if (formData.phone?.trim()) submitData.phone = formData.phone.trim();
    if (formData.email?.trim()) submitData.email = formData.email.trim();
    if (formData.address?.trim()) submitData.address = formData.address.trim();
    if (formData.customer_group) submitData.customer_group = parseInt(formData.customer_group);
    if (formData.credit_limit) submitData.credit_limit = parseFloat(formData.credit_limit);

    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  // Use filteredCustomers instead of customers
  const customerGroups = (() => {
    if (!customerGroupsData) return [];
    if (Array.isArray(customerGroupsData.results)) return customerGroupsData.results;
    if (Array.isArray(customerGroupsData.data)) return customerGroupsData.data;
    if (Array.isArray(customerGroupsData)) return customerGroupsData;
    return [];
  })();

  // Calculate totals including Personal Ledger entries (credit_balance already includes both)
  const totals = useMemo(() => {
    if (!filteredCustomers || filteredCustomers.length === 0) {
      return {
        totalCreditBalance: 0,
        totalCreditLimit: 0,
        totalCustomers: 0,
      };
    }
    
    const totalCreditBalance = filteredCustomers.reduce(
      (sum: number, customer: any) => sum + parseFloat(customer.credit_balance || 0),
      0
    );
    
    const totalCreditLimit = filteredCustomers.reduce(
      (sum: number, customer: any) => sum + parseFloat(customer.credit_limit || 0),
      0
    );
    
    return {
      totalCreditBalance,
      totalCreditLimit,
      totalCustomers: filteredCustomers.length,
    };
  }, [filteredCustomers]);

  if (isLoading) {
    return <LoadingState message="Loading customers..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading customers. Please try again."
        onRetry={() => queryClient.invalidateQueries({ queryKey: ['customers'] })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Manage your customer database"
        icon={Users}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/personal-customers')}
              className="flex items-center gap-2"
            >
              Personal Customers
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="h-4 w-4 mr-2 inline" />
              Add Customer
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Credit Balance</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{totals.totalCreditBalance.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Includes Regular & Personal Ledger
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <DollarSign className="h-8 w-8 text-blue-600" />
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Credit Limit</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{totals.totalCreditLimit.toFixed(2)}
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Customers</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {totals.totalCustomers}
              </p>
              {filteredCustomers.length !== (data ? (Array.isArray(data) ? data : (data.results || data.data || [])).length : 0) && (
                <p className="text-xs text-gray-500 mt-1">
                  ({filteredCustomers.length} filtered)
                </p>
              )}
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <Users className="h-8 w-8 text-purple-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
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
            value={customerGroupFilter}
            onChange={(e) => setCustomerGroupFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Groups</option>
            {customerGroups.map((group: any) => (
              <option key={group.id} value={group.id.toString()}>{group.name}</option>
            ))}
          </Select>
        </div>
      </Card>

      {filteredCustomers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No customers found"
            message="Get started by adding your first customer"
            action={
              <Button onClick={() => { resetForm(); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-2 inline" />
                Add Customer
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={[
              'Name',
              'Phone',
              'Email',
              'Group',
              { label: 'Credit Balance', align: 'right' },
              'Status',
              { label: 'Actions', align: 'right' }
            ]}>
              {filteredCustomers.map((customer: any) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <span className="font-medium text-gray-900">{customer.name}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{customer.phone || '-'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{customer.email || '-'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">
                      {customer.customer_group_name || customer.customer_group?.name || '-'}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-medium text-gray-900">
                      ₹{parseFloat(customer.credit_balance || 0).toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={customer.is_active !== false ? 'success' : 'default'}>
                      {customer.is_active !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleEdit(customer)}
                        className="text-blue-600 hover:text-blue-900 transition-colors"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="text-red-600 hover:text-red-900 transition-colors"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredCustomers.map((customer: any) => (
              <div key={customer.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
                        <h4 className="font-semibold text-gray-900 text-base">{customer.name}</h4>
                      </div>
                      <Badge variant={customer.is_active !== false ? 'success' : 'default'} className="inline-flex">
                        {customer.is_active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(customer)}
                        className="text-blue-600 hover:text-blue-900 transition-colors p-2 hover:bg-blue-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="text-red-600 hover:text-red-900 transition-colors p-2 hover:bg-red-50 rounded-lg"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-gray-100 space-y-2">
                    {customer.phone && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-20 flex-shrink-0">Phone</span>
                        <span className="text-sm text-gray-900">{customer.phone}</span>
                      </div>
                    )}
                    {customer.email && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-20 flex-shrink-0">Email</span>
                        <span className="text-sm text-gray-900 truncate">{customer.email}</span>
                      </div>
                    )}
                    {(customer.customer_group_name || customer.customer_group?.name) && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-20 flex-shrink-0">Group</span>
                        <span className="text-sm text-gray-900">{customer.customer_group_name || customer.customer_group?.name}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Credit Balance</span>
                      <span className="text-base font-bold text-gray-900">₹{parseFloat(customer.credit_balance || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showForm && (
        <Modal
          isOpen={showForm}
          onClose={() => { setShowForm(false); resetForm(); }}
          title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
          size="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Input
                label="Name"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (!editingCustomer) setNameSearchQuery(e.target.value);
                }}
                required
                placeholder="Enter customer name"
              />
              {!editingCustomer && existingCustomers.length > 0 && (
                <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-xs font-semibold text-yellow-800 mb-2">Similar existing customers found:</p>
                  <ul className="space-y-1">
                    {existingCustomers.slice(0, 5).map((c: any) => (
                      <li key={c.id} className="text-xs text-yellow-700 flex items-center gap-2">
                        <Users className="h-3 w-3" />
                        <span>{c.name}</span>
                        {c.phone && <span className="text-yellow-600">({c.phone})</span>}
                      </li>
                    ))}
                  </ul>
                  {existingCustomers.some((c: any) => c.name.toLowerCase() === formData.name.toLowerCase().trim()) && (
                    <p className="text-xs font-bold text-red-600 mt-2">
                      Warning: A customer with this exact name already exists. Names must be unique.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Input
                label="Phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Enter phone number"
              />
              <Input
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
              />
            </div>
            <Textarea
              label="Address"
              rows={3}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Enter customer address"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    Customer Group
                  </label>
                  {!showCreateGroup && (
                    <button
                      type="button"
                      onClick={() => setShowCreateGroup(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Create New
                    </button>
                  )}
                </div>
                {showCreateGroup ? (
                  <div className="space-y-3 p-4 border border-blue-200 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-900">Create New Group</h4>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateGroup(false);
                          setNewGroupData({ name: '', description: '', discount_percentage: '0' });
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <Input
                      label="Group Name"
                      value={newGroupData.name}
                      onChange={(e) => setNewGroupData({ ...newGroupData, name: e.target.value })}
                      placeholder="Enter group name"
                      required
                    />
                    <Textarea
                      label="Description"
                      rows={2}
                      value={newGroupData.description}
                      onChange={(e) => setNewGroupData({ ...newGroupData, description: e.target.value })}
                      placeholder="Optional description"
                    />
                    <Input
                      label="Discount Percentage"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={newGroupData.discount_percentage}
                      onChange={(e) => setNewGroupData({ ...newGroupData, discount_percentage: e.target.value })}
                      placeholder="0.00"
                    />
                    <div className="flex gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowCreateGroup(false);
                          setNewGroupData({ name: '', description: '', discount_percentage: '0' });
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (!newGroupData.name.trim()) {
                            toast('Please enter a group name', 'error');
                            return;
                          }
                          createGroupMutation.mutate({
                            name: newGroupData.name.trim(),
                            description: newGroupData.description.trim() || '',
                            discount_percentage: parseFloat(newGroupData.discount_percentage) || 0,
                            is_active: true,
                          });
                        }}
                        disabled={createGroupMutation.isPending}
                        className="flex-1"
                      >
                        {createGroupMutation.isPending ? 'Creating...' : 'Create Group'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Select
                    value={formData.customer_group}
                    onChange={(e) => setFormData({ ...formData, customer_group: e.target.value })}
                  >
                    <option value="">None</option>
                    {customerGroups.map((group: any) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <Input
                label="Credit Limit"
                type="number"
                step="0.01"
                value={formData.credit_limit}
                onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 text-sm font-medium text-gray-700">
                Active
              </label>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowForm(false); resetForm(); }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save Customer'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
