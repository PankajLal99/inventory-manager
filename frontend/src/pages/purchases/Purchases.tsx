import { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { purchasingApi, productsApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import PageHeader from '../../components/ui/PageHeader';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Pagination from '../../components/ui/Pagination';
import { Plus, Edit, Trash2, FileText, UserPlus, Filter, Search, X, Printer, Loader2, RotateCcw } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import ProductForm from '../products/ProductForm';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import DatePicker from '../../components/ui/DatePicker';

interface PurchaseItem {
  id?: number;
  product: number;
  variant?: number | null;
  product_name?: string;
  product_sku?: string;
  variant_name?: string;
  variant_sku?: string;
  quantity: string;
  unit_price: string;
  selling_price?: string | null;
  line_total?: number;
  sold_count?: number; // Number of items already sold (for validation)
  printed?: boolean;
  printed_at?: string | null;
}

export default function Purchases() {
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRetailUser = userGroups.includes('Retail') && !userGroups.includes('Admin') && !userGroups.includes('RetailAdmin');
  const [searchParams, setSearchParams] = useSearchParams();
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get('supplier') || '');
  const [supplierFilterSearch, setSupplierFilterSearch] = useState(''); // For typable filter dropdown
  const [showSupplierFilterDropdown, setShowSupplierFilterDropdown] = useState(false);
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [showForm, setShowForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    supplier: '',
    purchase_date: new Date().toISOString().split('T')[0],
    bill_number: '',
    notes: '',
  });
  const [supplierSearch, setSupplierSearch] = useState(''); // For typable supplier in modal
  const [supplierFilterInput, setSupplierFilterInput] = useState(''); // For filtering suppliers in modal dropdown
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    code: '',
    phone: '',
    email: '',
    address: '',
    contact_person: '',
  });
  const queryClient = useQueryClient();
  const productSearchInputRef = useRef<HTMLInputElement | null>(null);
  const supplierRef = useRef<HTMLDivElement>(null);
  const supplierFilterRef = useRef<HTMLDivElement>(null);
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<string, { all_generated: boolean; generating: boolean }>>({});
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch products for search (must be before useEffect hooks that use products)
  const { data: productsData } = useQuery({
    queryKey: ['products', productSearch],
    queryFn: async () => {
      if (!productSearch.trim()) return { results: [] };
      // Include tag='new' to get all products including unpurchased ones
      // Use search_mode='name_only' to search only by product name
      const response = await productsApi.list({
        search: productSearch.trim(),
        tag: 'new', // This ensures we get all products including unpurchased ones
        search_mode: 'name_only' // Search only by product name
      });
      return response.data;
    },
    enabled: productSearch.trim().length > 0,
    retry: false,
  });

  // Compute products array from productsData (needed for keyboard shortcuts)
  const products = (() => {
    if (!productsData) return [];
    if (Array.isArray(productsData.results)) return productsData.results;
    if (Array.isArray(productsData.data)) return productsData.data;
    if (Array.isArray(productsData)) return productsData;
    return [];
  })();

  // Auto-focus product search input when form opens
  useEffect(() => {
    if (showForm) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 100);
    }
  }, [showForm]);

  // Keyboard shortcuts for product search
  useEffect(() => {
    if (!showForm) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showProductDropdown) {
        setShowProductDropdown(false);
        return;
      }

      if (e.key === 'Enter' && showProductDropdown && products.length > 0 && productSearch.trim().length > 0) {
        e.preventDefault();
        // Inline the add product logic to avoid dependency on handleAddProduct
        const firstProduct = products[0];
        if (firstProduct) {
          const newItem: PurchaseItem = {
            product: firstProduct.id,
            product_name: firstProduct.name,
            product_sku: firstProduct.sku,
            quantity: '',
            unit_price: '',
            selling_price: '',
          };
          setPurchaseItems((prev) => [...prev, newItem]);
          setProductSearch('');
          setShowProductDropdown(false);
          // Refocus search input after adding product
          setTimeout(() => {
            productSearchInputRef.current?.focus();
          }, 50);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm, showProductDropdown, products, productSearch]);

  // Sync URL params with state on mount
  useEffect(() => {
    const urlSupplier = searchParams.get('supplier') || '';
    const urlDateFrom = searchParams.get('date_from') || '';
    const urlDateTo = searchParams.get('date_to') || '';

    if (urlSupplier !== supplierFilter) setSupplierFilter(urlSupplier);
    if (urlDateFrom !== dateFrom) setDateFrom(urlDateFrom);
    if (urlDateTo !== dateTo) setDateTo(urlDateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierFilter, dateFrom, dateTo]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [supplierFilter, dateFrom, dateTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchases', supplierFilter, dateFrom, dateTo, currentPage],
    queryFn: async () => {
      const params: any = {
        page: currentPage,
        limit: 15,
      };
      if (supplierFilter) params.supplier = supplierFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await purchasingApi.purchases.list(params);
      return response.data;
    },
    retry: false,
    placeholderData: keepPreviousData,
  });

  // Fetch suppliers for dropdown
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data;
    },
    retry: false,
  });

  // Track if we've added the product for this product ID
  const addedProductForIdRef = useRef<string | null>(null);
  // Preserve product ID even after URL is cleared
  const preservedProductIdRef = useRef<string | null>(null);

  // Fetch pre-selected product if product ID is in URL
  const preSelectedProductId = searchParams.get('product');

  // Use preserved ID if URL parameter is cleared
  const effectiveProductId = preSelectedProductId || preservedProductIdRef.current;

  const { data: preselectedProductData, isSuccess: isPreselectedProductLoaded, isFetched: isPreselectedProductFetched } = useQuery({
    queryKey: ['product', effectiveProductId],
    queryFn: async () => {
      if (!effectiveProductId) return null;
      const response = await productsApi.get(parseInt(effectiveProductId));
      return response.data;
    },
    enabled: !!effectiveProductId,
    retry: false,
  });

  // Preserve product ID when it's detected in URL
  useEffect(() => {
    if (preSelectedProductId) {
      preservedProductIdRef.current = preSelectedProductId;
      // Reset the added flag when product ID changes
      if (addedProductForIdRef.current !== preSelectedProductId) {
        addedProductForIdRef.current = null;
      }
    }
  }, [preSelectedProductId]);

  // Open form immediately when product ID is detected
  useEffect(() => {
    if (preSelectedProductId) {
      // Open the form immediately
      setShowForm(true);
    } else if (preservedProductIdRef.current) {
      // Keep the preserved ID even if URL parameter is cleared
      // Make sure form is still open
      setShowForm(true);
    }
  }, [preSelectedProductId]);

  // Add product to purchase items when data is loaded and form is open
  useEffect(() => {
    // Use effective product ID (from URL or preserved)
    const productIdToUse = effectiveProductId;

    // Only proceed if we have all required conditions
    if (!productIdToUse) return;
    if (!isPreselectedProductFetched) return;
    if (!isPreselectedProductLoaded) return;
    if (!preselectedProductData) return;
    if (!preselectedProductData.id) return;
    if (!showForm) return; // Wait for form to be open
    if (addedProductForIdRef.current === productIdToUse) return; // Already added

    // Verify the product ID matches
    const productIdFromData = preselectedProductData.id.toString();
    const productIdFromUrl = productIdToUse.toString();

    if (productIdFromData !== productIdFromUrl) return;

    // Mark that we're adding this product
    addedProductForIdRef.current = productIdToUse;

    // Add the product to purchase items using functional update
    setPurchaseItems(prev => {
      const productId = preselectedProductData.id;

      // Check if product already exists
      const alreadyExists = prev.some(item => item.product === productId);
      if (alreadyExists) {
        return prev;
      }

      // Create new item with empty quantity and price (will show placeholders)
      const newItem: PurchaseItem = {
        product: preselectedProductData.id,
        product_name: preselectedProductData.name || 'Unknown Product',
        product_sku: preselectedProductData.sku || '',
        quantity: '',
        unit_price: '',
        selling_price: '',
      };

      // Return new array with the item added
      return [...prev, newItem];
    });

    // Clear the preserved ID and URL parameter after product is added
    preservedProductIdRef.current = null;
    setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      params.delete('product');
      setSearchParams(params, { replace: true });
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProductId, preselectedProductData, isPreselectedProductLoaded, isPreselectedProductFetched, showForm]);

  // Helper function to auto-generate labels for all products in a purchase (async, non-blocking)
  const autoGenerateLabels = (items: any[], purchaseId?: number) => {
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
          // Check if labels are already generated using cached query
          // Invalidate cache first to get fresh data, then check
          const cacheKey = ['label-status', productId, purchaseId];
          const cachedData = queryClient.getQueryData(cacheKey);

          if (cachedData && (cachedData as any).data?.all_generated) {
            // Already generated according to cache, skip
            return;
          }

          // If not in cache or not generated, check via API (will be cached)
          try {
            const statusResponse = await productsApi.labelsStatus(productId, purchaseId);
            // Update cache with the response
            queryClient.setQueryData(cacheKey, { productId, purchaseId, data: statusResponse.data });
            if (statusResponse.data?.all_generated) {
              // Already generated, skip
              return;
            }
          } catch (statusError) {
            // Status check failed, try to generate anyway (barcodes might be new)
          }

          // Generate labels in background (don't await - let it run async)
          // Pass purchaseId to filter labels by this purchase
          productsApi.generateLabels(productId, purchaseId).catch((error) => {
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
    mutationFn: (data: any) => purchasingApi.purchases.create(data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setShowForm(false);

      // Get the created purchase to extract product IDs from response
      const createdPurchase = response?.data || response;
      const items = createdPurchase?.items || purchaseItems;

      // Auto-generate labels for all products in the background (async, non-blocking)
      if (items.length > 0) {
        // Get purchase ID from response
        const purchaseId = createdPurchase?.id ? parseInt(createdPurchase.id) : undefined;
        // Wait a bit for barcodes to be fully created in backend
        setTimeout(() => {
          autoGenerateLabels(items, purchaseId);
        }, 1000);
      }

      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to create purchase');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => purchasingApi.purchases.update(id, data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setShowForm(false);
      setEditingPurchase(null);

      // Get the updated purchase to extract product IDs from response
      const updatedPurchase = response?.data || response;
      const items = updatedPurchase?.items || purchaseItems;

      // Auto-generate labels for all products in the background (async, non-blocking)
      if (items.length > 0) {
        // Get purchase ID from response
        const purchaseId = updatedPurchase?.id ? parseInt(updatedPurchase.id) : undefined;
        // Wait a bit for barcodes to be fully created/updated in backend
        setTimeout(() => {
          autoGenerateLabels(items, purchaseId);
        }, 1000);
      }

      resetForm();
    },
    onError: (error: any) => {
      // Show detailed error message from backend
      const errorMessage = error?.response?.data?.message ||
        error?.response?.data?.error ||
        (error?.response?.data?.items ?
          `Validation error: ${JSON.stringify(error.response.data.items)}` :
          'Failed to update purchase');
      alert(errorMessage);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchasingApi.purchases.delete(id),
    onSuccess: async () => {
      // Invalidate and immediately refetch to remove deleted purchase from UI
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      await queryClient.refetchQueries({ queryKey: ['purchases'] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to delete purchase');
    },
  });

  const createSupplierMutation = useMutation({
    mutationFn: (data: any) => purchasingApi.suppliers.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setShowSupplierForm(false);
      const newSupplier = response.data || response;
      setFormData((prev) => ({ ...prev, supplier: newSupplier.id.toString() }));
      setSupplierSearch(newSupplier.name);
      setSupplierFilterInput(''); // Clear filter
      setShowSupplierDropdown(false);
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
      alert(error?.response?.data?.message || error?.response?.data?.error || 'Failed to create supplier');
    },
  });

  const resetForm = () => {
    setFormData({
      supplier: '',
      purchase_date: new Date().toISOString().split('T')[0],
      bill_number: '',
      notes: '',
    });
    setPurchaseItems([]);
    setProductSearch('');
    setShowProductDropdown(false);
    setSupplierSearch('');
    setSupplierFilterInput('');
    setShowSupplierDropdown(false);
    setEditingPurchase(null); // Clear editing state
    addedProductForIdRef.current = null; // Reset added product flag
  };

  const handleEdit = async (purchase: any) => {
    // Warn user if editing finalized purchase (stock has already been added)
    if (purchase.status === 'finalized') {
      const confirmEdit = confirm(
        'Warning: This purchase is finalized and stock has already been added to inventory. ' +
        'Editing will adjust stock levels. Are you sure you want to continue?'
      );
      if (!confirmEdit) {
        return;
      }
    }

    try {
      // Fetch full purchase details to ensure we have all items with variants and sold counts
      const response = await purchasingApi.purchases.get(purchase.id);
      const fullPurchase = response.data;

      setEditingPurchase(fullPurchase.id);
      setFormData({
        supplier: fullPurchase.supplier?.toString() || fullPurchase.supplier_id?.toString() || '',
        purchase_date: fullPurchase.purchase_date || new Date().toISOString().split('T')[0],
        bill_number: fullPurchase.bill_number || '',
        notes: fullPurchase.notes || '',
      });

      // Convert items to form format, including variants and sold counts
      const items = (fullPurchase.items || []).map((item: any) => ({
        id: item.id,
        product: item.product,
        variant: item.variant || null, // Include variant (can be null)
        product_name: item.product_name,
        product_sku: item.product_sku,
        variant_name: item.variant_name || null,
        variant_sku: item.variant_sku || null,
        quantity: item.quantity.toString(),
        unit_price: item.unit_price.toString(),
        selling_price: item.selling_price ? item.selling_price.toString() : '',
        line_total: item.line_total,
        sold_count: item.sold_count || 0, // Include sold count from backend for validation
      }));

      setPurchaseItems(items);
      setShowForm(true);
    } catch (error: any) {
      console.error('Error fetching purchase details:', error);
      alert(error?.response?.data?.message || 'Failed to load purchase details. Please try again.');
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this purchase?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleAddProduct = (product: any) => {
    // Check if product already exists in purchase items (same product and variant)
    const existingItem = purchaseItems.find(item =>
      item.product === product.id &&
      (item.variant === (product.variant?.id || null) || (!item.variant && !product.variant?.id))
    );

    if (existingItem) {
      // If product already exists, increase quantity by 1 instead of adding duplicate
      const index = purchaseItems.indexOf(existingItem);
      const currentQty = parseInt(existingItem.quantity) || 0;
      handleItemChange(index, 'quantity', (currentQty + 1).toString());
      setProductSearch('');
      setShowProductDropdown(false);
      setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 50);
      return;
    }

    const newItem: PurchaseItem = {
      product: product.id,
      variant: product.variant?.id || null,
      product_name: product.name,
      product_sku: product.sku,
      variant_name: product.variant?.name || null,
      variant_sku: product.variant?.sku || null,
      quantity: '',
      unit_price: '',
      selling_price: '',
      sold_count: 0, // New items have no sold count
    };
    setPurchaseItems([...purchaseItems, newItem]);
    setProductSearch('');
    setShowProductDropdown(false);
    // Refocus search input after adding product for quick addition
    setTimeout(() => {
      productSearchInputRef.current?.focus();
    }, 50);
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
    const item = purchaseItems[index];
    const soldCount = item.sold_count || 0;

    // Warn if removing item with sold items (but allow it - backend will handle validation)
    if (soldCount > 0 && editingPurchase) {
      const confirmMessage = `Warning: This item has ${soldCount} sold item(s). Removing it will delete all non-sold barcodes. Are you sure you want to remove "${item.product_name || 'this item'}"?`;
      if (!confirm(confirmMessage)) {
        return;
      }
    }

    setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: string) => {
    const updated = [...purchaseItems];
    updated[index] = { ...updated[index], [field]: value };
    // Calculate line_total when quantity or unit_price changes
    if (field === 'quantity' || field === 'unit_price') {
      // Parse quantity as integer (positive only), but preserve empty string
      const qty = updated[index].quantity === '' ? 0 : Math.max(0, parseInt(updated[index].quantity) || 0);
      const price = updated[index].unit_price === '' ? 0 : parseFloat(updated[index].unit_price) || 0;
      updated[index].line_total = qty * price;
      // Don't update quantity to number if it's empty - let user type or blur handler set it
    }

    // Validate quantity against sold count when editing
    if (field === 'quantity' && editingPurchase) {
      const soldCount = (updated[index] as any).sold_count || 0;
      // Parse as integer and ensure positive
      const newQuantity = Math.max(0, parseInt(value) || 0);
      if (newQuantity < soldCount) {
        // Show error but don't prevent typing - validation will happen on submit
        console.warn(`Cannot reduce quantity below ${soldCount} (${soldCount} items already sold)`);
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

    // Validate supplier
    let supplierId = formData.supplier;
    if (!supplierId && supplierSearch.trim()) {
      const matchingSupplier = suppliers.find((supplier: any) =>
        supplier.name.toLowerCase() === supplierSearch.trim().toLowerCase()
      );
      if (matchingSupplier) {
        supplierId = matchingSupplier.id.toString();
        // Update formData to ensure consistency
        setFormData((prev) => ({ ...prev, supplier: supplierId }));
      } else {
        alert('Please select a valid supplier from the dropdown or create a new one.');
        return;
      }
    }

    if (!supplierId) {
      alert('Please select a supplier');
      return;
    }

    // Validate all items before submitting
    for (const item of purchaseItems) {
      const quantity = parseInt(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;

      // Validate quantity is positive
      if (quantity <= 0) {
        alert(`Quantity must be greater than 0 for "${item.product_name || 'product'}".`);
        return;
      }

      // Validate price is non-negative
      if (price < 0) {
        alert(`Price cannot be negative for "${item.product_name || 'product'}".`);
        return;
      }

      // Validate quantities against sold count when editing
      if (editingPurchase) {
        const soldCount = item.sold_count || 0;
        if (quantity < soldCount) {
          const variantText = item.variant_name ? ` (${item.variant_name})` : '';
          alert(
            `Cannot reduce quantity for "${item.product_name || 'product'}${variantText}" below ${soldCount} ` +
            `because ${soldCount} item(s) have already been sold. Minimum allowed quantity is ${soldCount}.`
          );
          return;
        }
      }
    }

    // Prepare submit data with all required fields including variants
    const submitData: any = {
      supplier: parseInt(supplierId),
      purchase_date: formData.purchase_date,
      items: purchaseItems.map(item => {
        const itemData: any = {
          product: item.product,
          quantity: parseInt(item.quantity) || 0,
          unit_price: parseFloat(item.unit_price) || 0,
        };

        // Include variant if it exists (backend expects variant or null/undefined)
        if (item.variant) {
          itemData.variant = item.variant;
        }

        // Include selling_price if provided
        if (item.selling_price && item.selling_price.trim() !== '') {
          itemData.selling_price = parseFloat(item.selling_price) || null;
        }

        return itemData;
      }),
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
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return dateString;
    }
  };


  const generateLabelsMutation = useMutation({
    mutationFn: ({ productId, purchaseId }: { productId: number; purchaseId?: number }) =>
      productsApi.generateLabels(productId, purchaseId),
    onSuccess: async (data, { productId, purchaseId }) => {
      // Invalidate and refetch label status cache after generating labels
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId, purchaseId] });
      // Also invalidate without purchaseId in case it's checked elsewhere
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId] });

      // Refetch the label status to get the actual updated status
      try {
        const statusResponse = await productsApi.labelsStatus(productId, purchaseId);
        const key = `${productId}`;
        setLabelStatuses(prev => ({
          ...prev,
          [key]: {
            all_generated: statusResponse.data?.all_generated || false,
            generating: false
          }
        }));
        // Also update the query cache with the fresh data
        queryClient.setQueryData(['label-status', productId, purchaseId], {
          productId,
          purchaseId,
          labelKey: key,
          data: statusResponse.data,
          error: null
        });
      } catch (error) {
        // If status check fails, assume labels were generated
        const key = `${productId}`;
        setLabelStatuses(prev => ({
          ...prev,
          [key]: {
            all_generated: true,
            generating: false
          }
        }));
      }

      setGeneratingLabelsFor(null);
      const newlyGenerated = data.data?.newly_generated || 0;
      const total = data.data?.total_labels || 0;
      const alreadyExisted = data.data?.already_existed || (total - newlyGenerated);
      if (newlyGenerated > 0) {
        if (alreadyExisted > 0) {
          alert(`Successfully generated ${newlyGenerated} new label(s). ${alreadyExisted} label(s) were already generated. Total: ${total} label(s).`);
        } else {
          alert(`Successfully generated ${newlyGenerated} new label(s). Total: ${total} label(s).`);
        }
      } else {
        alert(`All ${total} label(s) were already generated.`);
      }
    },
    onError: (error: any, { productId }) => {
      setGeneratingLabelsFor(null);
      const key = `${productId}`;
      setLabelStatuses(prev => ({
        ...prev,
        [key]: {
          all_generated: false,
          generating: false
        }
      }));
      alert(error?.response?.data?.error || 'Failed to generate labels. Please try again.');
    },
  });

  const handlePrintLabels = async (productId: number, purchaseId: number) => {
    try {
      const response = await productsApi.getLabels(productId, purchaseId);
      if (response.data && response.data.labels && response.data.labels.length > 0) {
        printLabelsFromResponse(response.data);
      } else {
        alert('No labels found for this purchase. Please generate labels first.');
      }
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Failed to print labels. Please try again.');
    }
  };

  const handleGenerateLabels = (productId: number, purchaseId?: number) => {
    setGeneratingLabelsFor(productId);
    generateLabelsMutation.mutate({ productId, purchaseId });
  };

  const regenerateLabelsMutation = useMutation({
    mutationFn: ({ productId, purchaseId }: { productId: number; purchaseId?: number }) =>
      productsApi.regenerateLabels(productId, purchaseId),
    onSuccess: async (data, { productId, purchaseId }) => {
      // Invalidate and refetch label status cache after regenerating labels
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId, purchaseId] });
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId] });

      setGeneratingLabelsFor(null);
      alert(data.data?.message || 'Labels queued for regeneration');
    },
    onError: (error: any) => {
      setGeneratingLabelsFor(null);
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to regenerate labels';
      alert(errorMsg);
    },
  });

  const handleRegenerateLabels = (productId: number, purchaseId?: number) => {
    if (window.confirm('Regenerate all labels for this product? This will replace existing labels.')) {
      setGeneratingLabelsFor(productId);
      regenerateLabelsMutation.mutate({ productId, purchaseId });
    }
  };

  const updatePrintedMutation = useMutation({
    mutationFn: ({ itemId, printed }: { itemId: number; printed: boolean }) =>
      purchasingApi.purchases.items.updatePrinted(itemId, printed),
    // Optimistic update: Update UI immediately before API call
    onMutate: async ({ itemId, printed }) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ['purchases'] });

      // Snapshot the previous value for rollback
      const previousData = queryClient.getQueryData(['purchases', supplierFilter, dateFrom, dateTo, currentPage]);

      // Optimistically update the cache
      queryClient.setQueryData(['purchases', supplierFilter, dateFrom, dateTo, currentPage], (old: any) => {
        if (!old) return old;

        // Deep clone and update the specific item
        const updated = JSON.parse(JSON.stringify(old));
        const results = updated.data?.results || updated.results || [];

        for (const purchase of results) {
          if (purchase.items) {
            for (const item of purchase.items) {
              if (item.id === itemId) {
                item.printed = printed;
                item.printed_at = printed ? new Date().toISOString() : null;
                break;
              }
            }
          }
        }

        return updated;
      });

      // Return context with previous data for rollback
      return { previousData };
    },
    // On error, rollback to previous data
    onError: (error: any, _variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(['purchases', supplierFilter, dateFrom, dateTo, currentPage], context.previousData);
      }
      alert(error?.response?.data?.error || 'Failed to update printed status. Please try again.');
    },
    // On success, don't invalidate - keep the optimistic update
    onSettled: () => {
      // Mark as stale but don't refetch to preserve optimistic update
      queryClient.invalidateQueries({
        queryKey: ['purchases', supplierFilter, dateFrom, dateTo, currentPage],
        refetchType: 'none'
      });
    },
  });


  // Compute suppliers array (must be before hooks that use it)
  const suppliers = (() => {
    if (!suppliersData) return [];
    if (Array.isArray(suppliersData.results)) return suppliersData.results;
    if (Array.isArray(suppliersData.data)) return suppliersData.data;
    if (Array.isArray(suppliersData)) return suppliersData;
    return [];
  })();

  // Filter suppliers based on search input
  const filteredSuppliers = suppliers.filter((supplier: any) =>
    supplier.name.toLowerCase().includes(supplierFilterInput.toLowerCase()) ||
    supplier.code?.toLowerCase().includes(supplierFilterInput.toLowerCase())
  );

  // Filter suppliers for filter dropdown
  const filteredSuppliersForFilter = suppliers.filter((supplier: any) =>
    supplier.name.toLowerCase().includes(supplierFilterSearch.toLowerCase()) ||
    supplier.code?.toLowerCase().includes(supplierFilterSearch.toLowerCase())
  );

  // Check if supplier exists (for creating new)
  const supplierExists = suppliers.some((supplier: any) =>
    supplier.name.toLowerCase() === supplierFilterInput.toLowerCase()
  );

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (supplierRef.current && !supplierRef.current.contains(event.target as Node)) {
        setShowSupplierDropdown(false);
      }
      if (supplierFilterRef.current && !supplierFilterRef.current.contains(event.target as Node)) {
        setShowSupplierFilterDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update supplier search when formData.supplier changes (for edit mode)
  useEffect(() => {
    if (formData.supplier && suppliers.length > 0) {
      const selectedSupplier = suppliers.find((supplier: any) =>
        supplier.id.toString() === formData.supplier.toString()
      );
      if (selectedSupplier) {
        setSupplierSearch(selectedSupplier.name);
      } else {
        setSupplierSearch('');
      }
    } else if (!formData.supplier) {
      setSupplierSearch('');
    }
  }, [formData.supplier, suppliers]);

  // Update supplier filter search when supplierFilter changes
  useEffect(() => {
    if (supplierFilter && suppliers.length > 0) {
      const selectedSupplier = suppliers.find((supplier: any) =>
        supplier.id.toString() === supplierFilter.toString()
      );
      if (selectedSupplier) {
        setSupplierFilterSearch(selectedSupplier.name);
      } else {
        setSupplierFilterSearch('');
      }
    } else if (!supplierFilter) {
      setSupplierFilterSearch('');
    }
  }, [supplierFilter, suppliers]);

  // Compute purchases array
  const purchases = useMemo(() => {
    if (!data) return [];
    // Handle nested data structure (data.data.results)
    if (data.data && Array.isArray(data.data.results)) return data.data.results;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }, [data]);

  // Get all product-purchase combinations that need label status checks (with caching)
  const labelStatusQueriesData = useMemo(() => {
    if (!purchases || purchases.length === 0) return [];

    const queries: Array<{ productId: number; purchaseId?: number; labelKey: string }> = [];
    const seenKeys = new Set<string>();

    purchases.forEach((purchase: any) => {
      if (purchase.items && purchase.items.length > 0) {
        purchase.items.forEach((item: any) => {
          const productId = item.product;
          if (productId && item.product_track_inventory) {
            const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
            const labelKey = `${productId} `;

            // Only add if we haven't seen this product yet (avoid duplicates)
            if (!seenKeys.has(labelKey)) {
              seenKeys.add(labelKey);
              queries.push({ productId, purchaseId, labelKey });
            }
          }
        });
      }
    });

    return queries;
  }, [purchases]);

  // Use React Query to cache label status checks for all products in purchases
  const labelStatusQueries = useQueries({
    queries: labelStatusQueriesData.map(({ productId, purchaseId, labelKey }) => ({
      queryKey: ['label-status', productId, purchaseId],
      queryFn: async () => {
        try {
          const response = await productsApi.labelsStatus(productId, purchaseId);
          return { productId, purchaseId, labelKey, data: response.data, error: null };
        } catch (error: any) {
          // Silently handle 404 errors - endpoint may not be available or product may not have barcodes
          if (error.response?.status === 404) {
            return { productId, purchaseId, labelKey, data: { all_generated: false }, error: null };
          }
          return { productId, purchaseId, labelKey, data: { all_generated: false }, error: error.message };
        }
      },
      staleTime: 2 * 60 * 1000, // 2 minutes - label status doesn't change frequently
      gcTime: 10 * 60 * 1000, // 10 minutes cache
      retry: false,
      enabled: productId > 0,
    })),
  });

  // Update labelStatuses state from cached queries
  // Use ref to track processed states and prevent infinite loops
  type LabelStatusQueryData = { productId: number; purchaseId?: number; labelKey: string; data: { all_generated?: boolean }; error: null } | { productId: number; purchaseId?: number; labelKey: string; data: { all_generated: boolean }; error: string };

  const queriesDataRef = useRef<string>('');

  // Create a dependency string that includes query data and status
  const queriesDependencyString = useMemo(() => {
    return labelStatusQueries.map((q, idx) => {
      const qData = q.data as LabelStatusQueryData | undefined;
      const isSuccess = q.isSuccess;
      const isFetching = q.isFetching;
      return qData ? `${qData.labelKey}:${qData.data?.all_generated ?? false}:${isFetching}:${isSuccess} ` : `empty:${idx} `;
    }).join('|');
  }, [
    // Use JSON.stringify to create a stable dependency that changes when query data changes
    JSON.stringify(labelStatusQueries.map(q => ({
      data: q.data,
      isSuccess: q.isSuccess,
      isFetching: q.isFetching,
    }))),
    labelStatusQueries.length,
  ]);

  useEffect(() => {
    // Only process if data actually changed
    if (queriesDataRef.current === queriesDependencyString) {
      return;
    }

    queriesDataRef.current = queriesDependencyString;

    labelStatusQueries.forEach((query) => {
      const queryData = query.data as LabelStatusQueryData | undefined;
      if (queryData && queryData.labelKey) {
        const labelKey = queryData.labelKey;
        const all_generated = queryData.data?.all_generated || false;
        const generating = query.isFetching || false;

        // Update state only if it changed
        setLabelStatuses(prev => {
          const current = prev[labelKey];

          // Only update if the value actually changed
          if (current?.all_generated === all_generated && current?.generating === generating) {
            return prev;
          }

          return {
            ...prev,
            [labelKey]: {
              all_generated,
              generating
            }
          };
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriesDependencyString]);

  // Handle supplier selection in modal
  const handleSupplierSelect = (supplierId: string) => {
    setFormData((prev) => ({ ...prev, supplier: supplierId }));
    const selectedSupplier = suppliers.find((supplier: any) => supplier.id.toString() === supplierId);
    setSupplierSearch(selectedSupplier?.name || '');
    setSupplierFilterInput(''); // Clear filter when selecting
    setShowSupplierDropdown(false);
  };

  // Handle supplier filter selection
  const handleSupplierFilterSelect = (supplierId: string) => {
    setSupplierFilter(supplierId);
    const selectedSupplier = suppliers.find((supplier: any) => supplier.id.toString() === supplierId);
    setSupplierFilterSearch(selectedSupplier?.name || '');
    setShowSupplierFilterDropdown(false);
  };

  // Early returns must come AFTER all hooks
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

  const paginationInfo = (() => {
    // Check if data.data exists (nested structure like Invoices)
    if (data?.data && typeof data.data === 'object' && 'count' in data.data) {
      return {
        totalItems: data.data.count as number,
        totalPages: data.data.total_pages as number,
        currentPage: data.data.page as number,
        pageSize: data.data.page_size as number,
      };
    }
    // Check direct structure (like Products)
    if (data && typeof data === 'object' && 'count' in data) {
      return {
        totalItems: data.count as number,
        totalPages: data.total_pages as number,
        currentPage: data.page as number,
        pageSize: data.page_size as number,
      };
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        subtitle="Manage purchases and bills from suppliers"
        icon={FileText}
      />

      <div className="flex items-center justify-between">
        <div className="flex-1"></div>
        <Button onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-5 w-5 mr-2 inline" />
          New Purchase
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative" ref={supplierFilterRef}>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                value={supplierFilterSearch}
                onChange={(e) => {
                  setSupplierFilterSearch(e.target.value);
                  setShowSupplierFilterDropdown(true);
                }}
                onFocus={() => {
                  setShowSupplierFilterDropdown(true);
                }}
                placeholder="Type to search suppliers..."
                className="pl-10"
              />
              {showSupplierFilterDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  <div
                    onClick={() => {
                      setSupplierFilter('');
                      setSupplierFilterSearch('');
                      setShowSupplierFilterDropdown(false);
                    }}
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                  >
                    All Suppliers
                  </div>
                  {filteredSuppliersForFilter.length > 0 ? (
                    filteredSuppliersForFilter.map((supplier: any) => (
                      <div
                        key={supplier.id}
                        onClick={() => handleSupplierFilterSelect(supplier.id.toString())}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      >
                        {supplier.name} {supplier.code && `(${supplier.code})`}
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-2 text-gray-500 text-sm">No suppliers found</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From Date"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To Date"
          />
        </div>
      </Card>

      {/* Purchases Table */}
      {purchases.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No purchases found"
            message="No purchases match your search criteria"
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={[
              { label: 'Purchase #', align: 'left' },
              { label: 'Supplier', align: 'left' },
              { label: 'Date', align: 'left' },
              { label: 'Bill #', align: 'left' },
              { label: 'Items', align: 'center' },
              { label: 'Total', align: 'right' },
              { label: 'Status', align: 'center' },
              { label: '', align: 'right' },
            ]}>
              {purchases.map((purchase: any) => {
                return (
                  <Fragment key={purchase.id}>
                    <TableRow>
                      <TableCell>
                        <span className="font-mono font-semibold text-gray-900">
                          {purchase.purchase_number || `PUR - ${purchase.id} `}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-900">
                          {purchase.supplier_name || '-'}
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
                        {(() => {
                          const status = purchase.status || 'draft';
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
                        })()}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-2 justify-end"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          {purchase.status !== 'cancelled' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(purchase)}
                              className="gap-1.5"
                            >
                              <Edit className="h-4 w-4" />
                              <span>Edit</span>
                            </Button>
                          )}
                          {!isRetailUser && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(purchase.id)}
                              className="gap-1.5 text-red-600 hover:text-red-700"
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>Delete</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {purchase.items && purchase.items.length > 0 && (
                      <TableRow key={`${purchase.id} -expanded`} className="bg-gray-50">
                        <TableCell colSpan={8} className="p-0">
                          <div className="p-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Purchase Items</h4>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">Product</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">Variant</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase">Quantity</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase">Unit Price</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase">Total</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Labels</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Printed</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {purchase.items.map((item: any, idx: number) => {
                                    const productId = item.product;
                                    const trackInventory = item.product_track_inventory;
                                    const labelKey = `${productId} `;
                                    const labelStatus = labelStatuses[labelKey] || { all_generated: false, generating: false };

                                    return (
                                      <tr key={item.id || `${purchase.id} -item - ${idx} `}>
                                        <td className="px-3 py-2">
                                          <div className="text-sm font-medium text-gray-900">{item.product_name || '-'}</div>
                                          <div className="text-xs text-gray-500">{item.product_sku || 'N/A'}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          {item.variant_name ? (
                                            <>
                                              <div className="text-sm text-gray-900">{item.variant_name}</div>
                                              <div className="text-xs text-gray-500">{item.variant_sku || 'N/A'}</div>
                                            </>
                                          ) : (
                                            <span className="text-sm text-gray-400">-</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <span className="text-sm text-gray-900">{item.quantity || 0}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <span className="text-sm text-gray-900">{formatCurrency(item.unit_price || 0)}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <span className="text-sm font-semibold text-gray-900">{formatCurrency(item.line_total || 0)}</span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {trackInventory ? (
                                            <div className="flex items-center justify-center">
                                              {(() => {
                                                const isGenerating = generatingLabelsFor === productId || labelStatus.generating;
                                                const allGenerated = labelStatus.all_generated;

                                                if (isGenerating) {
                                                  return (
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      disabled
                                                      className="flex items-center gap-1.5"
                                                      title="Generating Labels..."
                                                    >
                                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                      <span className="hidden sm:inline">Generating...</span>
                                                    </Button>
                                                  );
                                                }

                                                if (allGenerated) {
                                                  return (
                                                    <div className="flex items-center gap-1.5">
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handlePrintLabels(productId, purchase.id)}
                                                        className="flex items-center gap-1.5 text-green-700 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300"
                                                        title="Print Labels"
                                                      >
                                                        <Printer className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">Print Labels</span>
                                                      </Button>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleRegenerateLabels(productId, purchase.id)}
                                                        className="flex items-center gap-1.5 text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100 hover:border-orange-300"
                                                        title="Regenerate Labels"
                                                      >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                      </Button>
                                                    </div>
                                                  );
                                                }

                                                return (
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleGenerateLabels(productId, purchase.id)}
                                                    className="flex items-center gap-1.5 text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300"
                                                    title="Generate Labels"
                                                  >
                                                    <Printer className="h-3.5 w-3.5" />
                                                    <span className="hidden sm:inline">Generate Labels</span>
                                                  </Button>
                                                );
                                              })()}
                                            </div>
                                          ) : (
                                            <span className="text-xs text-gray-400">N/A</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          <input
                                            type="checkbox"
                                            checked={item.printed || false}
                                            onChange={(e) => {
                                              const newPrintedStatus = e.target.checked;
                                              if (item.id) {
                                                updatePrintedMutation.mutate({
                                                  itemId: item.id,
                                                  printed: newPrintedStatus,
                                                });
                                              }
                                            }}
                                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                            title={item.printed_at ? `Printed at: ${formatDate(item.printed_at)}` : 'Mark as printed'}
                                          />
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </Table>
            {paginationInfo && (
              <Pagination
                currentPage={paginationInfo.currentPage}
                totalPages={paginationInfo.totalPages}
                totalItems={paginationInfo.totalItems}
                pageSize={paginationInfo.pageSize}
                onPageChange={(page) => setCurrentPage(page)}
              />
            )}
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {purchases.map((purchase: any) => {
              return (
                <Card key={purchase.id}>
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          <span className="font-mono font-semibold text-gray-900 text-base">
                            {purchase.purchase_number || `PUR - ${purchase.id} `}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 mb-1">
                          {purchase.supplier_name || '-'}
                        </div>
                        <div className="text-sm text-gray-600">
                          {formatDate(purchase.purchase_date)}
                        </div>
                        {purchase.bill_number && (
                          <div className="text-xs text-gray-500 mt-1">
                            Bill: {purchase.bill_number}
                          </div>
                        )}
                        <div className="mt-2">
                          {(() => {
                            const status = purchase.status || 'draft';
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
                          })()}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {purchase.status !== 'cancelled' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(purchase)}
                            className="p-2"
                            title="Edit purchase"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {!isRetailUser && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(purchase.id)}
                            className="p-2 text-red-600 hover:text-red-700"
                            disabled={deleteMutation.isPending}
                            title="Delete purchase"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

                  {/* Purchase Items Section - Always Visible */}
                  {purchase.items && purchase.items.length > 0 && (
                    <div className="px-4 pb-4 border-t border-gray-200 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mt-3 mb-2">Purchase Items</h4>
                      <div className="space-y-2">
                        {purchase.items.map((item: any, idx: number) => {
                          const productId = item.product;
                          const trackInventory = item.product_track_inventory;
                          const labelKey = `${productId} `;
                          const labelStatus = labelStatuses[labelKey] || { all_generated: false, generating: false };

                          return (
                            <div key={item.id || `${purchase.id} -item - ${idx} `} className="bg-white rounded-md p-3 border border-gray-200">
                              <div className="flex justify-between items-start mb-1">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900">{item.product_name || '-'}</div>
                                  <div className="text-xs text-gray-500 mt-0.5">{item.product_sku || 'N/A'}</div>
                                  {item.variant_name && (
                                    <>
                                      <div className="text-xs text-gray-700 mt-1">Variant: {item.variant_name}</div>
                                      {item.variant_sku && (
                                        <div className="text-xs text-gray-500">{item.variant_sku}</div>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-100 text-xs">
                                <div>
                                  <div className="text-gray-500 mb-0.5">Qty</div>
                                  <div className="font-semibold text-gray-900">{item.quantity || 0}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 mb-0.5">Price</div>
                                  <div className="font-semibold text-gray-900">{formatCurrency(item.unit_price || 0)}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 mb-0.5">Total</div>
                                  <div className="font-semibold text-gray-900">{formatCurrency(item.line_total || 0)}</div>
                                </div>
                              </div>
                              {trackInventory && (
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <div className="flex items-center justify-center">
                                    {(() => {
                                      const isGenerating = generatingLabelsFor === productId || labelStatus.generating;
                                      const allGenerated = labelStatus.all_generated;

                                      if (isGenerating) {
                                        return (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            disabled
                                            className="flex items-center gap-1.5 w-full"
                                            title="Generating Labels..."
                                          >
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            <span>Generating...</span>
                                          </Button>
                                        );
                                      }

                                      if (allGenerated) {
                                        return (
                                          <div className="flex flex-col gap-2">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handlePrintLabels(productId, purchase.id)}
                                              className="flex items-center gap-1.5 w-full text-green-700 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300"
                                              title="Print Labels"
                                            >
                                              <Printer className="h-3.5 w-3.5" />
                                              <span>Print Labels</span>
                                            </Button>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleRegenerateLabels(productId, purchase.id)}
                                              className="flex items-center gap-1.5 w-full text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100 hover:border-orange-300"
                                              title="Regenerate Labels"
                                            >
                                              <RotateCcw className="h-3.5 w-3.5" />
                                              <span>Regenerate</span>
                                            </Button>
                                          </div>
                                        );
                                      }

                                      return (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleGenerateLabels(productId, purchase.id)}
                                          className="flex items-center gap-1.5 w-full text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300"
                                          title="Generate Labels"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                          <span>Generate Labels</span>
                                        </Button>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            {paginationInfo && (
              <Pagination
                currentPage={paginationInfo.currentPage}
                totalPages={paginationInfo.totalPages}
                totalItems={paginationInfo.totalItems}
                pageSize={paginationInfo.pageSize}
                onPageChange={(page) => setCurrentPage(page)}
              />
            )}
          </div>
        </>
      )}

      {/* Purchase Form Modal */}
      {showForm && (
        <Modal
          isOpen={showForm}
          onClose={() => { setShowForm(false); resetForm(); }}
          title={editingPurchase ? 'Edit Purchase' : 'New Purchase'}
          size="wide"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Supplier *</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSupplierForm(true)}
                  className="text-xs"
                >
                  <UserPlus className="h-3 w-3 mr-1" />
                  New Supplier
                </Button>
              </div>
              <div className="relative" ref={supplierRef}>
                <Input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => {
                    setSupplierSearch(e.target.value);
                    setSupplierFilterInput(e.target.value); // Update filter for dropdown
                    setShowSupplierDropdown(true);
                  }}
                  onFocus={() => {
                    setSupplierFilterInput(''); // Clear filter to show all items when opening
                    setShowSupplierDropdown(true);
                  }}
                  placeholder="Type to search or select supplier..."
                  required
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && supplierFilterInput.trim() && !supplierExists) {
                      e.preventDefault();
                      // Open supplier form with pre-filled name
                      setSupplierFormData({
                        ...supplierFormData,
                        name: supplierFilterInput.trim(),
                      });
                      setShowSupplierForm(true);
                      setShowSupplierDropdown(false);
                    }
                  }}
                />
                {showSupplierDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {filteredSuppliers.length > 0 ? (
                      filteredSuppliers.map((supplier: any) => (
                        <div
                          key={supplier.id}
                          onClick={() => handleSupplierSelect(supplier.id.toString())}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                        >
                          {supplier.name} {supplier.code && `(${supplier.code})`}
                        </div>
                      ))
                    ) : supplierFilterInput.trim() && !supplierExists ? (
                      <div
                        onClick={() => {
                          setSupplierFormData({
                            ...supplierFormData,
                            name: supplierFilterInput.trim(),
                          });
                          setShowSupplierForm(true);
                          setShowSupplierDropdown(false);
                        }}
                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex items-center text-blue-600 text-sm"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add "{supplierFilterInput}"
                      </div>
                    ) : (
                      <div className="px-4 py-2 text-gray-500 text-sm">No suppliers found</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <DatePicker
                  label="Purchase Date *"
                  value={formData.purchase_date}
                  onChange={(date) => setFormData({ ...formData, purchase_date: date })}
                  required
                />
              </div>
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
                  ref={(el) => {
                    if (el) productSearchInputRef.current = el;
                  }}
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
                              {product.variants && product.variants.length > 0 && ` • ${product.variants.length} variant(s)`}
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

              {/* Purchase Items - Desktop Table View */}
              {purchaseItems.length > 0 && (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block border border-gray-300 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchase Price</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Selling Price</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {purchaseItems.map((item, index) => {
                          const soldCount = (item as any).sold_count || 0;
                          const currentQuantity = parseInt(item.quantity) || 0;
                          const minQuantity = editingPurchase ? soldCount : 0;
                          const hasQuantityError = editingPurchase && currentQuantity < soldCount;

                          return (
                            <tr key={index}>
                              <td className="px-3 py-2">
                                <div className="text-sm font-medium text-gray-900">{item.product_name || 'Product'}</div>
                                <div className="text-xs text-gray-500">
                                  {item.product_sku || 'N/A'}
                                  {item.variant_name && ` • Variant: ${item.variant_name} `}
                                </div>
                                {editingPurchase && soldCount > 0 && (
                                  <div className="text-xs text-amber-600 mt-1 font-medium">
                                    ⚠️ {soldCount} item{soldCount !== 1 ? 's' : ''} sold (min qty: {soldCount})
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div>
                                  <Input
                                    type="number"
                                    step="1"
                                    min={Math.max(0, minQuantity).toString()}
                                    value={item.quantity}
                                    placeholder="1"
                                    onChange={(e) => {
                                      // Only allow positive integers
                                      const val = e.target.value;
                                      if (val === '' || /^\d+$/.test(val)) {
                                        handleItemChange(index, 'quantity', val);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      // Ensure value is a positive integer on blur, default to 1 if empty (matching placeholder)
                                      const val = e.target.value === '' ? 1 : Math.max(1, parseInt(e.target.value) || 1);
                                      handleItemChange(index, 'quantity', val.toString());
                                    }}
                                    className={`w - 20 text - sm ${hasQuantityError ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                    required
                                    title={editingPurchase && soldCount > 0 ? `Minimum quantity: ${soldCount} (${soldCount} items already sold)` : undefined}
                                  />
                                  {hasQuantityError && (
                                    <div className="text-xs text-red-600 mt-0.5">
                                      Min: {soldCount} (sold)
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.unit_price}
                                  placeholder="0"
                                  onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                                  onBlur={(e) => {
                                    // Ensure value is a non-negative number on blur, default to 0 if empty (matching placeholder)
                                    const val = e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0);
                                    handleItemChange(index, 'unit_price', val.toString());
                                  }}
                                  className="w-24 text-sm"
                                  required
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.selling_price || ''}
                                  placeholder="Optional"
                                  onChange={(e) => handleItemChange(index, 'selling_price', e.target.value)}
                                  onBlur={(e) => {
                                    // Allow empty or non-negative number
                                    const val = e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0);
                                    handleItemChange(index, 'selling_price', val === '' ? '' : val.toString());
                                  }}
                                  className="w-24 text-sm"
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
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-right text-sm font-medium text-gray-700">
                            Total:
                          </td>
                          <td colSpan={2} className="px-3 py-2 text-right text-sm font-bold text-gray-900">
                            {formatCurrency(calculateTotal())}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="md:hidden space-y-3">
                    {purchaseItems.map((item, index) => {
                      const soldCount = (item as any).sold_count || 0;
                      const currentQuantity = parseInt(item.quantity) || 0;
                      const minQuantity = editingPurchase ? soldCount : 0;
                      const hasQuantityError = editingPurchase && currentQuantity < soldCount;

                      return (
                        <div key={index} className="bg-white border border-gray-300 rounded-lg p-4 space-y-3">
                          {/* Product Info Header */}
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="text-sm font-medium text-gray-900">{item.product_name || 'Product'}</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {item.product_sku || 'N/A'}
                                {item.variant_name && ` • Variant: ${item.variant_name} `}
                              </div>
                              {editingPurchase && soldCount > 0 && (
                                <div className="text-xs text-amber-600 mt-1 font-medium">
                                  ⚠️ {soldCount} item{soldCount !== 1 ? 's' : ''} sold (min qty: {soldCount})
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(index)}
                              className="text-red-600 hover:text-red-700 flex-shrink-0 p-1"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </div>

                          {/* Input Fields - Stacked on Mobile */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Quantity *</label>
                              <Input
                                type="number"
                                step="1"
                                min={Math.max(0, minQuantity).toString()}
                                value={item.quantity}
                                placeholder="1"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '' || /^\d+$/.test(val)) {
                                    handleItemChange(index, 'quantity', val);
                                  }
                                }}
                                onBlur={(e) => {
                                  const val = e.target.value === '' ? 1 : Math.max(1, parseInt(e.target.value) || 1);
                                  handleItemChange(index, 'quantity', val.toString());
                                }}
                                className={`w - full text - sm ${hasQuantityError ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                required
                              />
                              {hasQuantityError && (
                                <div className="text-xs text-red-600 mt-0.5">
                                  Min: {soldCount} (sold)
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Total</label>
                              <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium text-gray-900 text-right">
                                {formatCurrency(item.line_total || 0)}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Purchase Price *</label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.unit_price}
                                placeholder="0"
                                onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                                onBlur={(e) => {
                                  const val = e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0);
                                  handleItemChange(index, 'unit_price', val.toString());
                                }}
                                className="w-full text-sm"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Selling Price</label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.selling_price || ''}
                                placeholder="Optional"
                                onChange={(e) => handleItemChange(index, 'selling_price', e.target.value)}
                                onBlur={(e) => {
                                  const val = e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0);
                                  handleItemChange(index, 'selling_price', val === '' ? '' : val.toString());
                                }}
                                className="w-full text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Total Footer for Mobile */}
                    <div className="bg-gray-50 border border-gray-300 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Total:</span>
                        <span className="text-lg font-bold text-gray-900">{formatCurrency(calculateTotal())}</span>
                      </div>
                    </div>
                  </div>
                </>
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
                alert('Supplier Name is required');
                return;
              }
              if (!supplierFormData.code.trim()) {
                alert('Supplier Code is required');
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
  );
}
