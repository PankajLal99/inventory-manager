import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { productsApi, inventoryApi, catalogApi, purchasingApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { Plus, Edit, Barcode, AlertTriangle, TrendingDown, Package, Trash2, Printer, Eye, Loader2, Filter, Tag, RotateCcw, CheckCircle, XCircle, ShoppingCart, ChevronDown, ChevronRight, Coins, FileText, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import Pagination from '../../components/ui/Pagination';
import ProductForm from './ProductForm';
import BarcodeScanner from '../../components/BarcodeScanner';

export default function Products() {
  const navigate = useNavigate();
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRetailUser = userGroups.includes('Retail') && !userGroups.includes('Admin') && !userGroups.includes('RetailAdmin');
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<number | undefined>();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') || '');
  const [brandFilter, setBrandFilter] = useState(searchParams.get('brand') || '');
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get('supplier') || '');
  const [stockStatusFilter, setStockStatusFilter] = useState(searchParams.get('stock_status') || '');
  const [tagFilter, setTagFilter] = useState(searchParams.get('tag') || 'new'); // Default to 'new' (fresh)
  const [activeStockTab, setActiveStockTab] = useState<'stock' | 'low' | 'out'>('stock');
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<number | undefined>();
  const [showViewSKUsModal, setShowViewSKUsModal] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<any>(null);
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<number, { all_generated: boolean; generating: boolean }>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<number, boolean>>({});
  const [selectedDefectiveProducts, setSelectedDefectiveProducts] = useState<Set<number>>(new Set());
  const [selectedDefectiveProductsData, setSelectedDefectiveProductsData] = useState<Map<number, any>>(new Map());
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeScanError, setBarcodeScanError] = useState<string | null>(null);
  const [showMoveOutModal, setShowMoveOutModal] = useState(false);
  const [moveOutData, setMoveOutData] = useState({
    reason: 'defective',
    notes: '',
  });
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusProduct, setStatusProduct] = useState<any>(null);
  const [newTag, setNewTag] = useState<string>('');
  const [adjustmentData, setAdjustmentData] = useState({
    adjustment_type: 'in',
    product: '',
    quantity: '',
    reason: 'correction',
    notes: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const queryClient = useQueryClient();

  // Fetch categories and brands for filters
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data;
    },
    retry: false,
  });

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data;
    },
    retry: false,
  });

  // Fetch suppliers for filter
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data;
    },
    retry: false,
  });

  // Sync URL params with state on mount
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    const urlCategory = searchParams.get('category') || '';
    const urlBrand = searchParams.get('brand') || '';
    const urlSupplier = searchParams.get('supplier') || '';
    const urlStockStatus = searchParams.get('stock_status') || '';
    const urlTag = searchParams.get('tag') || 'new'; // Default to 'new' if not in URL

    if (urlSearch !== search) setSearch(urlSearch);
    if (urlCategory !== categoryFilter) setCategoryFilter(urlCategory);
    if (urlBrand !== brandFilter) setBrandFilter(urlBrand);
    if (urlSupplier !== supplierFilter) setSupplierFilter(urlSupplier);
    if (urlStockStatus !== stockStatusFilter) setStockStatusFilter(urlStockStatus);
    if (urlTag !== tagFilter) setTagFilter(urlTag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (categoryFilter) params.set('category', categoryFilter);
    if (brandFilter) params.set('brand', brandFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (stockStatusFilter) params.set('stock_status', stockStatusFilter);
    if (tagFilter) params.set('tag', tagFilter);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter]);

  // Build query params for API
  const buildQueryParams = () => {
    const params: any = {};
    if (search) {
      params.search = search;
      params.search_mode = 'name_only'; // Search only by product name on Products page
    }
    if (categoryFilter) params.category = categoryFilter;
    if (brandFilter) params.brand = brandFilter;
    if (supplierFilter) params.supplier = supplierFilter;
    // Only apply stock status filters when viewing fresh (new) products
    if (tagFilter === 'new') {
      if (stockStatusFilter === 'in_stock') params.in_stock = 'true';
      if (stockStatusFilter === 'low_stock') params.low_stock = 'true';
      if (stockStatusFilter === 'out_of_stock') params.out_of_stock = 'true';
    }
    // Always include tag filter (defaults to 'new')
    params.tag = tagFilter || 'new';
    // Pagination
    params.page = currentPage;
    params.limit = 50;
    return params;
  };

  // Fetch products
  const { data, isLoading, error } = useQuery({
    queryKey: ['products', search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter, currentPage],
    queryFn: async () => {
      const response = await productsApi.list(buildQueryParams());
      return response.data;
    },
    retry: false,
    placeholderData: keepPreviousData,
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter]);

  // Fetch stores and warehouses
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data || response;
    },
    retry: false,
  });

  const { data: _warehousesResponse } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const response = await catalogApi.warehouses.list();
      return response.data || response;
    },
    retry: false,
  });

  // Handle different response formats
  const allProducts = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  // Get all product IDs that need label status checks (with caching)
  const productIdsForLabelCheck = useMemo(() => {
    if (!allProducts || allProducts.length === 0) return [];
    return allProducts
      .filter((product: any) => product.barcodes && product.barcodes.length > 0)
      .map((product: any) => product.id)
      .filter((id: number) => id > 0); // Filter out invalid IDs
  }, [allProducts]);

  // Use React Query to cache label status checks for all products
  const labelStatusQueries = useQueries({
    queries: productIdsForLabelCheck.map((productId: number) => ({
      queryKey: ['label-status', productId],
      queryFn: async () => {
        try {
          const response = await productsApi.labelsStatus(productId);
          return { productId, data: response.data, error: null };
        } catch (error: any) {
          // Silently handle 404 errors - endpoint may not be available or product may not have barcodes
          if (error.response?.status === 404) {
            return { productId, data: { all_generated: false }, error: null };
          }
          return { productId, data: { all_generated: false }, error: error.message };
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
  type LabelStatusQueryData = { productId: number; data: { all_generated?: boolean }; error: null } | { productId: number; data: { all_generated: boolean }; error: string };

  const queriesDataRef = useRef<string>('');

  // Create a stable dependency string that doesn't change size
  const productIdsString = useMemo(() => {
    return productIdsForLabelCheck.join(',');
  }, [
    productIdsForLabelCheck.length,
    productIdsForLabelCheck.join(',')
  ]);

  const queriesDependencyString = useMemo(() => {
    return labelStatusQueries.map(q => {
      const qData = q.data as LabelStatusQueryData | undefined;
      return qData ? `${qData.productId}:${qData.data?.all_generated ?? false}:${q.isFetching}` : '';
    }).filter(Boolean).join('|');
  }, [
    productIdsString,
    labelStatusQueries.length
  ]);

  useEffect(() => {
    // Only process if data actually changed
    if (queriesDataRef.current === queriesDependencyString) {
      return;
    }

    queriesDataRef.current = queriesDependencyString;

    labelStatusQueries.forEach((query) => {
      const queryData = query.data as LabelStatusQueryData | undefined;
      if (queryData && typeof queryData.productId === 'number') {
        const productId = queryData.productId;
        const all_generated = queryData.data?.all_generated || false;
        const generating = query.isFetching || false;

        // Update state only if it changed
        setLabelStatuses(prev => {
          const current = prev[productId];

          // Only update if the value actually changed
          if (current?.all_generated === all_generated && current?.generating === generating) {
            return prev;
          }

          return {
            ...prev,
            [productId]: {
              all_generated,
              generating
            }
          };
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriesDependencyString]);

  const paginationInfo = data && typeof data === 'object' && 'count' in data ? {
    totalItems: data.count as number,
    totalPages: data.total_pages as number,
    currentPage: data.page as number,
    pageSize: data.page_size as number,
  } : null;


  // Combine products with their stock information
  // All products track inventory now - always show stock
  // Backend provides stock_quantity and available_quantity directly (barcode-based)
  const productsWithStock = allProducts.map((product: any) => {
    // Ensure low_stock_threshold is a number
    const threshold = typeof product.low_stock_threshold === 'number'
      ? product.low_stock_threshold
      : (product.low_stock_threshold ? parseInt(product.low_stock_threshold) : 0);

    // Use backend's available_quantity (barcode-based) as source of truth
    // Backend calculates: barcodes with 'new'/'returned' tags minus barcodes in active carts
    const availableQty = (product.available_quantity !== undefined && product.available_quantity !== null)
      ? (typeof product.available_quantity === 'number' ? product.available_quantity : parseFloat(product.available_quantity) || 0)
      : 0;

    // Use barcode-based stock_quantity from backend as source of truth
    // Backend calculates: count of barcodes with 'new' and 'returned' tags
    const barcodeBasedStock = (product.stock_quantity !== undefined && product.stock_quantity !== null)
      ? (typeof product.stock_quantity === 'number' ? product.stock_quantity : parseFloat(product.stock_quantity) || 0)
      : 0;

    // Check low stock if threshold is set and stock is above 0 but below or equal to threshold
    const isLowStock = threshold > 0 && barcodeBasedStock > 0 && barcodeBasedStock <= threshold;
    // Mark as out of stock if total is 0
    const isOutOfStock = barcodeBasedStock === 0;

    return {
      ...product,
      stock_quantity: barcodeBasedStock,
      reserved_quantity: 0, // Reserved quantity is handled by backend via available_quantity
      available_quantity: availableQty,
      isLowStock,
      isOutOfStock,
    };
  });

  // With new model: ONE Product per name, barcodes are individual items
  // No need to group - show Products directly with their barcodes
  const productsList = useMemo(() => {
    return productsWithStock.map((product: any) => {
      // For non-tracked inventory products, use available_quantity from backend
      // For tracked inventory products, count barcodes
      const trackInventory = product.track_inventory !== false; // Default to true if not specified

      let barcodeCount: number;
      // For 'sold' filter, use sold_quantity if available
      if (tagFilter === 'sold' && product.sold_quantity !== undefined && product.sold_quantity !== null) {
        barcodeCount = typeof product.sold_quantity === 'number'
          ? product.sold_quantity
          : parseFloat(product.sold_quantity) || 0;
      } else if (!trackInventory) {
        // Non-tracked: use available_quantity which accounts for cart quantities
        // Backend calculates: stock_quantity - total_cart_quantity
        // Use the available_quantity that was preserved from backend (in productsWithStock)
        const backendAvailableQty = product.available_quantity;
        barcodeCount = (backendAvailableQty !== undefined && backendAvailableQty !== null)
          ? Math.max(0, Math.floor(backendAvailableQty))
          : (product.stock_quantity || 0); // Fallback to stock_quantity if available_quantity not provided
      } else {
        // Tracked: count available barcodes (excluding those in active carts)
        const barcodes = product.barcodes || [];
        barcodeCount = Array.isArray(barcodes) ? barcodes.length : 0;
      }

      // Stock is at product level
      // const _stockQty = product.stock_quantity || 0;
      // const _availableQty = product.available_quantity || 0;
      const lowStockThreshold = product.low_stock_threshold || 0;

      // Check stock status based on available quantity (barcodeCount)
      // This ensures status reflects real-time availability
      const isLowStock = lowStockThreshold > 0 && barcodeCount > 0 && barcodeCount <= lowStockThreshold;
      const isOutOfStock = barcodeCount === 0;

      return {
        ...product,
        barcodeCount, // Available quantity - reflects real-time availability (accounts for cart quantities for non-tracked products)
        isLowStock,
        isOutOfStock,
      };
    });
  }, [productsWithStock]);

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // const _warehouses = (() => {
  //   if (!warehousesResponse) return [];
  //   if (Array.isArray(warehousesResponse.results)) return warehousesResponse.results;
  //   if (Array.isArray(warehousesResponse.data)) return warehousesResponse.data;
  //   if (Array.isArray(warehousesResponse)) return warehousesResponse;
  //   return [];
  // })();

  const adjustmentMutation = useMutation({
    mutationFn: (data: any) => inventoryApi.adjustments.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowAdjustmentForm(false);
      setAdjustingProduct(undefined);
      setAdjustmentData({
        adjustment_type: 'in',
        product: '',
        quantity: '',
        reason: 'correction',
        notes: '',
      });
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.detail ||
        (typeof error?.response?.data === 'object'
          ? Object.values(error.response.data).flat().join(', ')
          : 'Failed to create stock adjustment');
      alert(errorMsg);
    },
  });

  const updateBarcodeTagMutation = useMutation({
    mutationFn: async ({ barcodeIds, newTag }: { barcodeIds: number[]; newTag: string }) => {
      return catalogApi.barcodes.bulkUpdateTags({
        barcode_ids: barcodeIds,
        tag: newTag
      });
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] });
      setShowStatusModal(false);
      setStatusProduct(null);
      setNewTag('');
      const updatedCount = response.data?.updated_barcodes?.length || 0;
      if (updatedCount > 0) {
        alert(`Successfully updated ${updatedCount} barcode(s) tag. Changes have been logged in activities.`);
      } else {
        const errors = response.data?.errors || [];
        if (errors.length > 0) {
          alert(`Some barcodes could not be updated: ${errors.join(', ')}`);
        } else {
          alert('No barcodes were updated. Please check if the tag transition is allowed.');
        }
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        'Failed to update barcode tag';
      alert(errorMsg);
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await productsApi.delete(id);
      return response;
    },
    onSuccess: (_data, _productId) => {
      // Invalidate and refetch to ensure UI updates immediately
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Force immediate refetch
      queryClient.refetchQueries({ queryKey: ['products', search] });
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.detail ||
        error?.response?.data?.message ||
        (typeof error?.response?.data === 'object'
          ? Object.values(error.response.data).flat().join(', ')
          : 'Failed to delete product');
      alert(`Error deleting product: ${errorMsg}`);
    },
  });



  const generateLabelsMutation = useMutation({
    mutationFn: (productId: number) => productsApi.generateLabels(productId),
    onSuccess: (data, productId) => {
      // Invalidate label status cache after generating labels
      queryClient.invalidateQueries({ queryKey: ['label-status', productId] });
      setLabelStatuses(prev => ({
        ...prev,
        [productId]: {
          all_generated: true,
          generating: false
        }
      }));
      setGeneratingLabelsFor(null);
      // Show success message
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
    onError: (error: any, productId) => {
      setGeneratingLabelsFor(null);
      setLabelStatuses(prev => ({
        ...prev,
        [productId]: {
          all_generated: false,
          generating: false
        }
      }));
      alert(error?.response?.data?.error || 'Failed to generate labels. Please try again.');
    },
  });

  const handleDeleteProduct = (productId: number, productName: string) => {
    if (window.confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone.`)) {
      deleteProductMutation.mutate(productId);
    }
  };

  // Mark barcodes as returned
  const markAsReturnedMutation = useMutation({
    mutationFn: async (data: { barcodeIds: number[] }) => {
      const response = await catalogApi.barcodes.bulkUpdateTags({
        barcode_ids: data.barcodeIds,
        tag: 'returned'
      });
      // Check for errors in response even if status is 200
      if (response.data?.errors && response.data.errors.length > 0) {
        throw new Error(response.data.errors.join(', '));
      }
      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] });
      const updatedCount = response.data?.updated_barcodes?.length || 0;
      if (updatedCount > 0) {
        alert(`Successfully marked ${updatedCount} item(s) as returned`);
      } else {
        alert('No items were marked as returned. Please check if items are in "unknown" status.');
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to mark items as returned';
      alert(errorMsg);
    },
  });

  // Mark barcodes as defective
  const markAsDefectiveMutation = useMutation({
    mutationFn: async (data: { barcodeIds: number[] }) => {
      const response = await catalogApi.barcodes.bulkUpdateTags({
        barcode_ids: data.barcodeIds,
        tag: 'defective'
      });
      // Check for errors in response even if status is 200
      if (response.data?.errors && response.data.errors.length > 0) {
        throw new Error(response.data.errors.join(', '));
      }
      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] });
      const updatedCount = response.data?.updated_barcodes?.length || 0;
      if (updatedCount > 0) {
        alert(`Successfully marked ${updatedCount} item(s) as defective`);
      } else {
        alert('No items were marked as defective. Please check if items are in "unknown" status and were previously sold.');
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to mark items as defective';
      alert(errorMsg);
    },
  });

  // Mark barcodes as fresh (new)
  const markAsFreshMutation = useMutation({
    mutationFn: async (data: { barcodeIds: number[], fromTag: string }) => {
      return await catalogApi.barcodes.bulkUpdateTags({
        barcode_ids: data.barcodeIds,
        tag: 'new'
      });
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] });
      const updatedCount = response.data?.updated_barcodes?.length || 0;
      if (updatedCount > 0) {
        alert(`Successfully marked ${updatedCount} item(s) as fresh and added them back to inventory. Changes have been logged in activities.`);
      } else {
        const errors = response.data?.errors || [];
        if (errors.length > 0) {
          alert(`Some items could not be updated: ${errors.join(', ')}`);
        } else {
          alert('No items were updated. Please check if the tag transition is allowed.');
        }
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        'Failed to mark items as fresh';
      alert(errorMsg);
    },
  });

  const handleMarkAsReturned = (product: any) => {
    const barcodes = product.barcodes || [];
    const barcodeIds = barcodes.map((b: any) => b.id).filter((id: any) => id);
    if (barcodeIds.length === 0) {
      alert('No barcodes found to mark as returned');
      return;
    }
    if (window.confirm(`Mark ${barcodeIds.length} item(s) as returned?`)) {
      markAsReturnedMutation.mutate({ barcodeIds });
    }
  };

  const handleMarkAsDefective = (product: any) => {
    const barcodes = product.barcodes || [];
    const barcodeIds = barcodes.map((b: any) => b.id).filter((id: any) => id);
    if (barcodeIds.length === 0) {
      alert('No barcodes found to mark as defective');
      return;
    }
    if (window.confirm(`Mark ${barcodeIds.length} item(s) as defective? This will remove them from inventory.`)) {
      markAsDefectiveMutation.mutate({ barcodeIds });
    }
  };

  const handleMarkAsFresh = (product: any, fromTag: string) => {
    const barcodes = product.barcodes || [];
    const barcodeIds = barcodes.map((b: any) => b.id).filter((id: any) => id);
    if (barcodeIds.length === 0) {
      alert('No barcodes found to mark as fresh');
      return;
    }
    let tagLabel = 'item';
    if (fromTag === 'returned') {
      tagLabel = 'returned';
    } else if (fromTag === 'defective') {
      tagLabel = 'defective';
    } else if (fromTag === 'in-cart') {
      tagLabel = 'in-cart';
    }
    if (window.confirm(`Are you sure you want to mark ${barcodeIds.length} ${tagLabel} item(s) as fresh and add them back to inventory?`)) {
      markAsFreshMutation.mutate({ barcodeIds, fromTag });
    }
  };

  // Handle marking all in-cart products as fresh
  const handleMarkAllInCartAsFresh = () => {
    // Collect all barcodes with 'in-cart' tag from all products
    const allInCartBarcodeIds: number[] = [];
    filteredProducts.forEach((product: any) => {
      const barcodes = product.barcodes || [];
      const inCartBarcodes = barcodes
        .filter((b: any) => b.tag === 'in-cart')
        .map((b: any) => b.id)
        .filter((id: any) => id);
      allInCartBarcodeIds.push(...inCartBarcodes);
    });

    if (allInCartBarcodeIds.length === 0) {
      alert('No in-cart items found to mark as fresh');
      return;
    }

    if (window.confirm(`Are you sure you want to mark all ${allInCartBarcodeIds.length} in-cart item(s) as fresh and add them back to inventory? This action will be logged in activities.`)) {
      markAsFreshMutation.mutate({
        barcodeIds: allInCartBarcodeIds,
        fromTag: 'in-cart'
      });
    }
  };

  const handleMarkBarcodeAsReturned = (barcodeId: number) => {
    if (window.confirm('Mark this barcode as returned?')) {
      markAsReturnedMutation.mutate({ barcodeIds: [barcodeId] });
    }
  };

  const handleMarkBarcodeAsDefective = (barcodeId: number) => {
    if (window.confirm('Mark this barcode as defective? This will remove it from inventory.')) {
      markAsDefectiveMutation.mutate({ barcodeIds: [barcodeId] });
    }
  };

  const handleMarkBarcodeAsFresh = (barcodeId: number, fromTag: string) => {
    const tagLabel = fromTag === 'returned' ? 'returned' : 'defective';
    if (window.confirm(`Mark this ${tagLabel} barcode as fresh and add it back to inventory?`)) {
      markAsFreshMutation.mutate({ barcodeIds: [barcodeId], fromTag });
    }
  };

  // Handle barcode scan for defective product selection - uses loaded product list (EFFICIENT - no API calls)
  const handleBarcodeScan = (barcode: string) => {
    if (!barcode || !barcode.trim()) return;

    const trimmedBarcode = barcode.trim();
    setBarcodeScanError(null);

    // Search in already loaded defective products (filteredProducts already contains only defective when tagFilter === 'defective')
    let matchedProduct = null;

    // Search through all filtered products
    for (const product of filteredProducts) {
      // Check if product has barcodes array
      const barcodes = product.barcodes || [];

      // Try to find matching barcode in the barcodes array
      const matchingBarcode = barcodes.find((b: any) => {
        // Handle different barcode formats
        const barcodeValue = typeof b === 'string' ? b : (b.barcode || b.id || '');
        return String(barcodeValue).trim() === trimmedBarcode;
      });

      if (matchingBarcode) {
        // Found matching barcode - product is already in defective list (filtered)
        matchedProduct = product;
        break;
      }

      // Also check product SKU as fallback (if barcode matches SKU)
      if (product.sku && String(product.sku).trim() === trimmedBarcode) {
        matchedProduct = product;
        break;
      }
    }

    if (matchedProduct) {
      // Check if product is already selected
      if (selectedDefectiveProducts.has(matchedProduct.id)) {
        setBarcodeScanError(`"${matchedProduct.name}" is already selected.`);
        setTimeout(() => setBarcodeScanError(null), 2000);
        return;
      }

      // Add product to selection
      setSelectedDefectiveProducts(prev => {
        const newSet = new Set(prev);
        newSet.add(matchedProduct.id);
        return newSet;
      });

      // Store product data for summary
      setSelectedDefectiveProductsData(prev => {
        const newMap = new Map(prev);
        if (!newMap.has(matchedProduct.id)) {
          newMap.set(matchedProduct.id, matchedProduct);
        }
        return newMap;
      });

      // Clear input after successful scan
      setBarcodeInput('');
    } else {
      // Barcode not found in loaded defective products
      setBarcodeScanError(`Barcode "${trimmedBarcode}" not found. Make sure the product is marked as defective.`);
      setTimeout(() => setBarcodeScanError(null), 3000);
    }
  };

  // Handle barcode input from physical scanner (machine gun input)
  const handleBarcodeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      // CRITICAL: Get value directly from DOM element, not from state
      // Physical scanners type faster than React state updates
      const inputElement = e.currentTarget as HTMLInputElement;
      const barcodeToScan = (inputElement.value || '').trim();

      if (!barcodeToScan) {
        return;
      }

      // Process the barcode scan
      handleBarcodeScan(barcodeToScan);

      // Clear input after processing
      inputElement.value = '';
      setBarcodeInput('');
    }
  };

  // Handle barcode input changes (for camera scanner)
  const handleBarcodeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBarcodeInput(e.target.value);
  };

  // Handle removing product from selection
  const handleRemoveFromSelection = (productId: number) => {
    setSelectedDefectiveProducts(prev => {
      const newSet = new Set(prev);
      newSet.delete(productId);
      return newSet;
    });
    setSelectedDefectiveProductsData(prev => {
      const newMap = new Map(prev);
      newMap.delete(productId);
      return newMap;
    });
  };

  const handleDeselectAllDefective = () => {
    setSelectedDefectiveProducts(new Set());
    setSelectedDefectiveProductsData(new Map());
  };

  // Move out defective products - create move-out record with invoice
  const moveOutDefectiveMutation = useMutation({
    mutationFn: async (data: { productIds: number[]; reason: string; notes: string }) => {
      // Get first store for move-out
      const store = stores.length > 0 ? stores[0] : null;
      if (!store) {
        throw new Error('No store available. Please create a store first.');
      }

      // Call the new API endpoint
      const response = await catalogApi.defectiveProducts.moveOut({
        store: store.id,
        product_ids: data.productIds,
        reason: data.reason,
        notes: data.notes,
      });

      return response.data;
    },
    onSuccess: (moveOut) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedDefectiveProducts(new Set());
      setSelectedDefectiveProductsData(new Map());
      setShowMoveOutModal(false);
      setMoveOutData({ reason: 'defective', notes: '' });
      alert(`Move-out created successfully! Move-out: ${moveOut.move_out_number}\nInvoice: ${moveOut.invoice_number || 'N/A'}`);
      // Navigate to invoice detail if invoice exists
      if (moveOut.invoice) {
        navigate(`/invoices/${moveOut.invoice}`);
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to create move-out';
      alert(errorMsg);
    },
  });

  const handleMoveOutDefective = () => {
    if (selectedDefectiveProducts.size === 0) {
      alert('Please select at least one defective product to move out.');
      return;
    }

    setShowMoveOutModal(true);
  };

  const handleMoveOutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    moveOutDefectiveMutation.mutate({
      productIds: Array.from(selectedDefectiveProducts),
      reason: moveOutData.reason,
      notes: moveOutData.notes,
    });
  };

  const toggleProductExpand = (productId: number) => {
    setExpandedProducts(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

  // Helper function to get table headers based on tag
  const getTableHeaders = (tag: string): string[] => {
    switch (tag) {
      case 'new':
        return ['Name', 'SKU', 'Brand', 'Category', 'Total Stock', 'Status', 'Actions'];
      case 'sold':
        return ['Name', 'SKU', 'Brand', 'Category', 'Quantity Sold', 'Status', 'Actions'];
      case 'unknown':
        return ['Name', 'SKU', 'Brand', 'Category', 'Quantity', 'Status', 'Actions'];
      case 'returned':
        return ['Name', 'SKU', 'Brand', 'Category', 'Quantity', 'Status', 'Actions'];
      case 'defective':
        return ['Name', 'SKU', 'Brand', 'Category', 'Quantity', 'Status', 'Actions'];
      case 'in-cart':
        return ['Name', 'SKU', 'Brand', 'Category', 'Quantity', 'Status', 'Actions'];
      default:
        return ['Name', 'SKU', 'Brand', 'Category', 'Total Stock', 'Status', 'Actions'];
    }
  };



  // Print labels for a product (using cached labels - NEVER generate new ones)
  const handlePrintLabels = async (product: any) => {
    try {
      // Always fetch stored labels from database - never generate new ones
      const response = await productsApi.getLabels(product.id);
      if (response.data && response.data.labels && response.data.labels.length > 0) {
        // Filter out labels without images
        const labelsWithImages = response.data.labels.filter((label: any) => label.image);
        if (labelsWithImages.length > 0) {
          printLabelsFromResponse({ labels: labelsWithImages });
        } else {
          alert('No labels with images found. Please generate labels first using "Generate Labels" button.');
        }
      } else {
        alert('No labels found. Please generate labels first using "Generate Labels" button.');
      }
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.message || 'Failed to fetch labels';
      alert(`Failed to print labels: ${errorMsg}. Please ensure labels are generated first.`);
    }
  };

  // Generate labels for a product
  const handleGenerateLabels = async (product: any) => {
    setGeneratingLabelsFor(product.id);
    setLabelStatuses(prev => ({
      ...prev,
      [product.id]: { all_generated: false, generating: true }
    }));
    generateLabelsMutation.mutate(product.id);
  };


  const handlePrintSingleLabel = async (barcode: any, productName: string, product?: any) => {
    if (!barcode || !barcode.barcode) {
      alert('No barcode found for this item');
      return;
    }

    try {
      // Get the product ID from the barcode or from the product parameter
      const barcodeId = barcode.id;
      const productId = product?.id || viewingProduct?.id || barcode.product_id || barcode.product?.id;

      if (!productId) {
        alert(`Product information not available for "${productName}". Cannot fetch label.`);
        return;
      }

      if (!barcodeId) {
        alert(`Barcode ID not available for "${productName}". Cannot fetch label.`);
        return;
      }

      // Fetch stored labels for this product (same images used in bulk printing)
      const labelsResponse = await productsApi.getLabels(productId);
      if (labelsResponse.data && labelsResponse.data.labels) {
        // Find the label for this specific barcode
        const labelForBarcode = labelsResponse.data.labels.find(
          (label: any) => label.barcode_id === barcodeId
        );

        if (labelForBarcode && labelForBarcode.image) {
          // Use the stored label image (same as bulk printing - ensures consistent font size)
          printLabelsFromResponse({ labels: [{ image: labelForBarcode.image }] });
          return;
        }
      }

      // If stored label not found, show error
      alert(`Label not found for "${productName}". Please generate labels for this product first using "Generate Labels" button.`);
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.message || 'Failed to print label';
      alert(`Failed to print label for "${productName}": ${errorMsg}`);
    }
  };

  // Filter products based on active tab - use useMemo to ensure it's computed before hooks
  // Note: Search filtering is handled by the backend API with search_mode='name_only'
  // so we don't need to filter by search on the client side
  const filteredProducts = useMemo(() => {
    let filtered = productsList;

    // Apply stock status filter only for fresh (new) products
    if (tagFilter === 'new') {
      if (activeStockTab === 'low' || stockStatusFilter === 'low_stock') {
        return filtered.filter((product: any) => product.isLowStock && !product.isOutOfStock);
      } else if (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock') {
        return filtered.filter((product: any) => product.isOutOfStock);
      }
    }
    return filtered;
  }, [productsList, activeStockTab, stockStatusFilter, tagFilter]);

  // Fetch move-outs for defective metrics
  const { data: moveOutsData } = useQuery({
    queryKey: ['defective-move-outs-for-metrics'],
    queryFn: () => catalogApi.defectiveProducts.moveOuts.list(),
    enabled: tagFilter === 'defective',
    retry: false,
  });

  // Calculate defective products metrics
  const defectiveMetrics = useMemo(() => {
    if (tagFilter !== 'defective') {
      return { count: 0, totalLoss: 0, totalItems: 0 };
    }

    // Use productsList (all defective products) instead of filteredProducts for accurate metrics
    const defectiveProducts = productsList.filter((p: any) => p.barcodeCount > 0);
    let totalCount = 0;

    defectiveProducts.forEach((product: any) => {
      const barcodes = product.barcodes || [];
      const defectiveBarcodes = barcodes.filter((b: any) => b.tag === 'defective');
      totalCount += defectiveBarcodes.length;
    });

    // Calculate net loss from move-outs (total_loss - total_adjustment)
    let totalLoss = 0;
    if (moveOutsData) {
      const moveOuts = (() => {
        const response = moveOutsData.data || moveOutsData;
        if (Array.isArray(response)) return response;
        if (Array.isArray(response?.results)) return response.results;
        if (Array.isArray(response?.data)) return response.data;
        return [];
      })();

      moveOuts.forEach((moveOut: any) => {
        const loss = typeof moveOut.total_loss === 'number'
          ? moveOut.total_loss
          : parseFloat(moveOut.total_loss) || 0;
        const adjustment = typeof moveOut.total_adjustment === 'number'
          ? moveOut.total_adjustment
          : parseFloat(moveOut.total_adjustment || '0') || 0;
        totalLoss += (loss - adjustment);
      });
    }

    return {
      count: defectiveProducts.length,
      totalLoss,
      totalItems: totalCount,
    };
  }, [tagFilter, productsList, moveOutsData]);

  // Label status is now automatically fetched and cached via useQueries above
  // No need for manual checking in useEffect - React Query handles it

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600">Error loading products</p>
          <p className="text-sm text-gray-500 mt-2">Please try again later</p>
        </div>
      </div>
    );
  }

  const handleViewSKUs = (product: any) => {
    setViewingProduct(product);
    setShowViewSKUsModal(true);
  };

  const handleAdjustmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = {
      adjustment_type: adjustmentData.adjustment_type,
      product: parseInt(adjustmentData.product),
      quantity: parseInt(adjustmentData.quantity) || 0,
      reason: adjustmentData.reason,
      notes: adjustmentData.notes || '',
    };

    // Auto-select first store if available (backend will handle this)
    if (stores.length > 0) {
      submitData.store = stores[0].id;
    }

    adjustmentMutation.mutate(submitData);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <Button onClick={() => { setEditingProduct(undefined); setShowForm(true); }}>
          <Plus className="h-5 w-5 mr-2 inline" />
          Add Product
        </Button>
      </div>

      {/* Tag Tabs - Primary Navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setTagFilter('new');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${tagFilter === 'new'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            All Products
          </button>
          <button
            onClick={() => {
              setTagFilter('sold');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'sold'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Sold
          </button>
          <button
            onClick={() => {
              setTagFilter('unknown');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'unknown'
              ? 'bg-yellow-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Unknown
          </button>
          <button
            onClick={() => {
              setTagFilter('returned');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'returned'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Returned
          </button>
          <button
            onClick={() => {
              setTagFilter('defective');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'defective'
              ? 'bg-red-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Defective
          </button>
          <button
            onClick={() => {
              setTagFilter('in-cart');
              setStockStatusFilter(''); // Reset stock filter when switching tags
            }}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'in-cart'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            In Cart
          </button>
        </div>
      </div>

      {/* Defective Products Summary Cards */}
      {tagFilter === 'defective' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Defective Products</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {defectiveMetrics.count}
                </p>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <Package className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Loss</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{defectiveMetrics.totalLoss.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-lg">
                <Coins className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/defective-move-outs')}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">View Move-Outs</p>
                <p className="text-sm text-blue-600 mt-1 hover:text-blue-800">
                  View all move-out transactions →
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Barcode Input and Move Out Section for Defective Products */}
      {tagFilter === 'defective' && (
        <div className="space-y-3">
          {/* Barcode Input Field - for physical scanner (machine gun input) */}
          <Card>
            <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
              <div className="flex-1 w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Scan Barcode (or type barcode and press Enter)
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    value={barcodeInput}
                    onChange={handleBarcodeInputChange}
                    onKeyDown={handleBarcodeInputKeyDown}
                    onInput={(e) => {
                      // Handle physical barcode scanner input - always update from DOM
                      const target = e.target as HTMLInputElement;
                      const currentValue = target.value;
                      if (currentValue !== barcodeInput) {
                        setBarcodeInput(currentValue);
                      }
                    }}
                    placeholder="Scan or type barcode and press Enter..."
                    className="w-full pr-10"
                    autoFocus={false}
                  />
                  <Barcode className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                </div>
                {barcodeScanError && (
                  <p className="mt-1 text-sm text-red-600">{barcodeScanError}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Use a physical barcode scanner or camera scanner below. Products will be auto-selected when barcode matches.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  onClick={() => setShowBarcodeScanner(true)}
                  className="flex items-center gap-2"
                >
                  <Barcode className="h-4 w-4" />
                  Camera Scanner
                </Button>
              </div>
            </div>
          </Card>

          {/* Selection Summary and Actions */}
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-4">
              {selectedDefectiveProducts.size > 0 ? (
                <>
                  <span className="text-sm font-medium text-gray-700">
                    {selectedDefectiveProducts.size} product(s) selected
                  </span>
                  <button
                    onClick={handleDeselectAllDefective}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Clear selection
                  </button>
                </>
              ) : (
                <span className="text-sm text-gray-600">No products selected yet</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate('/defective-move-outs')}
                className="flex items-center gap-2"
              >
                <Eye className="h-4 w-4" />
                View All Move-Outs
              </Button>
              {selectedDefectiveProducts.size > 0 && (
                <Button
                  onClick={handleMoveOutDefective}
                  disabled={moveOutDefectiveMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  {moveOutDefectiveMutation.isPending ? 'Creating Invoice...' : 'Move Out'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mark All In-Cart as Fresh Button */}
      {tagFilter === 'in-cart' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RotateCcw className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-900">Mark All In-Cart Items as Fresh</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  This will mark all in-cart barcodes as fresh and add them back to inventory. Changes will be logged in activities.
                </p>
              </div>
            </div>
            <Button
              onClick={handleMarkAllInCartAsFresh}
              disabled={markAsFreshMutation.isPending}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <RotateCcw className="h-4 w-4" />
              {markAsFreshMutation.isPending ? 'Marking...' : 'Mark All as Fresh'}
            </Button>
          </div>
        </div>
      )}

      {/* Stock Status Tabs - Only for Fresh (new) Products */}
      {tagFilter === 'new' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setActiveStockTab('stock');
                setStockStatusFilter('');
              }}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center ${activeStockTab === 'stock' && !stockStatusFilter
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              All Stock
            </button>
            <button
              onClick={() => {
                setActiveStockTab('low');
                setStockStatusFilter('low_stock');
              }}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center ${activeStockTab === 'low' || stockStatusFilter === 'low_stock'
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Low Stock
            </button>
            <button
              onClick={() => {
                setActiveStockTab('out');
                setStockStatusFilter('out_of_stock');
              }}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center ${activeStockTab === 'out' || stockStatusFilter === 'out_of_stock'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <TrendingDown className="h-4 w-4 mr-2" />
              Out of Stock
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <Input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Categories</option>
            {(() => {
              const categories = categoriesData?.results || categoriesData?.data || categoriesData || [];
              return Array.isArray(categories) ? categories.map((cat: any) => (
                <option key={cat.id} value={cat.id.toString()}>{cat.name}</option>
              )) : null;
            })()}
          </Select>
          <Select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Brands</option>
            {(() => {
              const brands = brandsData?.results || brandsData?.data || brandsData || [];
              return Array.isArray(brands) ? brands.map((brand: any) => (
                <option key={brand.id} value={brand.id.toString()}>{brand.name}</option>
              )) : null;
            })()}
          </Select>
          <Select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Suppliers</option>
            {(() => {
              const suppliers = suppliersData?.results || suppliersData?.data || suppliersData || [];
              return Array.isArray(suppliers) ? suppliers.map((supplier: any) => (
                <option key={supplier.id} value={supplier.id.toString()}>{supplier.name}</option>
              )) : null;
            })()}
          </Select>
        </div>
      </Card>

      {/* Desktop Table View */}
      <div className="hidden md:block">
        {tagFilter === 'defective' ? (
          <div className="flex gap-4">
            {/* Main content area */}
            <div className="flex-1">
              <Table headers={getTableHeaders(tagFilter)}>
                {filteredProducts.length > 0 ? filteredProducts.map((product: any) => {
                  // Store current tagFilter to avoid type narrowing issues - use type assertion
                  const currentTagFilter = tagFilter as 'new' | 'sold' | 'unknown' | 'returned' | 'defective' | 'in-cart';
                  // Determine status - show stock/tag status as clickable badge to change barcode tags
                  let statusBadge;
                  if (currentTagFilter === 'new') {
                    // Check if product has no barcodes (not purchased yet)
                    const hasBarcodes = product.barcodes && product.barcodes.length > 0;
                    const hasStock = (product.barcodeCount || 0) > 0;

                    if (!hasBarcodes && !hasStock) {
                      statusBadge = <Badge variant="warning">Not Purchased</Badge>;
                    } else if (product.isOutOfStock) {
                      statusBadge = <Badge variant="danger">Out of Stock</Badge>;
                    } else if (product.isLowStock) {
                      statusBadge = <Badge variant="warning">Low Stock</Badge>;
                    } else {
                      statusBadge = <Badge variant="success">In Stock</Badge>;
                    }
                  } else {
                    // For non-fresh products, show tag badge as clickable to change tag
                    const tagLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
                      'sold': { label: 'Sold', variant: 'info' },
                      'unknown': { label: 'Unknown', variant: 'warning' },
                      'returned': { label: 'Returned', variant: 'info' },
                      'defective': { label: 'Defective', variant: 'danger' },
                      'in-cart': { label: 'In Cart', variant: 'warning' },
                    };
                    const tagInfo = tagLabels[currentTagFilter] || { label: currentTagFilter, variant: 'info' as const };
                    statusBadge = (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setStatusProduct(product);
                          setNewTag(currentTagFilter); // Set current tag as default
                          setShowStatusModal(true);
                        }}
                        className="cursor-pointer hover:opacity-80 transition-opacity inline-flex items-center"
                        title="Click to change barcode tag"
                        style={{ background: 'transparent', border: 'none', padding: 0 }}
                      >
                        <Badge variant={tagInfo.variant} className="pointer-events-none">{tagInfo.label}</Badge>
                      </button>
                    );
                  }

                  // Render table cells based on tag
                  const renderTableCell = (column: string, cellKey: string) => {
                    switch (column) {
                      case 'Name':
                        return (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{product.name}</span>
                              {currentTagFilter !== 'defective' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingProduct(product.id);
                                    setShowForm(true);
                                  }}
                                  className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors"
                                  title="Edit Product"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      case 'SKU':
                        // Show barcodes instead of product SKU - limit to 2, show "view more" if more exist
                        const barcodes = product.barcodes || [];
                        const barcodeList = Array.isArray(barcodes)
                          ? barcodes.map((b: any) => b.barcode || b).filter((b: any) => b)
                          : [];

                        const maxVisible = 2;
                        const visibleBarcodes = barcodeList.slice(0, maxVisible);
                        const hasMore = barcodeList.length > maxVisible;

                        return (
                          <td key={cellKey} className="px-6 py-4 text-sm text-gray-600 font-mono">
                            <div className="max-w-md">
                              {barcodeList.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="break-words">
                                    {visibleBarcodes.join(', ')}
                                  </span>
                                  {hasMore && (
                                    <>
                                      <span className="text-gray-400">...</span>
                                      <button
                                        onClick={() => handleViewSKUs(product)}
                                        className="text-blue-600 hover:text-blue-800 underline font-normal cursor-pointer"
                                        title="View all barcodes"
                                      >
                                        view more
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span>{product.sku || '-'}</span>
                              )}
                            </div>
                          </td>
                        );
                      case 'Brand':
                        return (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {product.brand_name || '-'}
                          </td>
                        );
                      case 'Category':
                        return (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {product.category_name || '-'}
                          </td>
                        );
                      case 'Total Stock':
                        return currentTagFilter === 'new' ? (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex flex-col">
                              {/* For tracked products, show Stock model quantity (from stock_quantity) */}
                              {/* For non-tracked products, show available_quantity */}
                              <span className="font-medium">
                                {product.track_inventory !== false
                                  ? (product.stock_quantity || 0)  // Show Stock model quantity for tracked products
                                  : (product.barcodeCount || 0)    // Show barcode count for non-tracked products
                                }
                              </span>
                              {(!product.barcodes || product.barcodes.length === 0) && (product.stock_quantity || 0) === 0 && (
                                <span className="text-xs text-gray-500 mt-0.5">Not purchased</span>
                              )}
                              {/* Show barcode count as additional info for tracked products if different from stock */}
                              {/* Only show warning if stock is 0 but barcodes exist (indicating draft purchase) */}
                              {product.track_inventory !== false && product.barcodes && product.barcodes.length > 0 && (product.stock_quantity || 0) === 0 && (
                                <span className="text-xs text-amber-600 mt-0.5">
                                  ({product.barcodes.length} barcodes, purchase not finalized)
                                </span>
                              )}
                            </div>
                          </td>
                        ) : null;
                      case 'Quantity Sold':
                        return currentTagFilter === 'sold' ? (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className="font-medium">{product.barcodeCount || 0}</span>
                          </td>
                        ) : null;
                      case 'Quantity':
                        return (currentTagFilter === 'unknown' || currentTagFilter === 'returned' || currentTagFilter === 'defective' || currentTagFilter === 'in-cart') ? (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className="font-medium">{product.barcodeCount || 0}</span>
                          </td>
                        ) : null;
                      case 'Status':
                        return (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                            {statusBadge}
                          </td>
                        );
                      case 'Actions':
                        return (
                          <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm">
                            <div className="flex items-center gap-2">
                              {/* Fresh (new) products - full actions */}
                              {currentTagFilter === 'new' && (
                                <>
                                  {/* Show "Create Purchase" button for unpurchased products */}
                                  {/* Use stock_quantity (Total Stock) from backend - count of all barcodes not sold or defective */}
                                  {/* If stock_quantity === 0, product has no barcodes, show purchase button */}
                                  {(() => {
                                    const stockQty = typeof product.stock_quantity === 'number'
                                      ? product.stock_quantity
                                      : parseFloat(product.stock_quantity || '0') || 0;
                                    return stockQty === 0;
                                  })() && (
                                      <button
                                        onClick={() => {
                                          const params = new URLSearchParams();
                                          params.set('product', product.id.toString());
                                          navigate(`/purchases?${params.toString()}`);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                        title="Create Purchase for this Product"
                                      >
                                        <ShoppingCart className="h-3.5 w-3.5" />
                                        <span>Purchase</span>
                                      </button>
                                    )}
                                  <button
                                    onClick={() => handleViewSKUs(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                    title="View SKUs"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View SKUs</span>
                                  </button>
                                  {(() => {
                                    const hasBarcodes = product.barcodes && product.barcodes.length > 0;
                                    const status = labelStatuses[product.id];
                                    const isGenerating = generatingLabelsFor === product.id || (status?.generating);
                                    const allGenerated = status?.all_generated;

                                    if (!hasBarcodes) return null;

                                    if (isGenerating) {
                                      return (
                                        <button
                                          disabled
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-md cursor-not-allowed"
                                          title="Generating Labels..."
                                        >
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          <span>Generating...</span>
                                        </button>
                                      );
                                    }

                                    if (allGenerated) {
                                      return (
                                        <button
                                          onClick={() => handlePrintLabels(product)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                          title="Print Labels"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                          <span>Print Labels</span>
                                        </button>
                                      );
                                    }

                                    return (
                                      <button
                                        onClick={() => handleGenerateLabels(product)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                                        title="Generate Labels"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                        <span>Generate Labels</span>
                                      </button>
                                    );
                                  })()}
                                  {!isRetailUser && (
                                    <button
                                      onClick={() => handleDeleteProduct(product.id, product.name)}
                                      className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete Product"
                                      disabled={deleteProductMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Sold products - view only */}
                              {currentTagFilter === 'sold' && (
                                <>
                                  <button
                                    onClick={() => handleViewSKUs(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                    title="View SKUs"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View SKUs</span>
                                  </button>
                                  {!isRetailUser && (
                                    <button
                                      onClick={() => handleDeleteProduct(product.id, product.name)}
                                      className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete Product"
                                      disabled={deleteProductMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Unknown products - mark as returned/defective */}
                              {currentTagFilter === 'unknown' && (
                                <>
                                  <button
                                    onClick={() => handleViewSKUs(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                    title="View SKUs"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View SKUs</span>
                                  </button>
                                  <button
                                    onClick={() => handleMarkAsReturned(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                    title="Mark as Returned"
                                    disabled={markAsReturnedMutation.isPending}
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    <span>Mark Returned</span>
                                  </button>
                                  <button
                                    onClick={() => handleMarkAsDefective(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-all duration-200"
                                    title="Mark as Defective"
                                    disabled={markAsDefectiveMutation.isPending}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    <span>Mark Defective</span>
                                  </button>
                                  {!isRetailUser && (
                                    <button
                                      onClick={() => handleDeleteProduct(product.id, product.name)}
                                      className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete Product"
                                      disabled={deleteProductMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Returned products - mark as fresh */}
                              {currentTagFilter === 'returned' && (
                                <>
                                  <button
                                    onClick={() => handleViewSKUs(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                    title="View SKUs"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View SKUs</span>
                                  </button>
                                  <button
                                    onClick={() => handleMarkAsFresh(product, 'returned')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                                    title="Mark as Fresh (Re-add to Inventory)"
                                    disabled={markAsFreshMutation.isPending}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span>Mark Fresh</span>
                                  </button>
                                  {!isRetailUser && (
                                    <button
                                      onClick={() => handleDeleteProduct(product.id, product.name)}
                                      className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete Product"
                                      disabled={deleteProductMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Defective products - mark as fresh (no edit button) */}
                              {currentTagFilter === 'defective' && (
                                <>
                                  <button
                                    onClick={() => handleViewSKUs(product)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                    title="View SKUs"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>View SKUs</span>
                                  </button>
                                  <button
                                    onClick={() => handleMarkAsFresh(product, 'defective')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                                    title="Mark as Fresh (Re-add to Inventory)"
                                    disabled={markAsFreshMutation.isPending}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span>Mark Fresh</span>
                                  </button>
                                  {!isRetailUser && (
                                    <button
                                      onClick={() => handleDeleteProduct(product.id, product.name)}
                                      className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete Product"
                                      disabled={deleteProductMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}

                              {/* In-Cart products - no actions */}
                              {currentTagFilter === 'in-cart' && (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </div>
                          </td>
                        );
                      default:
                        return null;
                    }
                  };

                  const barcodes = product.barcodes || [];
                  const hasMultipleBarcodes = barcodes.length > 1;
                  const isExpanded = expandedProducts[product.id] || false;
                  const showExpandable = (currentTagFilter === 'unknown' || currentTagFilter === 'returned' || currentTagFilter === 'defective' || currentTagFilter === 'in-cart') && hasMultipleBarcodes;

                  return (
                    <Fragment key={product.id}>
                      <tr className="hover:bg-gray-50">
                        {getTableHeaders(currentTagFilter).map((header, idx) => {
                          const cellKey = `${product.id}-${header}-${idx}`;
                          if (idx === (currentTagFilter === 'defective' ? 1 : 0) && showExpandable) {
                            // Add expand/collapse button in first column (Name)
                            return (
                              <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => toggleProductExpand(product.id)}
                                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                                    title={isExpanded ? 'Collapse' : 'Expand'}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-gray-600" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-gray-600" />
                                    )}
                                  </button>
                                  <span className="text-sm font-medium text-gray-900">{product.name}</span>
                                </div>
                              </td>
                            );
                          }
                          return renderTableCell(header, cellKey);
                        })}
                      </tr>
                      {/* Expanded barcode rows */}
                      {showExpandable && isExpanded && barcodes.map((barcode: any) => (
                        <tr key={`${product.id}-barcode-${barcode.id}`} className="bg-gray-50 hover:bg-gray-100">
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2 pl-8">
                              <Barcode className="h-3.5 w-3.5 text-gray-400" />
                              <span className="text-xs font-mono text-gray-700">{barcode.barcode}</span>
                              {barcode.tag && (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${barcode.tag === 'unknown' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                  barcode.tag === 'returned' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                    barcode.tag === 'defective' ? 'bg-red-100 text-red-700 border-red-200' :
                                      barcode.tag === 'in-cart' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                        'bg-gray-100 text-gray-700 border-gray-200'
                                  }`}>
                                  {barcode.tag === 'in-cart' ? 'In Cart' : barcode.tag}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2">
                              {currentTagFilter === 'unknown' && (
                                <>
                                  <button
                                    onClick={() => handleMarkBarcodeAsReturned(barcode.id)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                                    title="Mark as Returned"
                                    disabled={markAsReturnedMutation.isPending}
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                    Returned
                                  </button>
                                  <button
                                    onClick={() => handleMarkBarcodeAsDefective(barcode.id)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
                                    title="Mark as Defective"
                                    disabled={markAsDefectiveMutation.isPending}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    Defective
                                  </button>
                                </>
                              )}
                              {(currentTagFilter === 'returned' || currentTagFilter === 'defective') && (
                                <button
                                  onClick={() => handleMarkBarcodeAsFresh(barcode.id, currentTagFilter)}
                                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                                  title="Mark as Fresh"
                                  disabled={markAsFreshMutation.isPending}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Fresh
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                }) : (
                  <tr>
                    <td colSpan={getTableHeaders('defective').length} className="px-6 py-8 text-center text-gray-500">
                      {productsList.length === 0
                        ? 'No products found. Add products first.'
                        : 'No defective products found.'}
                    </td>
                  </tr>
                )}
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
            {/* Summary Panel for Defective Products */}
            <div className="w-80 flex-shrink-0">
              <Card>
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Products</h3>
                  {selectedDefectiveProducts.size === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">
                      No products selected. Scan barcodes to select products.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {Array.from(selectedDefectiveProducts).map((productId) => {
                        const product = selectedDefectiveProductsData.get(productId) ||
                          filteredProducts.find((p: any) => p.id === productId);
                        if (!product) return null;
                        return (
                          <div
                            key={productId}
                            className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {product.name}
                              </p>
                              {product.sku && (
                                <p className="text-xs text-gray-500 mt-1">SKU: {product.sku}</p>
                              )}
                              {product.brand_name && (
                                <p className="text-xs text-gray-500">Brand: {product.brand_name}</p>
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveFromSelection(productId)}
                              className="ml-2 flex-shrink-0 text-gray-400 hover:text-red-600 transition-colors"
                              title="Remove from selection"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selectedDefectiveProducts.size > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Total Selected:</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {selectedDefectiveProducts.size}
                        </span>
                      </div>
                      <Button
                        onClick={handleDeselectAllDefective}
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                      >
                        Clear All
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <>
            <Table headers={getTableHeaders(tagFilter)}>
              {filteredProducts.length > 0 ? filteredProducts.map((product: any) => {
                // Use the same rendering logic as the defective section above
                // This ensures Purchase/Edit buttons show correctly for all products
                const currentTagFilter = tagFilter as 'new' | 'sold' | 'unknown' | 'returned' | 'defective' | 'in-cart';

                // Determine status badge
                let statusBadge;
                if (currentTagFilter === 'new') {
                  const hasBarcodes = product.barcodes && product.barcodes.length > 0;
                  const hasStock = (product.barcodeCount || 0) > 0;
                  if (!hasBarcodes && !hasStock) {
                    statusBadge = <Badge variant="warning">Not Purchased</Badge>;
                  } else if (product.isOutOfStock) {
                    statusBadge = <Badge variant="danger">Out of Stock</Badge>;
                  } else if (product.isLowStock) {
                    statusBadge = <Badge variant="warning">Low Stock</Badge>;
                  } else {
                    statusBadge = <Badge variant="success">In Stock</Badge>;
                  }
                } else {
                  const tagLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
                    'sold': { label: 'Sold', variant: 'info' },
                    'unknown': { label: 'Unknown', variant: 'warning' },
                    'returned': { label: 'Returned', variant: 'info' },
                    'defective': { label: 'Defective', variant: 'danger' },
                    'in-cart': { label: 'In Cart', variant: 'warning' },
                  };
                  const tagInfo = tagLabels[currentTagFilter] || { label: currentTagFilter, variant: 'info' as const };
                  statusBadge = <Badge variant={tagInfo.variant}>{tagInfo.label}</Badge>;
                }

                // Render table cells
                const renderTableCell = (column: string, cellKey: string) => {
                  switch (column) {
                    case 'Name':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{product.name}</span>
                            {currentTagFilter !== 'defective' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProduct(product.id);
                                  setShowForm(true);
                                }}
                                className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors"
                                title="Edit Product"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    case 'SKU':
                      const barcodes = product.barcodes || [];
                      const barcodeList = Array.isArray(barcodes)
                        ? barcodes.map((b: any) => b.barcode || b).filter((b: any) => b)
                        : [];
                      const maxVisible = 2;
                      const visibleBarcodes = barcodeList.slice(0, maxVisible);
                      const hasMore = barcodeList.length > maxVisible;
                      return (
                        <td key={cellKey} className="px-6 py-4 text-sm text-gray-600 font-mono">
                          <div className="max-w-md">
                            {barcodeList.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="break-words">{visibleBarcodes.join(', ')}</span>
                                {hasMore && (
                                  <>
                                    <span className="text-gray-400">...</span>
                                    <button
                                      onClick={() => handleViewSKUs(product)}
                                      className="text-blue-600 hover:text-blue-800 underline font-normal cursor-pointer"
                                      title="View all barcodes"
                                    >
                                      view more
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : (
                              <span>{product.sku || '-'}</span>
                            )}
                          </div>
                        </td>
                      );
                    case 'Brand':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {product.brand_name || '-'}
                        </td>
                      );
                    case 'Category':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {product.category_name || '-'}
                        </td>
                      );
                    case 'Total Stock':
                      return currentTagFilter === 'new' ? (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className="font-medium">
                            {product.track_inventory !== false
                              ? (product.stock_quantity || 0)
                              : (product.barcodeCount || 0)
                            }
                          </span>
                        </td>
                      ) : null;
                    case 'Quantity Sold':
                      return currentTagFilter === 'sold' ? (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className="font-medium">{product.barcodeCount || 0}</span>
                        </td>
                      ) : null;
                    case 'Quantity':
                      return (currentTagFilter === 'unknown' || currentTagFilter === 'returned' || currentTagFilter === 'defective' || currentTagFilter === 'in-cart') ? (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className="font-medium">{product.barcodeCount || 0}</span>
                        </td>
                      ) : null;
                    case 'Status':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                          {statusBadge}
                        </td>
                      );
                    case 'Actions':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex items-center gap-2">
                            {currentTagFilter === 'new' && (
                              <>
                                {/* Show Purchase button when stock_quantity === 0 */}
                                {(() => {
                                  const stockQty = typeof product.stock_quantity === 'number'
                                    ? product.stock_quantity
                                    : parseFloat(product.stock_quantity || '0') || 0;
                                  return stockQty === 0;
                                })() && (
                                    <button
                                      onClick={() => {
                                        const params = new URLSearchParams();
                                        params.set('product', product.id.toString());
                                        navigate(`/purchases?${params.toString()}`);
                                      }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                      title="Create Purchase for this Product"
                                    >
                                      <ShoppingCart className="h-3.5 w-3.5" />
                                      <span>Purchase</span>
                                    </button>
                                  )}
                                <button
                                  onClick={() => handleViewSKUs(product)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                  title="View SKUs"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>View SKUs</span>
                                </button>
                                {(() => {
                                  const hasBarcodes = product.barcodes && product.barcodes.length > 0;
                                  const status = labelStatuses[product.id];
                                  const isGenerating = generatingLabelsFor === product.id || (status?.generating);
                                  const allGenerated = status?.all_generated;
                                  if (!hasBarcodes) return null;
                                  if (isGenerating) {
                                    return (
                                      <button
                                        disabled
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-md cursor-not-allowed"
                                        title="Generating Labels..."
                                      >
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>Generating...</span>
                                      </button>
                                    );
                                  }
                                  if (allGenerated) {
                                    return (
                                      <button
                                        onClick={() => handlePrintLabels(product)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                        title="Print Labels"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                        <span>Print Labels</span>
                                      </button>
                                    );
                                  }
                                  return (
                                    <button
                                      onClick={() => handleGenerateLabels(product)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                                      title="Generate Labels"
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                      <span>Generate Labels</span>
                                    </button>
                                  );
                                })()}
                                {!isRetailUser && (
                                  <button
                                    onClick={() => handleDeleteProduct(product.id, product.name)}
                                    className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Delete Product"
                                    disabled={deleteProductMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            )}
                            {currentTagFilter === 'sold' && (
                              <>
                                <button
                                  onClick={() => handleViewSKUs(product)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                  title="View SKUs"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>View SKUs</span>
                                </button>
                                {!isRetailUser && (
                                  <button
                                    onClick={() => handleDeleteProduct(product.id, product.name)}
                                    className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Delete Product"
                                    disabled={deleteProductMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            )}
                            {(currentTagFilter === 'unknown' || currentTagFilter === 'returned' || currentTagFilter === 'defective' || currentTagFilter === 'in-cart') && (
                              <button
                                onClick={() => handleViewSKUs(product)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                title="View SKUs"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>View SKUs</span>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    default:
                      return null;
                  }
                };

                return (
                  <tr key={product.id} className="hover:bg-gray-50">
                    {getTableHeaders(currentTagFilter).map((header, idx) => {
                      const cellKey = `${product.id}-${header}-${idx}`;
                      return renderTableCell(header, cellKey);
                    })}
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={getTableHeaders(tagFilter).length} className="px-6 py-8 text-center text-gray-500">
                    {productsList.length === 0
                      ? 'No products found. Add products first.'
                      : tagFilter === 'new' && (activeStockTab === 'low' || stockStatusFilter === 'low_stock')
                        ? 'No products match the "Low Stock" filter.'
                        : tagFilter === 'new' && (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock')
                          ? 'No products match the "Out of Stock" filter.'
                          : `No products found with tag "${tagFilter === 'new' ? 'Fresh (New)' : tagFilter === 'sold' ? 'Sold' : tagFilter === 'unknown' ? 'Unknown' : tagFilter === 'returned' ? 'Returned' : tagFilter === 'defective' ? 'Defective' : tagFilter === 'in-cart' ? 'In Cart' : tagFilter}"`}
                  </td>
                </tr>
              )}
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
          </>
        )}
      </div>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {/* Barcode Input for Defective Products - Mobile */}
        {tagFilter === 'defective' && (
          <div className="mb-4 space-y-3">
            <Card>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Scan Barcode
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    value={barcodeInput}
                    onChange={handleBarcodeInputChange}
                    onKeyDown={handleBarcodeInputKeyDown}
                    onInput={(e) => {
                      // Handle physical barcode scanner input - always update from DOM
                      const target = e.target as HTMLInputElement;
                      const currentValue = target.value;
                      if (currentValue !== barcodeInput) {
                        setBarcodeInput(currentValue);
                      }
                    }}
                    placeholder="Scan barcode and press Enter..."
                    className="w-full pr-10"
                  />
                  <Barcode className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                </div>
                {barcodeScanError && (
                  <p className="text-xs text-red-600">{barcodeScanError}</p>
                )}
              </div>
            </Card>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => setShowBarcodeScanner(true)}
                size="sm"
                className="flex items-center gap-2"
              >
                <Barcode className="h-4 w-4" />
                Camera
              </Button>
              {selectedDefectiveProducts.size > 0 && (
                <>
                  <span className="text-sm text-gray-600">
                    {selectedDefectiveProducts.size} selected
                  </span>
                  <Button
                    onClick={handleMoveOutDefective}
                    disabled={moveOutDefectiveMutation.isPending}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    Move Out
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {filteredProducts.length > 0 ? filteredProducts.map((product: any) => {
          // Determine status - only show stock status for fresh (new) products
          // Determine status - show stock/tag status as clickable badge to change barcode tags (mobile view)
          let statusBadge;
          if (tagFilter === 'new') {
            // Check if product has no barcodes (not purchased yet)
            const hasBarcodes = product.barcodes && product.barcodes.length > 0;
            const hasStock = (product.barcodeCount || 0) > 0;

            if (!hasBarcodes && !hasStock) {
              statusBadge = <Badge variant="warning">Not Purchased</Badge>;
            } else if (product.isOutOfStock) {
              statusBadge = <Badge variant="danger">Out of Stock</Badge>;
            } else if (product.isLowStock) {
              statusBadge = <Badge variant="warning">Low Stock</Badge>;
            } else {
              statusBadge = <Badge variant="success">In Stock</Badge>;
            }
          } else {
            // For non-fresh products, show tag badge as clickable to change tag
            const tagLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
              'sold': { label: 'Sold', variant: 'info' },
              'unknown': { label: 'Unknown', variant: 'warning' },
              'returned': { label: 'Returned', variant: 'info' },
              'defective': { label: 'Defective', variant: 'danger' },
              'in-cart': { label: 'In Cart', variant: 'warning' },
            };
            const tagInfo = tagLabels[tagFilter] || { label: tagFilter, variant: 'info' as const };
            statusBadge = (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusProduct(product);
                  setNewTag(tagFilter); // Set current tag as default
                  setShowStatusModal(true);
                }}
                className="cursor-pointer hover:opacity-80 transition-opacity"
                title="Click to change barcode tag"
              >
                <Badge variant={tagInfo.variant}>{tagInfo.label}</Badge>
              </button>
            );
          }

          const hasBarcodes = product.barcodes && product.barcodes.length > 0;
          const status = labelStatuses[product.id];
          const isGenerating = generatingLabelsFor === product.id || (status?.generating);
          const allGenerated = status?.all_generated;

          return (
            <div key={product.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
              <div className="px-4 py-3">
                {/* Row 1: Product name, status, and stock */}
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Package className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900 text-base break-words leading-tight">{product.name}</h4>
                        {tagFilter !== 'defective' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProduct(product.id);
                              setShowForm(true);
                            }}
                            className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0"
                            title="Edit Product"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {tagFilter === 'new' && (!product.barcodes || product.barcodes.length === 0) && (product.barcodeCount || 0) === 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">Not purchased yet</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {statusBadge}
                    <div className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                      {tagFilter === 'new'
                        ? `Stock: ${product.track_inventory !== false ? (product.stock_quantity || 0) : (product.barcodeCount || 0)}`
                        : `Qty: ${product.barcodeCount || 0}`
                      }
                    </div>
                  </div>
                </div>

                {/* Row 2: Action buttons */}
                <div className="flex items-center gap-2">
                  {/* Fresh (new) products - full actions */}
                  {tagFilter === 'new' && (
                    <>
                      {/* Show "Purchase" button for unpurchased products on mobile */}
                      {/* Use stock_quantity (Total Stock) from backend - count of all barcodes not sold or defective */}
                      {/* If stock_quantity === 0, product has no barcodes, show purchase button */}
                      {(() => {
                        const stockQty = typeof product.stock_quantity === 'number'
                          ? product.stock_quantity
                          : parseFloat(product.stock_quantity || '0') || 0;
                        return stockQty === 0;
                      })() && (
                          <button
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set('product', product.id.toString());
                              navigate(`/purchases?${params.toString()}`);
                            }}
                            className="flex items-center justify-center w-7 h-7 text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                            title="Create Purchase"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" />
                          </button>
                        )}
                      <button
                        onClick={() => handleViewSKUs(product)}
                        className="flex items-center justify-center w-7 h-7 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                        title="View SKUs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {hasBarcodes && (
                        <>
                          {isGenerating ? (
                            <button
                              disabled
                              className="flex items-center justify-center w-7 h-7 text-gray-500 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
                              title="Generating..."
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            </button>
                          ) : allGenerated ? (
                            <button
                              onClick={() => handlePrintLabels(product)}
                              className="flex items-center justify-center w-7 h-7 text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                              title="Print Labels"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleGenerateLabels(product)}
                              className="flex items-center justify-center w-7 h-7 text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                              title="Generate Labels"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      {!isRetailUser && (
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={deleteProductMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  {/* Sold products - view only */}
                  {tagFilter === 'sold' && (
                    <>
                      <button
                        onClick={() => handleViewSKUs(product)}
                        className="flex items-center justify-center w-7 h-7 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                        title="View SKUs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {!isRetailUser && (
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={deleteProductMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  {/* Unknown products - mark as returned/defective */}
                  {tagFilter === 'unknown' && (
                    <>
                      <button
                        onClick={() => handleViewSKUs(product)}
                        className="flex items-center justify-center w-7 h-7 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                        title="View SKUs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMarkAsReturned(product)}
                        className="flex items-center justify-center w-7 h-7 text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={markAsReturnedMutation.isPending}
                        title="Mark as Returned"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMarkAsDefective(product)}
                        className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={markAsDefectiveMutation.isPending}
                        title="Mark as Defective"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                      {!isRetailUser && (
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={deleteProductMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  {/* Returned products - mark as fresh */}
                  {tagFilter === 'returned' && (
                    <>
                      <button
                        onClick={() => handleViewSKUs(product)}
                        className="flex items-center justify-center w-7 h-7 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                        title="View SKUs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMarkAsFresh(product, 'returned')}
                        className="flex items-center justify-center w-7 h-7 text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={markAsFreshMutation.isPending}
                        title="Mark as Fresh"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      {!isRetailUser && (
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={deleteProductMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  {/* Defective products - mark as fresh (no edit button) */}
                  {tagFilter === 'defective' && (
                    <>
                      <button
                        onClick={() => handleViewSKUs(product)}
                        className="flex items-center justify-center w-7 h-7 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                        title="View SKUs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMarkAsFresh(product, 'defective')}
                        className="flex items-center justify-center w-7 h-7 text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={markAsFreshMutation.isPending}
                        title="Mark as Fresh"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      {!isRetailUser && (
                        <button
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                          className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={deleteProductMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  {/* In-Cart products - no actions */}
                  {tagFilter === 'in-cart' && (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            {productsList.length === 0
              ? 'No products found. Add products first.'
              : tagFilter === 'new' && (activeStockTab === 'low' || stockStatusFilter === 'low_stock')
                ? 'No products match the "Low Stock" filter.'
                : tagFilter === 'new' && (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock')
                  ? 'No products match the "Out of Stock" filter.'
                  : `No products found with tag "${tagFilter === 'new' ? 'Fresh (New)' : tagFilter === 'sold' ? 'Sold' : tagFilter === 'unknown' ? 'Unknown' : tagFilter === 'returned' ? 'Returned' : tagFilter === 'defective' ? 'Defective' : tagFilter === 'in-cart' ? 'In Cart' : tagFilter}"`}
          </div>
        )}
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

      {showForm && (
        <ProductForm
          productId={editingProduct}
          onClose={() => { setShowForm(false); setEditingProduct(undefined); }}
        />
      )}

      {showAdjustmentForm && adjustingProduct && (
        <Modal
          isOpen={showAdjustmentForm}
          onClose={() => { setShowAdjustmentForm(false); setAdjustingProduct(undefined); }}
          title={`Edit Stock - ${allProducts.find((p: any) => p.id === adjustingProduct)?.name || 'Product'}`}
        >
          <form onSubmit={handleAdjustmentSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
              <select
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={adjustmentData.adjustment_type}
                onChange={(e) => setAdjustmentData({ ...adjustmentData, adjustment_type: e.target.value })}
                required
              >
                <option value="in">Add Stock</option>
                <option value="out">Remove Stock</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
              <div className="block w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700">
                {adjustingProduct ? allProducts.find((p: any) => p.id === adjustingProduct)?.name || 'Unknown' : 'Select product'}
              </div>
            </div>
            <Input
              label="Quantity"
              type="number"
              step="1"
              min="1"
              value={adjustmentData.quantity}
              onChange={(e) => {
                // Only allow positive integers
                const val = e.target.value;
                if (val === '' || /^\d+$/.test(val)) {
                  setAdjustmentData({ ...adjustmentData, quantity: val });
                }
              }}
              onBlur={(e) => {
                // Ensure value is a positive integer on blur
                const val = Math.max(1, parseInt(e.target.value) || 1);
                setAdjustmentData({ ...adjustmentData, quantity: val.toString() });
              }}
              required
              placeholder="Enter quantity to add or remove"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <select
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={adjustmentData.reason}
                onChange={(e) => setAdjustmentData({ ...adjustmentData, reason: e.target.value })}
                required
              >
                <option value="correction">Correction</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
                <option value="found">Found</option>
                <option value="theft">Theft</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
              <textarea
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={2}
                value={adjustmentData.notes}
                onChange={(e) => setAdjustmentData({ ...adjustmentData, notes: e.target.value })}
                placeholder="Add any additional notes..."
              />
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowAdjustmentForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={adjustmentMutation.isPending}>
                {adjustmentMutation.isPending ? 'Saving...' : 'Save Adjustment'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showViewSKUsModal && viewingProduct && (
        <ViewSKUsModal
          product={viewingProduct}
          tagFilter={tagFilter}
          onClose={() => {
            setShowViewSKUsModal(false);
            setViewingProduct(null);
          }}
          onPrintLabel={handlePrintSingleLabel}
          onPrintAllLabels={(product: any) => handlePrintLabels(product)}
          onMarkAsReturned={handleMarkAsReturned}
          onMarkAsDefective={handleMarkAsDefective}
          onMarkAsFresh={handleMarkAsFresh}
        />
      )}

      {/* Barcode Scanner Modal for Defective Products */}
      {tagFilter === 'defective' && (
        <Modal
          isOpen={showBarcodeScanner}
          onClose={() => {
            setShowBarcodeScanner(false);
            setBarcodeScanError(null);
          }}
          title="Scan Barcode to Select Product"
          size="md"
        >
          <div className="space-y-4">
            <BarcodeScanner
              isOpen={showBarcodeScanner}
              onScan={handleBarcodeScan}
              onClose={() => {
                setShowBarcodeScanner(false);
                setBarcodeScanError(null);
              }}
              continuous={true}
            />
            {barcodeScanError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{barcodeScanError}</p>
              </div>
            )}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-700">
                <strong>Tip:</strong> You can also use the barcode input field above for faster scanning with physical scanners.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* Barcode Tag Change Modal */}
      <Modal
        isOpen={showStatusModal}
        onClose={() => {
          setShowStatusModal(false);
          setStatusProduct(null);
          setNewTag('');
        }}
        title="Change Barcode Tag"
        size="md"
      >
        {statusProduct && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm">
                {statusProduct.name} {statusProduct.sku ? `(${statusProduct.sku})` : ''}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Tag</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg">
                <Badge variant={
                  tagFilter === 'sold' ? 'info' :
                    tagFilter === 'returned' ? 'info' :
                      tagFilter === 'defective' ? 'danger' :
                        tagFilter === 'unknown' ? 'warning' :
                          tagFilter === 'in-cart' ? 'warning' :
                            'success'
                }>
                  {tagFilter === 'sold' ? 'Sold' :
                    tagFilter === 'returned' ? 'Returned' :
                      tagFilter === 'defective' ? 'Defective' :
                        tagFilter === 'unknown' ? 'Unknown' :
                          tagFilter === 'in-cart' ? 'In Cart' :
                            'Fresh (New)'}
                </Badge>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Tag</label>
              <Select
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              >
                <option value="">Select new tag</option>
                {tagFilter === 'unknown' && (
                  <>
                    <option value="returned">Returned</option>
                    <option value="defective">Defective</option>
                  </>
                )}
                {(tagFilter === 'returned' || tagFilter === 'defective') && (
                  <option value="new">Fresh (New)</option>
                )}
                {tagFilter === 'in-cart' && (
                  <option value="new">Fresh (New)</option>
                )}
                {tagFilter === 'sold' && (
                  <option value="unknown">Unknown</option>
                )}
              </Select>
            </div>
            {newTag && (
              <div className="text-sm text-gray-600">
                This will update all barcodes for this product that are currently tagged as "{tagFilter}" to "{newTag}".
                The change will be logged in activities.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowStatusModal(false);
                  setStatusProduct(null);
                  setNewTag('');
                }}
                disabled={updateBarcodeTagMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (statusProduct && newTag) {
                    // Get all barcodes for this product with the current tag
                    const barcodes = statusProduct.barcodes || [];
                    const barcodeIds = barcodes
                      .filter((b: any) => b.tag === tagFilter)
                      .map((b: any) => b.id)
                      .filter((id: any) => id);

                    if (barcodeIds.length === 0) {
                      alert(`No barcodes found for this product with tag "${tagFilter}"`);
                      return;
                    }

                    updateBarcodeTagMutation.mutate({
                      barcodeIds,
                      newTag,
                    });
                  }
                }}
                disabled={updateBarcodeTagMutation.isPending || !newTag}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {updateBarcodeTagMutation.isPending ? 'Updating...' : 'Update Tag'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Move Out Modal for Defective Products */}
      {showMoveOutModal && (
        <Modal
          isOpen={showMoveOutModal}
          onClose={() => {
            setShowMoveOutModal(false);
            setMoveOutData({ reason: 'defective', notes: '' });
          }}
          title="Move Out Defective Products"
          size="md"
        >
          <form onSubmit={handleMoveOutSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selected Products
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm">
                {selectedDefectiveProducts.size} product(s) selected
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <Select
                value={moveOutData.reason}
                onChange={(e) => setMoveOutData({ ...moveOutData, reason: e.target.value })}
                required
              >
                <option value="defective">Defective</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
                <option value="return_to_supplier">Return to Supplier</option>
                <option value="disposal">Disposal</option>
                <option value="other">Other</option>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (Optional)
              </label>
              <textarea
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={4}
                value={moveOutData.notes}
                onChange={(e) => setMoveOutData({ ...moveOutData, notes: e.target.value })}
                placeholder="Add any additional notes about this move-out..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowMoveOutModal(false);
                  setMoveOutData({ reason: 'defective', notes: '' });
                }}
                disabled={moveOutDefectiveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={moveOutDefectiveMutation.isPending}
              >
                {moveOutDefectiveMutation.isPending ? 'Creating...' : 'Create Move-Out'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// View SKUs Modal Component
function ViewSKUsModal({ product, tagFilter, onClose, onPrintLabel, onPrintAllLabels, onMarkAsReturned, onMarkAsDefective, onMarkAsFresh }: any) {
  const [selectedBarcodeForTagChange, setSelectedBarcodeForTagChange] = useState<any>(null);
  const [newTag, setNewTag] = useState<string>('');
  const [showTagChangeModal, setShowTagChangeModal] = useState(false);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const queryClient = useQueryClient();

  const { data: barcodesData, isLoading } = useQuery({
    queryKey: ['product-barcodes', product.id, tagFilter],
    queryFn: () => productsApi.barcodes(product.id, { tag: tagFilter }),
    enabled: !!product.id,
  });

  const barcodes = (() => {
    if (!barcodesData) return [];
    const response = barcodesData.data || barcodesData;
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.results)) return response.results;
    return [];
  })();

  // Update tag mutation
  const updateTagMutation = useMutation({
    mutationFn: async ({ barcodeId, tag, confirmed }: { barcodeId: number; tag: string; confirmed?: boolean }) => {
      return await catalogApi.barcodes.updateTag(barcodeId, { tag, confirmed: confirmed || false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-barcodes', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowTagChangeModal(false);
      setSelectedBarcodeForTagChange(null);
      setNewTag('');
      setRequiresConfirmation(false);
    },
    onError: (error: any) => {
      if (error?.response?.data?.requires_confirmation) {
        setRequiresConfirmation(true);
      } else {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to update tag';
        alert(errorMsg);
      }
    },
  });

  const handleTagChangeClick = (barcode: any) => {
    setSelectedBarcodeForTagChange(barcode);
    setNewTag('');
    setRequiresConfirmation(false);
    setShowTagChangeModal(true);
  };

  const handleTagChangeSubmit = () => {
    if (!selectedBarcodeForTagChange || !newTag) return;

    // Check if confirmation is needed (returned/defective -> new)
    const oldTag = selectedBarcodeForTagChange.tag;
    const needsConfirmation = (oldTag === 'returned' || oldTag === 'defective') && newTag === 'new';

    updateTagMutation.mutate({
      barcodeId: selectedBarcodeForTagChange.id,
      tag: newTag,
      confirmed: needsConfirmation && requiresConfirmation,
    });
  };

  const getTagBadgeColor = (tag: string) => {
    switch (tag) {
      case 'new': return 'bg-green-100 text-green-700 border-green-200';
      case 'sold': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'returned': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'defective': return 'bg-red-100 text-red-700 border-red-200';
      case 'unknown': return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'in-cart': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getTagDisplayName = (tag: string) => {
    switch (tag) {
      case 'new': return 'Fresh';
      case 'sold': return 'Sold';
      case 'returned': return 'Returned';
      case 'defective': return 'Defective';
      case 'unknown': return 'Unknown';
      case 'in-cart': return 'In Cart';
      default: return tag;
    }
  };

  const getAvailableTags = (currentTag: string) => {
    // Only allow transitions: unknown -> returned/defective, returned/defective -> new
    if (currentTag === 'unknown') {
      return ['returned', 'defective'];
    }
    if (currentTag === 'returned' || currentTag === 'defective') {
      return ['new'];
    }
    return []; // No transitions allowed for other tags
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`SKUs for ${product.name}`} size="lg">
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading SKUs...</div>
        ) : barcodes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No SKUs found for this product.</div>
        ) : (
          <>
            {/* Show Print All Labels only for fresh products */}
            {tagFilter === 'new' && (
              <div className="flex justify-end mb-4">
                <Button
                  onClick={() => onPrintAllLabels(product)}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Print All Labels
                </Button>
              </div>
            )}

            {/* Quick actions for unknown products */}
            {tagFilter === 'unknown' && barcodes.length > 0 && (
              <div className="flex gap-2 mb-4">
                <Button
                  onClick={() => {
                    onMarkAsReturned(product);
                    onClose();
                  }}
                  variant="outline"
                  className="flex items-center gap-2 text-green-700 border-green-300 hover:bg-green-50"
                >
                  <CheckCircle className="h-4 w-4" />
                  Mark All as Returned
                </Button>
                <Button
                  onClick={() => {
                    onMarkAsDefective(product);
                    onClose();
                  }}
                  variant="outline"
                  className="flex items-center gap-2 text-red-700 border-red-300 hover:bg-red-50"
                >
                  <XCircle className="h-4 w-4" />
                  Mark All as Defective
                </Button>
              </div>
            )}

            {/* Quick action for returned/defective products */}
            {(tagFilter === 'returned' || tagFilter === 'defective') && barcodes.length > 0 && (
              <div className="flex justify-end mb-4">
                <Button
                  onClick={() => {
                    onMarkAsFresh(product, tagFilter);
                    onClose();
                  }}
                  variant="outline"
                  className="flex items-center gap-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Mark All as Fresh
                </Button>
              </div>
            )}
            <div className="max-h-96 overflow-y-auto space-y-2">
              {barcodes.map((barcode: any) => {
                const availableTags = getAvailableTags(barcode.tag || 'new');
                const canChangeTag = availableTags.length > 0;

                return (
                  <div
                    key={barcode.id || barcode.barcode}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <Barcode className="h-5 w-5 text-gray-400" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">SKU</div>
                        <div className="text-sm text-gray-700 font-mono">{barcode.barcode}</div>
                        {barcode.tag && (
                          <div className="mt-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getTagBadgeColor(barcode.tag)}`}>
                              <Tag className="h-3 w-3 mr-1" />
                              {getTagDisplayName(barcode.tag)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canChangeTag && (
                        <button
                          onClick={() => handleTagChangeClick(barcode)}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                          title="Change Tag"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Change Tag
                        </button>
                      )}
                      {/* Show Print button only for fresh products */}
                      {tagFilter === 'new' && (
                        <button
                          onClick={() => onPrintLabel(barcode, product.name, product)}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                          title="Print Label"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-sm text-gray-500 text-center pt-2">
              Total: {barcodes.length} SKU{barcodes.length !== 1 ? 's' : ''}
            </div>
          </>
        )}
        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Tag Change Modal */}
      {showTagChangeModal && selectedBarcodeForTagChange && (
        <Modal
          isOpen={showTagChangeModal}
          onClose={() => {
            setShowTagChangeModal(false);
            setSelectedBarcodeForTagChange(null);
            setNewTag('');
            setRequiresConfirmation(false);
          }}
          title="Change Barcode Tag"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono">
                {selectedBarcodeForTagChange.barcode}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Tag</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg">
                <span className={`inline-flex items-center px-2 py-1 rounded text-sm font-medium border ${getTagBadgeColor(selectedBarcodeForTagChange.tag || 'new')}`}>
                  {getTagDisplayName(selectedBarcodeForTagChange.tag || 'new')}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Tag</label>
              <Select
                value={newTag}
                onChange={(e) => {
                  setNewTag(e.target.value);
                  setRequiresConfirmation(false);
                }}
              >
                <option value="">Select new tag</option>
                {getAvailableTags(selectedBarcodeForTagChange.tag || 'new').map((tag) => (
                  <option key={tag} value={tag}>
                    {getTagDisplayName(tag)}
                  </option>
                ))}
              </Select>
            </div>
            {requiresConfirmation && newTag === 'new' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-yellow-800 mb-1">Confirmation Required</div>
                    <div className="text-sm text-yellow-700">
                      Are you sure you want to add this product back to inventory? This will make it available for sale.
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowTagChangeModal(false);
                  setSelectedBarcodeForTagChange(null);
                  setNewTag('');
                  setRequiresConfirmation(false);
                }}
                disabled={updateTagMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleTagChangeSubmit}
                disabled={!newTag || updateTagMutation.isPending}
              >
                {updateTagMutation.isPending ? 'Updating...' : requiresConfirmation ? 'Confirm & Update' : 'Update Tag'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
