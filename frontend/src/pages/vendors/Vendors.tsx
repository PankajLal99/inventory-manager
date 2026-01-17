import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { purchasingApi } from '../../lib/api';
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
import { 
  Users, 
  Eye, 
  Copy, 
  ExternalLink, 
  Phone, 
  Mail, 
  MapPin,
  ShoppingBag,
  CheckCircle,
  Plus,
} from 'lucide-react';

export default function Vendors() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    code: '',
    phone: '',
    email: '',
    address: '',
    contact_person: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data || response;
    },
    retry: false,
  });

  // Fetch purchase counts for each supplier
  const { data: purchasesData } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const response = await purchasingApi.purchases.list();
      return response.data || response;
    },
    retry: false,
  });

  const suppliers = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  const purchases = (() => {
    if (!purchasesData) return [];
    if (Array.isArray(purchasesData.results)) return purchasesData.results;
    if (Array.isArray(purchasesData.data)) return purchasesData.data;
    if (Array.isArray(purchasesData)) return purchasesData;
    return [];
  })();

  // Calculate purchase counts per supplier
  const purchaseCounts = purchases.reduce((acc: Record<number, number>, purchase: any) => {
    const supplierId = purchase.supplier || purchase.supplier_id;
    if (supplierId) {
      acc[supplierId] = (acc[supplierId] || 0) + 1;
    }
    return acc;
  }, {});

  const getVendorLink = (supplierId: number) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/vendor-purchases?supplier=${supplierId}`;
  };

  const handleCopyLink = (supplierId: number) => {
    const link = getVendorLink(supplierId);
    navigator.clipboard.writeText(link);
    setCopiedId(supplierId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleViewPurchases = (supplierId: number) => {
    navigate(`/purchases?supplier=${supplierId}`);
  };

  const handleViewVendorPage = (supplierId: number) => {
    window.open(getVendorLink(supplierId), '_blank');
  };

  const createSupplierMutation = useMutation({
    mutationFn: (data: any) => purchasingApi.suppliers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setShowSupplierForm(false);
      setSupplierFormData({
        name: '',
        code: '',
        phone: '',
        email: '',
        address: '',
        contact_person: '',
      });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.message || error?.response?.data?.error || 'Failed to create supplier', 'error');
    },
  });

  if (isLoading) {
    return <LoadingState message="Loading vendors..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading vendors. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        subtitle="Manage vendors and share purchase links"
        icon={Users}
        action={
          <Button
            onClick={() => setShowSupplierForm(true)}
            className="gap-2"
          >
            <Plus className="h-5 w-5" />
            Add Vendor
          </Button>
        }
      />

      {suppliers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No vendors found"
            message="No vendors have been added yet"
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={[
              { label: 'Vendor Name', align: 'left' },
              { label: 'Code', align: 'left' },
              { label: 'Contact', align: 'left' },
              { label: 'Purchases', align: 'center' },
              { label: 'Status', align: 'center' },
              { label: 'Actions', align: 'right' },
            ]}>
              {suppliers.map((supplier: any) => {
                const purchaseCount = purchaseCounts[supplier.id] || 0;
                const isActive = supplier.is_active !== false;

                return (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <div className="font-medium text-gray-900">{supplier.name}</div>
                      {supplier.contact_person && (
                        <div className="text-sm text-gray-500 mt-0.5">
                          Contact: {supplier.contact_person}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600 font-mono">
                        {supplier.code || '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {supplier.phone && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <Phone className="h-3.5 w-3.5" />
                            {supplier.phone}
                          </div>
                        )}
                        {supplier.email && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <Mail className="h-3.5 w-3.5" />
                            {supplier.email}
                          </div>
                        )}
                        {supplier.address && (
                          <div className="flex items-start gap-1.5 text-sm text-gray-600">
                            <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{supplier.address}</span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="center">
                      <div className="flex items-center justify-center gap-1.5">
                        <ShoppingBag className="h-4 w-4 text-gray-400" />
                        <span className="font-medium text-gray-900">{purchaseCount}</span>
                      </div>
                    </TableCell>
                    <TableCell align="center">
                      <Badge variant={isActive ? 'success' : 'danger'}>
                        {isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewPurchases(supplier.id)}
                          className="gap-1.5"
                          title="View all purchases by this vendor"
                        >
                          <Eye className="h-4 w-4" />
                          <span>Purchases</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(supplier.id)}
                          className={`gap-1.5 ${copiedId === supplier.id ? 'bg-green-50 border-green-300 text-green-700' : ''}`}
                          title="Copy vendor purchase link"
                        >
                          {copiedId === supplier.id ? (
                            <>
                              <CheckCircle className="h-4 w-4" />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewVendorPage(supplier.id)}
                          className="gap-1.5"
                          title="Open vendor purchase page in new tab"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>Open</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {suppliers.map((supplier: any) => {
              const purchaseCount = purchaseCounts[supplier.id] || 0;
              const isActive = supplier.is_active !== false;
              const vendorLink = getVendorLink(supplier.id);

              return (
                <Card key={supplier.id}>
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <h3 className="font-semibold text-gray-900 text-base truncate">
                            {supplier.name}
                          </h3>
                        </div>
                        {supplier.code && (
                          <div className="text-sm text-gray-600 mb-1">
                            Code: <span className="font-mono">{supplier.code}</span>
                          </div>
                        )}
                        {supplier.contact_person && (
                          <div className="text-sm text-gray-600 mb-2">
                            Contact: {supplier.contact_person}
                          </div>
                        )}
                        <div className="space-y-1 mb-2">
                          {supplier.phone && (
                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                              <Phone className="h-3.5 w-3.5" />
                              {supplier.phone}
                            </div>
                          )}
                          {supplier.email && (
                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                              <Mail className="h-3.5 w-3.5" />
                              {supplier.email}
                            </div>
                          )}
                        </div>
                        {supplier.address && (
                          <div className="flex items-start gap-1.5 text-sm text-gray-600 mb-2">
                            <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{supplier.address}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <Badge variant={isActive ? 'success' : 'danger'}>
                            {isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <ShoppingBag className="h-4 w-4" />
                            <span>{purchaseCount} purchase{purchaseCount !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewPurchases(supplier.id)}
                          className="w-full gap-1.5"
                        >
                          <Eye className="h-4 w-4" />
                          View Purchases
                        </Button>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyLink(supplier.id)}
                            className={`flex-1 gap-1.5 ${copiedId === supplier.id ? 'bg-green-50 border-green-300 text-green-700' : ''}`}
                          >
                            {copiedId === supplier.id ? (
                              <>
                                <CheckCircle className="h-4 w-4" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                Copy Link
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewVendorPage(supplier.id)}
                            className="flex-1 gap-1.5"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open
                          </Button>
                        </div>
                        <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200">
                          <div className="text-xs text-gray-500 mb-1">Vendor Link:</div>
                          <div className="text-xs font-mono text-gray-700 break-all">
                            {vendorLink}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Create Supplier Modal */}
      {showSupplierForm && (
        <Modal
          isOpen={showSupplierForm}
          onClose={() => {
            setShowSupplierForm(false);
            setSupplierFormData({
              name: '',
              code: '',
              phone: '',
              email: '',
              address: '',
              contact_person: '',
            });
          }}
          title="Create New Supplier"
          size="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Validate required fields
              if (!supplierFormData.name.trim()) {
                toast('Supplier Name is required', 'error');
                return;
              }
              if (!supplierFormData.code.trim()) {
                toast('Supplier Code is required', 'error');
                return;
              }
              createSupplierMutation.mutate(supplierFormData);
            }}
            className="space-y-4"
          >
            <Input
              label="Supplier Name *"
              value={supplierFormData.name}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, name: e.target.value })}
              required
            />
            <Input
              label="Supplier Code *"
              value={supplierFormData.code}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, code: e.target.value })}
              placeholder="Enter supplier code"
              required
            />
            <Input
              label="Phone"
              type="tel"
              value={supplierFormData.phone}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, phone: e.target.value })}
              placeholder="Optional"
            />
            <Input
              label="Email"
              type="email"
              value={supplierFormData.email}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, email: e.target.value })}
              placeholder="Optional"
            />
            <Input
              label="Contact Person"
              value={supplierFormData.contact_person}
              onChange={(e) => setSupplierFormData({ ...supplierFormData, contact_person: e.target.value })}
              placeholder="Optional"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={3}
                value={supplierFormData.address}
                onChange={(e) => setSupplierFormData({ ...supplierFormData, address: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowSupplierForm(false);
                  setSupplierFormData({
                    name: '',
                    code: '',
                    phone: '',
                    email: '',
                    address: '',
                    contact_person: '',
                  });
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createSupplierMutation.isPending || !supplierFormData.name.trim() || !supplierFormData.code.trim()}
              >
                {createSupplierMutation.isPending ? 'Creating...' : 'Create Supplier'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

