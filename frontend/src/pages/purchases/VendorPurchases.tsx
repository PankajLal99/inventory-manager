import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { purchasingApi, productsApi } from '../../lib/api';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import ProductForm from '../products/ProductForm';
import { Plus, Edit, X, Eye, Search, XCircle, FileText, Copy } from 'lucide-react';

interface PurchaseItem {
  id?: number;
  product: number;
  product_name?: string;
  product_sku?: string;
  quantity: string;
  unit_price: string;
  line_total?: number;
}

export default function VendorPurchases() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const supplierId = searchParams.get('supplier');
  
  const [showForm, setShowForm] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    purchase_date: new Date().toISOString().split('T')[0],
    bill_number: '',
    notes: '',
  });
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const queryClient = useQueryClient();
  const productSearchInputRef = useRef<HTMLInputElement>(null);

  // Redirect if no supplier ID
  useEffect(() => {
    if (!supplierId) {
      alert('Supplier ID is required. Please access this page with ?supplier=ID parameter.');
    }
  }, [supplierId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vendor-purchases', supplierId],
    queryFn: async () => {
      if (!supplierId) return { results: [] };
      const response = await purchasingApi.vendorPurchases.list(supplierId);
      return response.data;
    },
    enabled: !!supplierId,
    retry: false,
  });

  // Fetch supplier information
  const { data: supplierData } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: async () => {
      if (!supplierId) return null;
      const response = await purchasingApi.suppliers.get(parseInt(supplierId));
      return response.data || response;
    },
    enabled: !!supplierId,
    retry: false,
  });

  // Fetch products for search
  const { data: productsData } = useQuery({
    queryKey: ['products', productSearch],
    queryFn: async () => {
      if (!productSearch.trim()) return { results: [] };
      const response = await productsApi.list({ 
        search: productSearch.trim(),
        tag: 'new'
      });
      return response.data;
    },
    enabled: productSearch.trim().length > 0,
    retry: false,
  });

  // Compute products array early for use in hooks
  const products = (() => {
    if (!productsData) return [];
    if (Array.isArray(productsData.results)) return productsData.results;
    if (Array.isArray(productsData.data)) return productsData.data;
    if (Array.isArray(productsData)) return productsData;
    return [];
  })();

  // Auto-focus search input when form opens
  useEffect(() => {
    if (showForm && productSearchInputRef.current) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 100);
    }
  }, [showForm]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!showForm) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close dropdown
      if (e.key === 'Escape' && showProductDropdown) {
        setShowProductDropdown(false);
        return;
      }
      
      // Enter to add first product from dropdown
      if (e.key === 'Enter' && showProductDropdown && products.length > 0 && productSearch.trim().length > 0) {
        e.preventDefault();
        handleAddProduct(products[0]);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm, showProductDropdown, products, productSearch]);

  // Helper function to auto-generate labels for all products in a purchase (async, non-blocking)
  const autoGenerateLabels = (items: any[]) => {
    // Extract product IDs from items (handle both PurchaseItem format and API response format)
    const productIds = items
      .map(item => item.product || item.product_id || (typeof item === 'object' && item.product))
      .filter((id): id is number => id !== undefined && id !== null);
    const uniqueProductIds = [...new Set(productIds)];
    
    if (uniqueProductIds.length === 0) {
      return;
    }
    
    // Generate labels for each product in parallel (non-blocking, fire and forget)
    uniqueProductIds.forEach((productId) => {
      // Fire and forget - don't await, let it run in background
      (async () => {
        try {
          // Check if labels are already generated
          try {
            const statusResponse = await productsApi.labelsStatus(productId);
            if (statusResponse.data?.all_generated) {
              // Already generated, skip
              return;
            }
          } catch (statusError) {
            // Status check failed, try to generate anyway (barcodes might be new)
          }
          
          // Generate labels in background (don't await - let it run async)
          productsApi.generateLabels(productId).catch((error) => {
            // Log error but don't block user - labels can be generated manually
            console.error(`Background label generation failed for product ${productId}:`, error);
          });
        } catch (error) {
          // Silently fail - labels will be generated when user clicks the button
        }
      })();
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => purchasingApi.vendorPurchases.create(supplierId!, data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['vendor-purchases', supplierId] });
      setShowForm(false);
      
      // Get the created purchase to extract product IDs from response
      const createdPurchase = response?.data || response;
      const items = createdPurchase?.items || purchaseItems;
      
      // Auto-generate labels for all products in the background (async, non-blocking)
      if (items.length > 0) {
        // Wait a bit for barcodes to be fully created in backend
        setTimeout(() => {
          autoGenerateLabels(items);
        }, 1000);
      }
      
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to create purchase');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      purchasingApi.vendorPurchases.update(supplierId!, id, data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['vendor-purchases', supplierId] });
      setShowForm(false);
      
      // Get the updated purchase to extract product IDs from response
      const updatedPurchase = response?.data || response;
      const items = updatedPurchase?.items || purchaseItems;
      
      // Auto-generate labels for all products in the background (async, non-blocking)
      if (items.length > 0) {
        // Wait a bit for barcodes to be fully created/updated in backend
        setTimeout(() => {
          autoGenerateLabels(items);
        }, 1000);
      }
      
      setEditingPurchase(null);
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to update purchase');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => purchasingApi.vendorPurchases.cancel(supplierId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-purchases', supplierId] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to cancel purchase');
    },
  });

  const resetForm = () => {
    setFormData({
      purchase_date: new Date().toISOString().split('T')[0],
      bill_number: '',
      notes: '',
    });
    setPurchaseItems([]);
    setProductSearch('');
    setShowProductDropdown(false);
    setEditingPurchase(null);
  };

  const handleEdit = (purchase: any) => {
    if (purchase.status !== 'draft') {
      alert('Can only edit draft purchases');
      return;
    }
    setEditingPurchase(purchase.id);
    setFormData({
      purchase_date: purchase.purchase_date || new Date().toISOString().split('T')[0],
      bill_number: purchase.bill_number || '',
      notes: purchase.notes || '',
    });
    const items = (purchase.items || []).map((item: any) => ({
      id: item.id,
      product: item.product,
      product_name: item.product_name,
      product_sku: item.product_sku,
      quantity: item.quantity.toString(),
      unit_price: item.unit_price.toString(),
      line_total: item.line_total,
    }));
    setPurchaseItems(items);
    setShowForm(true);
  };

  const handleDuplicatePurchase = (purchase: any) => {
    setEditingPurchase(null);
    setFormData({
      purchase_date: new Date().toISOString().split('T')[0],
      bill_number: '',
      notes: purchase.notes || '',
    });
    const items = (purchase.items || []).map((item: any) => ({
      product: item.product,
      product_name: item.product_name,
      product_sku: item.product_sku,
      quantity: item.quantity.toString(),
      unit_price: item.unit_price.toString(),
      line_total: item.line_total,
    }));
    setPurchaseItems(items);
    setShowForm(true);
  };

  const handleCancel = (id: number) => {
    if (confirm('Are you sure you want to cancel this purchase?')) {
      cancelMutation.mutate(id);
    }
  };

  const handleAddProduct = (product: any) => {
    const newItem: PurchaseItem = {
      product: product.id,
      product_name: product.name,
      product_sku: product.sku,
      quantity: '1',
      unit_price: '0',
    };
    setPurchaseItems([...purchaseItems, newItem]);
    setProductSearch('');
    setShowProductDropdown(false);
  };

  const handleProductCreated = (newProduct: any) => {
    // Add the newly created product to purchase items
    handleAddProduct(newProduct);
    setShowProductForm(false);
    setProductSearch(''); // Clear search after adding
    // Invalidate products query to refresh the list
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const handleRemoveItem = (index: number) => {
    setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: string) => {
    const updated = [...purchaseItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unit_price') {
      const qty = Math.max(0, parseInt(updated[index].quantity) || 0);
      const price = parseFloat(updated[index].unit_price) || 0;
      updated[index].line_total = qty * price;
      if (field === 'quantity') {
        updated[index].quantity = qty.toString();
      }
    }
    setPurchaseItems(updated);
  };

  const calculateTotal = () => {
    return purchaseItems.reduce((sum, item) => {
      const qty = parseInt(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      return sum + (qty * price);
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (purchaseItems.length === 0) {
      alert('Please add at least one product to the purchase');
      return;
    }

    const submitData: any = {
      purchase_date: formData.purchase_date,
      items: purchaseItems.map(item => ({
        product: item.product,
        quantity: parseInt(item.quantity) || 0,
        unit_price: parseFloat(item.unit_price) || 0,
      })),
    };

    if (formData.bill_number) submitData.bill_number = formData.bill_number;
    if (formData.notes) submitData.notes = formData.notes;

    if (editingPurchase) {
      updateMutation.mutate({ id: editingPurchase, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="warning">Draft</Badge>;
      case 'finalized':
        return <Badge variant="success">Finalized</Badge>;
      case 'cancelled':
        return <Badge variant="danger">Cancelled</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  if (!supplierId) {
    return (
      <ErrorState
        message="Supplier ID is required"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (isLoading) {
    return <LoadingState message="Loading purchases..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading purchases. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const purchases = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {supplierData?.name ? `${supplierData.name}'s Purchases` : 'My Purchases'}
            </h1>
            <p className="text-gray-600 mt-1">Manage your purchase orders</p>
          </div>
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-5 w-5 mr-2 inline" />
            New Purchase
          </Button>
        </div>

        {/* Purchases Table */}
        {purchases.length === 0 ? (
          <Card>
            <EmptyState
              icon={FileText}
              title="No purchases found"
              message="Create your first purchase order"
            />
          </Card>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Table headers={[
                { label: 'Purchase #', align: 'left' },
                { label: 'Date', align: 'left' },
                { label: 'Bill #', align: 'left' },
                { label: 'Items', align: 'center' },
                { label: 'Total', align: 'right' },
                { label: 'Status', align: 'center' },
                { label: '', align: 'right' },
              ]}>
                {purchases.map((purchase: any) => (
                  <TableRow 
                    key={purchase.id}
                    onClick={() => navigate(`/vendor-purchases/${purchase.id}?supplier=${supplierId}`)}
                  >
                    <TableCell>
                      <span className="font-mono font-semibold text-gray-900">
                        {purchase.purchase_number || `PUR-${purchase.id}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">
                        {formatDate(purchase.purchase_date)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">
                        {purchase.bill_number || '-'}
                      </span>
                    </TableCell>
                    <TableCell align="center">
                      <span className="text-gray-600">
                        {purchase.items?.length || 0}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(purchase.total || 0)}
                      </span>
                    </TableCell>
                    <TableCell align="center">
                      {getStatusBadge(purchase.status || 'draft')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/vendor-purchases/${purchase.id}?supplier=${supplierId}`)}
                          className="gap-1.5"
                        >
                          <Eye className="h-4 w-4" />
                          <span>View</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDuplicatePurchase(purchase)}
                          className="gap-1.5"
                          title="Duplicate this purchase"
                        >
                          <Copy className="h-4 w-4" />
                          <span>Duplicate</span>
                        </Button>
                        {purchase.status === 'draft' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(purchase)}
                              className="gap-1.5"
                            >
                              <Edit className="h-4 w-4" />
                              <span>Edit</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(purchase.id)}
                              className="gap-1.5 text-red-600 hover:text-red-700"
                              disabled={cancelMutation.isPending}
                            >
                              <XCircle className="h-4 w-4" />
                              <span>Cancel</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {purchases.map((purchase: any) => (
                <Card 
                  key={purchase.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate(`/vendor-purchases/${purchase.id}?supplier=${supplierId}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span className="font-mono font-semibold text-gray-900 text-base">
                            {purchase.purchase_number || `PUR-${purchase.id}`}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 mb-1">
                          {formatDate(purchase.purchase_date)}
                        </div>
                        {purchase.bill_number && (
                          <div className="text-xs text-gray-500">
                            Bill: {purchase.bill_number}
                          </div>
                        )}
                        <div className="mt-2">
                          {getStatusBadge(purchase.status || 'draft')}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/vendor-purchases/${purchase.id}?supplier=${supplierId}`)}
                          className="p-2"
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDuplicatePurchase(purchase)}
                          className="p-2"
                          title="Duplicate purchase"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {purchase.status === 'draft' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(purchase)}
                              className="p-2"
                              title="Edit purchase"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(purchase.id)}
                              className="p-2 text-red-600 hover:text-red-700"
                              disabled={cancelMutation.isPending}
                              title="Cancel purchase"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                          {purchase.items?.length || 0} items
                        </span>
                        <span className="text-base font-bold text-gray-900">
                          {formatCurrency(purchase.total || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* Purchase Form Modal */}
        {showForm && (
          <Modal 
            isOpen={showForm} 
            onClose={() => { setShowForm(false); resetForm(); }} 
            title={editingPurchase ? 'Edit Purchase' : 'New Purchase'}
            size="lg"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Purchase Date *"
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                  required
                />
                <Input
                  label="Bill Number"
                  value={formData.bill_number}
                  onChange={(e) => setFormData({ ...formData, bill_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>

              {/* Add Products Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Products *</label>
                
                {/* Product Search */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    ref={productSearchInputRef}
                    type="text"
                    placeholder="Search products to add... (Press Enter to add first result)"
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setShowProductDropdown(e.target.value.trim().length > 0);
                    }}
                    onFocus={() => {
                      if (productSearch.trim().length > 0) setShowProductDropdown(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && showProductDropdown && products.length > 0 && productSearch.trim().length > 0) {
                        e.preventDefault();
                        handleAddProduct(products[0]);
                      }
                    }}
                    className="pl-10"
                  />
                  
                  {/* Product Dropdown */}
                  {showProductDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                      {products.length > 0 ? (
                        <>
                          {products.slice(0, 10).map((product: any) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => handleAddProduct(product)}
                              className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium text-gray-900">{product.name}</div>
                              <div className="text-xs text-gray-500">
                                {product.brand_name ? `Brand: ${product.brand_name} • ` : ''}SKU: {product.sku || 'N/A'}
                              </div>
                            </button>
                          ))}
                          {productSearch.trim().length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowProductDropdown(false);
                                setShowProductForm(true);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-green-50 border-t border-gray-200 bg-green-50/50 flex items-center gap-2"
                            >
                              <Plus className="h-4 w-4 text-green-600" />
                              <div>
                                <div className="font-medium text-green-700">Add "{productSearch}"</div>
                                <div className="text-xs text-green-600">Create new product (can have same name with different brand)</div>
                              </div>
                            </button>
                          )}
                        </>
                      ) : productSearch.trim().length > 0 ? (
                        <div>
                          <div className="px-4 py-3 text-sm text-gray-500 text-center border-b border-gray-200">
                            No products found matching "{productSearch}"
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setShowProductDropdown(false);
                              setShowProductForm(true);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-green-50 flex items-center gap-2"
                          >
                            <Plus className="h-4 w-4 text-green-600" />
                            <div>
                              <div className="font-medium text-green-700">Add "{productSearch}"</div>
                              <div className="text-xs text-green-600">Create new product (can have same name with different brand)</div>
                            </div>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Purchase Items Table */}
                {purchaseItems.length > 0 && (
                  <div className="border border-gray-300 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {purchaseItems.map((item, index) => (
                          <tr key={index}>
                            <td className="px-3 py-2">
                              <div className="text-sm font-medium text-gray-900">{item.product_name || 'Product'}</div>
                              <div className="text-xs text-gray-500">{item.product_sku || 'N/A'}</div>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                value={item.quantity}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '' || /^\d+$/.test(val)) {
                                    handleItemChange(index, 'quantity', val);
                                  }
                                }}
                                onBlur={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  handleItemChange(index, 'quantity', val.toString());
                                }}
                                className="w-20 text-sm"
                                required
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.unit_price}
                                onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                                className="w-24 text-sm"
                                required
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-sm font-medium text-gray-900">
                                {formatCurrency(item.line_total || 0)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(index)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan={3} className="px-3 py-2 text-right text-sm font-medium text-gray-700">
                            Total:
                          </td>
                          <td colSpan={2} className="px-3 py-2 text-right text-sm font-bold text-gray-900">
                            {formatCurrency(calculateTotal())}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending || purchaseItems.length === 0}
                >
                  {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save Purchase'}
                </Button>
              </div>
            </form>
          </Modal>
        )}

        {/* Product Form Modal */}
        {showProductForm && (
          <ProductForm
            initialName={productSearch}
            onClose={() => {
              setShowProductForm(false);
              // After closing, refetch products to get the newly created one
              queryClient.invalidateQueries({ queryKey: ['products'] });
            }}
            onProductCreated={handleProductCreated}
          />
        )}
      </div>
    </div>
  );
}

