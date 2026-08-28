import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { productsApi, inventoryApi, catalogApi, purchasingApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { getStockInfo, getProductNameColor } from '../../lib/utils';
import { Plus, Edit, Barcode, AlertTriangle, TrendingDown, Package, Trash2, Printer, Eye, Loader2, Filter, Tag, RotateCcw, CheckCircle, XCircle, ShoppingCart, Coins, FileText, X, Image as ImageIcon, Download } from 'lucide-react';
import Button from '../../components/ui/Button';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import ProductForm from './ProductForm';
import ProductExportModal from './ProductExportModal';
import BarcodeScanner from '../../components/BarcodeScanner';

const PRODUCTS_FILTERS_STORAGE_KEY = 'products:filters:v2';
const PRODUCTS_LIST_STALE_MS = 30_000;
const PRODUCTS_REF_STALE_MS = 5 * 60_000;

type TabFilterState = {
  category: string;
  brand: string;
  supplier: string;
};

type PersistedProductFilters = Record<string, TabFilterState>;

const EMPTY_TAB_FILTERS: TabFilterState = {
  category: '',
  brand: '',
  supplier: '',
};

function sanitizeTabFilters(value: unknown): TabFilterState {
  if (!value || typeof value !== 'object') return { ...EMPTY_TAB_FILTERS };
  const parsed = value as Partial<TabFilterState>;
  return {
    category: typeof parsed.category === 'string' ? parsed.category : '',
    brand: typeof parsed.brand === 'string' ? parsed.brand : '',
    supplier: typeof parsed.supplier === 'string' ? parsed.supplier : '',
  };
}

function readPersistedProductFilters(): PersistedProductFilters {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PRODUCTS_FILTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([tab, filters]) => [tab, sanitizeTabFilters(filters)])
    );
  } catch {
    return {};
  }
}

function getPersistedFiltersForTab(tab: string, all?: PersistedProductFilters): TabFilterState {
  const stored = all ?? readPersistedProductFilters();
  return stored[tab] ? { ...stored[tab] } : { ...EMPTY_TAB_FILTERS };
}

function writePersistedFiltersForTab(tab: string, filters: TabFilterState): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readPersistedProductFilters();
    all[tab] = filters;
    window.localStorage.setItem(PRODUCTS_FILTERS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // quota / private mode
  }
}

export default function Products() {
  const navigate = useNavigate();
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRetailUser = userGroups.includes('Retail') && !userGroups.includes('Admin') && !userGroups.includes('RetailAdmin');
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTag = searchParams.get('tag') || 'new';
  const persistedFilters = useRef(readPersistedProductFilters()).current;
  const initialTabFilters = getPersistedFiltersForTab(initialTag, persistedFilters);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<number | undefined>();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get('category') || initialTabFilters.category
  );
  const [brandFilter, setBrandFilter] = useState(
    searchParams.get('brand') || initialTabFilters.brand
  );
  const [supplierFilter, setSupplierFilter] = useState(
    searchParams.get('supplier') || initialTabFilters.supplier
  );
  const [defectiveScopeReady, setDefectiveScopeReady] = useState(false);
  const [pendingDefectiveSupplier, setPendingDefectiveSupplier] = useState(
    (searchParams.get('tag') === 'defective' ? searchParams.get('supplier') : null)
      || getPersistedFiltersForTab('defective', persistedFilters).supplier
  );
  const [stockStatusFilter, setStockStatusFilter] = useState(searchParams.get('stock_status') || '');
  const [tagFilter, setTagFilter] = useState(initialTag); // Default to 'new' (fresh)
  const [activeStockTab, setActiveStockTab] = useState<'stock' | 'low' | 'out'>('stock');
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<number | undefined>();
  const [showViewSKUsModal, setShowViewSKUsModal] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<any>(null);
  const [productImagePreview, setProductImagePreview] = useState<{ src: string; title: string } | null>(null);
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<number, { all_generated: boolean; generating: boolean }>>({});
  // Barcode-level selection for defective move-out.
  const [selectedDefectiveProducts, setSelectedDefectiveProducts] = useState<Set<number>>(new Set());
  const [selectedDefectiveProductsData, setSelectedDefectiveProductsData] = useState<Map<number, any>>(new Map());
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeScanError, setBarcodeScanError] = useState<string | null>(null);
  const [showMoveOutModal, setShowMoveOutModal] = useState(false);
  const [moveOutData, setMoveOutData] = useState({
    reason: 'return_to_supplier',
    notes: '',
  });
  const [moveOutMode, setMoveOutMode] = useState<'new' | 'existing'>('new');
  const [selectedExistingMoveOutId, setSelectedExistingMoveOutId] = useState<number | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusProduct, setStatusProduct] = useState<any>(null);
  const [newTag, setNewTag] = useState<string>('');
  const [showBarcodeStatusTool, setShowBarcodeStatusTool] = useState(false);
  const [statusLookupInput, setStatusLookupInput] = useState('');
  const [bulkStatusInput, setBulkStatusInput] = useState('');
  const [statusUpdateTag, setStatusUpdateTag] = useState('');
  const [statusLookupError, setStatusLookupError] = useState<string | null>(null);
  const [scannedStatusRows, setScannedStatusRows] = useState<any[]>([]);
  const [adjustmentData, setAdjustmentData] = useState({
    adjustment_type: 'in',
    product: '',
    quantity: '',
    reason: 'correction',
    notes: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [loadedProducts, setLoadedProducts] = useState<any[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const queryClient = useQueryClient();

  // Fetch categories and brands for filters
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data;
    },
    retry: false,
    staleTime: PRODUCTS_REF_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data;
    },
    retry: false,
    staleTime: PRODUCTS_REF_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  // Fetch suppliers for filter
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data;
    },
    retry: false,
    staleTime: PRODUCTS_REF_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  const supplierOptions = useMemo(() => {
    const list = suppliersData?.results || suppliersData?.data || suppliersData || [];
    return Array.isArray(list) ? list : [];
  }, [suppliersData]);

  const defectiveReady = tagFilter !== 'defective' || (defectiveScopeReady && Boolean(supplierFilter));

  useEffect(() => {
    if (tagFilter !== 'defective') {
      setDefectiveScopeReady(false);
      return;
    }
    setDefectiveScopeReady(false);
    setPendingDefectiveSupplier(supplierFilter || '');
    setLoadedProducts([]);
    setSelectedDefectiveProducts(new Set());
    setSelectedDefectiveProductsData(new Map());
    // Only re-prompt when entering the Defective tab, not when the supplier value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter]);

  // Sync URL params with state on mount.
  // Category/brand/supplier only apply when present in the URL so a bare /products
  // visit (or reload without those params) can restore persisted filters.
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    const urlStockStatus = searchParams.get('stock_status') || '';
    const urlTag = searchParams.get('tag') || 'new'; // Default to 'new' if not in URL

    if (urlSearch !== search) setSearch(urlSearch);
    if (searchParams.has('category')) {
      const urlCategory = searchParams.get('category') || '';
      if (urlCategory !== categoryFilter) setCategoryFilter(urlCategory);
    }
    if (searchParams.has('brand')) {
      const urlBrand = searchParams.get('brand') || '';
      if (urlBrand !== brandFilter) setBrandFilter(urlBrand);
    }
    if (searchParams.has('supplier')) {
      const urlSupplier = searchParams.get('supplier') || '';
      if (urlSupplier !== supplierFilter) setSupplierFilter(urlSupplier);
    }
    if (urlStockStatus !== stockStatusFilter) setStockStatusFilter(urlStockStatus);
    if (urlTag !== tagFilter) setTagFilter(urlTag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change, and persist category/brand/supplier per tab.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (categoryFilter) params.set('category', categoryFilter);
    if (brandFilter) params.set('brand', brandFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (stockStatusFilter) params.set('stock_status', stockStatusFilter);
    if (tagFilter) params.set('tag', tagFilter);
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
    writePersistedFiltersForTab(tagFilter, {
      category: categoryFilter,
      brand: brandFilter,
      supplier: supplierFilter,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter]);

  const applyProductTab = (nextTag: string) => {
    if (nextTag === tagFilter) return;
    writePersistedFiltersForTab(tagFilter, {
      category: categoryFilter,
      brand: brandFilter,
      supplier: supplierFilter,
    });
    const nextFilters = getPersistedFiltersForTab(nextTag);
    setTagFilter(nextTag);
    setCategoryFilter(nextFilters.category);
    setBrandFilter(nextFilters.brand);
    setSupplierFilter(nextFilters.supplier);
    setStockStatusFilter('');
  };

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
    // Exclude Other/Custom products (name starts with "Other -") from Products page list
    params.exclude_other_custom = 'true';
    // Skip unused breakdown/price fields so the Fresh tab can render without extra work
    params.lite = 'true';
    // Pagination
    params.page = currentPage;
    params.limit = 50;
    return params;
  };

  // Fetch products
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['products', 'lite', search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter, currentPage],
    queryFn: async ({ signal }) => {
      const response = await productsApi.list(buildQueryParams(), { signal });
      return response.data;
    },
    enabled: defectiveReady,
    retry: false,
    placeholderData: (previousData) => {
      if (tagFilter === 'defective' && !defectiveReady) return undefined;
      return previousData;
    },
    staleTime: PRODUCTS_LIST_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  // Reset to page 1 when filters change (skip the initial mount so we don't
  // clear in-flight first-load results).
  const hasMountedFilters = useRef(false);
  useEffect(() => {
    if (!hasMountedFilters.current) {
      hasMountedFilters.current = true;
      return;
    }
    setCurrentPage(1);
    setLoadedProducts([]);
  }, [search, categoryFilter, brandFilter, supplierFilter, stockStatusFilter, tagFilter]);

  useEffect(() => {
    if (tagFilter === 'defective' && !defectiveReady) {
      setLoadedProducts([]);
      return;
    }
    if (!data) return;
    const page = Number((data as any).page || 1);
    const pageRows: any[] = Array.isArray((data as any).results)
      ? (data as any).results
      : Array.isArray((data as any).data)
        ? (data as any).data
        : Array.isArray(data)
          ? data
          : [];
    setLoadedProducts((prev) => {
      if (page <= 1) return pageRows;
      const existing = new Set(prev.map((p: any) => p.id));
      const merged = [...prev];
      pageRows.forEach((row: any) => {
        if (!existing.has(row.id)) merged.push(row);
      });
      return merged;
    });
  }, [data]);

  const loadedProductIdsKey = useMemo(
    () => loadedProducts.map((product: any) => product.id).filter(Boolean).join(','),
    [loadedProducts],
  );

  const { data: defectiveBarcodesResponse, isFetching: isFetchingDefectiveBarcodes } = useQuery({
    queryKey: ['defective-selectable-barcodes', loadedProductIdsKey, supplierFilter],
    queryFn: async ({ signal }) => {
      const response = await catalogApi.defectiveProducts.selectableBarcodes({
        product_ids: loadedProductIdsKey,
        supplier: supplierFilter || undefined,
      }, { signal });
      return response.data;
    },
    enabled: tagFilter === 'defective' && defectiveReady && loadedProductIdsKey.length > 0,
    staleTime: PRODUCTS_LIST_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data || response;
    },
    retry: false,
    enabled: showMoveOutModal || showAdjustmentForm,
    staleTime: PRODUCTS_REF_STALE_MS,
    gcTime: PRODUCTS_REF_STALE_MS,
  });

  // Handle different response formats
  const allProducts = loadedProducts;
  // Standard list includes total_pages; optimized list omits it and uses next + estimated count.
  const hasMoreProducts = Boolean(data) && (() => {
    const d = data as Record<string, unknown>;
    const page = Number(d.page ?? 1);
    const rawTp = d.total_pages;
    if (rawTp != null && rawTp !== '' && !Number.isNaN(Number(rawTp))) {
      return page < Number(rawTp);
    }
    const next = d.next;
    if (next != null && next !== '') return true;
    const pageSize = Number(d.page_size ?? d.limit ?? 50);
    const count = d.count;
    if (count != null && count !== '' && !Number.isNaN(Number(count)) && pageSize > 0) {
      return page * pageSize < Number(count);
    }
    return false;
  })();

  const productHasStockForLabels = (product: any) =>
    (Number(product?.barcodeCount) || 0) > 0 || (Number(product?.stock_quantity) || 0) > 0;

  // Enhance products with calculated stock fields
  const productsWithStock = useMemo(() => {
    return allProducts.map((product: any) => {
      const stock = getStockInfo(product);

      return {
        ...product,
        stock_quantity: stock.total,
        available_quantity: stock.available,
        isLowStock: stock.isLowStock,
        isOutOfStock: stock.isOutOfStock,
      };
    });
  }, [allProducts]);

  const defectiveBarcodesByProduct = useMemo(() => {
    const map = new Map<number, any[]>();
    const rows = Array.isArray(defectiveBarcodesResponse)
      ? defectiveBarcodesResponse
      : Array.isArray((defectiveBarcodesResponse as any)?.results)
        ? (defectiveBarcodesResponse as any).results
        : [];
    rows.forEach((row: any) => {
      const productId = row?.product_id;
      if (!productId) return;
      const list = map.get(productId) || [];
      list.push(row);
      map.set(productId, list);
    });
    return map;
  }, [defectiveBarcodesResponse]);

  // With new model: ONE Product per name, barcodes are individual items
  // No need to group - show Products directly with their barcodes
  const productsList = useMemo(() => {
    return productsWithStock.map((product: any) => {
      const stock = getStockInfo(product);

      // Use total stock for filtered views (Sold, Defective, etc.)
      // Use available stock for the default "New" view
      const barcodeCount = tagFilter && tagFilter !== 'new'
        ? stock.total
        : stock.available;

      return {
        ...product,
        barcodeCount, // Quantity to display in the badge
        isLowStock: stock.isLowStock,
        isOutOfStock: stock.isOutOfStock,
        barcodes: tagFilter === 'defective'
          ? (defectiveBarcodesByProduct.get(product.id) || [])
          : product.barcodes,
      };
    });
  }, [productsWithStock, tagFilter, defectiveBarcodesByProduct]);

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

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

  const bulkStatusUpdateMutation = useMutation({
    mutationFn: async ({
      barcodeIds,
      newTag,
    }: {
      barcodeIds: number[];
      newTag: string;
    }) => {
      const allUpdatedBarcodes: any[] = [];
      const allErrors: string[] = [];
      // Force direct status updates per barcode (confirmed=true) with no flow checks in UI.
      const results = await Promise.allSettled(
        barcodeIds.map((barcodeId) =>
          catalogApi.barcodes.updateTag(barcodeId, { tag: newTag, confirmed: true })
        )
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          const updated = result.value?.data?.updated_barcode;
          if (updated) {
            allUpdatedBarcodes.push(updated);
          } else {
            allUpdatedBarcodes.push({ id: barcodeIds[idx] });
          }
          return;
        }
        const err: any = result.reason;
        const message = err?.response?.data?.error ||
          err?.response?.data?.message ||
          `Barcode ID ${barcodeIds[idx]} update failed`;
        allErrors.push(message);
      });

      return {
        data: {
          updated_barcodes: allUpdatedBarcodes,
          errors: allErrors,
        }
      };
    },
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] });

      const updatedCount = response.data?.updated_barcodes?.length || 0;
      const errors = response.data?.errors || [];

      if (updatedCount > 0) {
        if (errors.length > 0) {
          alert(`Updated ${updatedCount} barcode(s) to "${variables.newTag}". Failed: ${errors.length}.`);
        } else {
          alert(`Successfully updated ${updatedCount} barcode(s) to "${variables.newTag}".`);
        }
      } else if (errors.length > 0) {
        alert(`No barcodes were updated. ${errors.join(', ')}`);
      } else {
        alert('No barcodes were updated.');
      }

      setScannedStatusRows([]);
      setStatusLookupInput('');
      setBulkStatusInput('');
      setStatusUpdateTag('');
      setStatusLookupError(null);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        'Failed to update barcode statuses';
      alert(errorMsg);
    },
  });

  const getReadableTagLabel = (tag: string) => {
    if (!tag) return 'Unknown';
    const normalized = String(tag).toLowerCase();
    if (normalized === 'new') return 'Fresh (New)';
    if (normalized === 'in-cart') return 'In Cart';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const resolveBarcodeStatus = async (rawCode: string) => {
    const code = (rawCode || '').trim();
    if (!code) return null;
    const response = await productsApi.byBarcode(code, false, true);
    const data = response?.data;
    if (!data?.barcode_id) {
      throw new Error(`Code "${code}" not found`);
    }

    return {
      lookup: code,
      barcodeId: data.barcode_id,
      barcode: data.canonical_barcode || data.matched_barcode || code,
      shortCode: data.matched_barcode || '',
      productName: data.name || 'Unknown Product',
      sku: data.sku || '',
      currentTag: String(data.barcode_tag || 'unknown').toLowerCase(),
    };
  };

  const addSingleStatusLookup = async () => {
    const code = statusLookupInput.trim();
    if (!code) return;
    setStatusLookupError(null);

    try {
      const row = await resolveBarcodeStatus(code);
      if (!row) return;
      setScannedStatusRows((prev) => {
        if (prev.some((item: any) => item.barcodeId === row.barcodeId)) return prev;
        return [row, ...prev];
      });
      setStatusLookupInput('');
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.message || `Code "${code}" not found`;
      setStatusLookupError(msg);
      setTimeout(() => setStatusLookupError(null), 3000);
    }
  };

  const addBulkStatusLookups = async () => {
    const codes = Array.from(
      new Set(
        bulkStatusInput
          .split(/[\n,\s]+/)
          .map((c) => c.trim())
          .filter(Boolean)
      )
    );

    if (codes.length === 0) {
      setStatusLookupError('Please enter at least one barcode/short code.');
      setTimeout(() => setStatusLookupError(null), 2500);
      return;
    }

    setStatusLookupError(null);
    const results = await Promise.allSettled(codes.map((code) => resolveBarcodeStatus(code)));
    const successfulRows = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !!r.value)
      .map((r) => r.value);
    const failedCount = results.filter((r) => r.status === 'rejected').length;

    setScannedStatusRows((prev) => {
      const seen = new Set(prev.map((item: any) => item.barcodeId));
      const next = [...prev];
      successfulRows.forEach((row) => {
        if (!seen.has(row.barcodeId)) {
          seen.add(row.barcodeId);
          next.unshift(row);
        }
      });
      return next;
    });

    if (failedCount > 0) {
      setStatusLookupError(`${failedCount} code(s) could not be found.`);
      setTimeout(() => setStatusLookupError(null), 3000);
    }
  };

  const removeScannedStatusRow = (barcodeId: number) => {
    setScannedStatusRows((prev) => prev.filter((row: any) => row.barcodeId !== barcodeId));
  };

  const BARCODE_STATUS_TOOL_ALLOWED_TAGS = ['new', 'unknown', 'defective'] as const;

  const handleApplyBulkStatus = () => {
    if (!statusUpdateTag) {
      alert('Please select a target status.');
      return;
    }
    if (!BARCODE_STATUS_TOOL_ALLOWED_TAGS.includes(statusUpdateTag as typeof BARCODE_STATUS_TOOL_ALLOWED_TAGS[number])) {
      alert('Sold, Returned, and In Cart cannot be set from this tool. Use POS or the Unknown products tab for returns.');
      return;
    }
    if (scannedStatusRows.length === 0) {
      alert('Please scan at least one barcode first.');
      return;
    }

    const barcodeIds = scannedStatusRows
      .map((row: any) => row.barcodeId)
      .filter(Boolean);
    if (barcodeIds.length === 0) {
      alert('No valid barcode IDs found to update.');
      return;
    }

    if (!window.confirm(`Update ${barcodeIds.length} barcode(s) to "${getReadableTagLabel(statusUpdateTag)}"?`)) {
      return;
    }

    bulkStatusUpdateMutation.mutate({ barcodeIds, newTag: statusUpdateTag });
  };

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
    if (
      window.confirm(
        `Remove "${productName}" from the catalog? The product will be hidden and deactivated; existing invoices and history stay intact.`
      )
    ) {
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
        alert('No items were marked as defective. Items must be Fresh (New) or Unknown.');
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

  const handleMarkBarcodeAsFresh = (barcodeId: number, fromTag: string) => {
    const tagLabel = fromTag === 'returned' ? 'returned' : 'defective';
    if (window.confirm(`Mark this ${tagLabel} barcode as fresh and add it back to inventory?`)) {
      markAsFreshMutation.mutate({ barcodeIds: [barcodeId], fromTag });
    }
  };

  const getDefectiveBarcodesForProduct = (product: any): any[] => {
    const barcodes = Array.isArray(product?.barcodes) ? product.barcodes : [];
    return barcodes.filter((b: any) => {
      if (!b || typeof b !== 'object') return false;
      if (!b.id) return false;
      const isDefective = !b.tag || String(b.tag) === 'defective';
      if (!isDefective) return false;
      // Enforce supplier filter at barcode level because product-level supplier filtering
      // can still return mixed-supplier barcode arrays for the same product.
      if (supplierFilter && b.supplier_id && String(b.supplier_id) !== supplierFilter) return false;
      return true;
    });
  };

  // Handle barcode scan for defective barcode selection.
  // First searches loaded products; falls back to API lookup for products not yet paged in.
  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode || !barcode.trim()) return;

    const trimmedBarcode = barcode.trim();
    const normalizedScan = trimmedBarcode.toUpperCase();
    setBarcodeScanError(null);

    // Search in already loaded defective products first (fast, no API call)
    let matchedProduct = null;
    let matchedBarcode: any = null;

    // Search through all filtered products
    for (const product of filteredProducts) {
      // Check only selectable defective barcodes (respects supplier filter).
      const barcodes = getDefectiveBarcodesForProduct(product);

      // Try to find matching barcode in the barcodes array
      const matchingBarcode = barcodes.find((b: any) => {
        // Match by full barcode or short code, case-insensitive.
        const barcodeValue = typeof b === 'string' ? b : (b.barcode || '');
        const shortCodeValue = typeof b === 'string' ? '' : (b.short_code || '');
        return String(barcodeValue).trim().toUpperCase() === normalizedScan
          || String(shortCodeValue).trim().toUpperCase() === normalizedScan;
      });

      if (matchingBarcode) {
        // Found matching barcode/short-code.
        matchedProduct = product;
        matchedBarcode = matchingBarcode;
        break;
      }

      // Also check product SKU as fallback (if barcode matches SKU)
      if (product.sku && String(product.sku).trim().toUpperCase() === normalizedScan) {
        matchedProduct = product;
        break;
      }
    }

    if (matchedProduct) {
      // Prefer exact barcode-level selection.
      if (matchedBarcode?.id) {
        // Check if this barcode has already been moved out
        if (matchedBarcode.defective_move_out_info?.moved_out) {
          const info = matchedBarcode.defective_move_out_info;
          const reason = info.reason || 'Defective';
          const moveOutNum = info.move_out_number || '';
          setBarcodeScanError(`"${matchedProduct.name}" has already been sent out (${reason}). Move-out: ${moveOutNum}`);
          setTimeout(() => setBarcodeScanError(null), 4000);
          return;
        }
        // Check supplier filter
        if (supplierFilter && matchedBarcode.supplier_id && String(matchedBarcode.supplier_id) !== supplierFilter) {
          const supplierName = matchedBarcode.supplier_name || 'another supplier';
          setBarcodeScanError(`This barcode belongs to "${supplierName}" — does not match the selected supplier filter.`);
          setTimeout(() => setBarcodeScanError(null), 3000);
          return;
        }
        if (selectedDefectiveProducts.has(matchedBarcode.id)) {
          setBarcodeScanError(`"${matchedProduct.name}" barcode is already selected.`);
          setTimeout(() => setBarcodeScanError(null), 2000);
          return;
        }
        setSelectedDefectiveProducts(prev => new Set(prev).add(matchedBarcode.id));
        setSelectedDefectiveProductsData(prev => {
          const next = new Map(prev);
          next.set(matchedBarcode.id, { product: matchedProduct, barcode: matchedBarcode });
          return next;
        });
        setBarcodeInput('');
        return;
      }

      // Fallback (e.g. SKU match): select all defective barcodes under product.
      const barcodesForProduct = getDefectiveBarcodesForProduct(matchedProduct);
      if (barcodesForProduct.length === 0) {
        setBarcodeScanError(`No defective barcodes found under "${matchedProduct.name}".`);
        setTimeout(() => setBarcodeScanError(null), 2000);
        return;
      }
      setSelectedDefectiveProducts(prev => {
        const next = new Set(prev);
        barcodesForProduct.forEach((b: any) => next.add(b.id));
        return next;
      });
      setSelectedDefectiveProductsData(prev => {
        const next = new Map(prev);
        barcodesForProduct.forEach((b: any) => {
          next.set(b.id, { product: matchedProduct, barcode: b });
        });
        return next;
      });

      // Clear input after successful scan
      setBarcodeInput('');
    } else {
      // Not found in locally loaded products — fall back to API lookup.
      // This handles barcodes on pages that haven't been loaded yet (pagination).
      try {
        const response = await productsApi.byBarcode(trimmedBarcode, false, true);
        const data = response.data;

        if (data && data.barcode_tag === 'defective') {
          // Check if this barcode has already been moved out
          if (data.defective_moved_out) {
            const reason = data.defective_move_out_reason || 'Defective';
            const moveOutNum = data.defective_move_out_number || '';
            setBarcodeScanError(`"${data.name}" has already been sent out (${reason}). Move-out: ${moveOutNum}`);
            setTimeout(() => setBarcodeScanError(null), 4000);
            setBarcodeInput('');
            return;
          }

          // Check supplier filter
          if (supplierFilter && data.supplier_id && String(data.supplier_id) !== supplierFilter) {
            const supplierName = data.supplier_name || 'another supplier';
            setBarcodeScanError(`This barcode belongs to "${supplierName}" — does not match the selected supplier filter.`);
            setTimeout(() => setBarcodeScanError(null), 3000);
            setBarcodeInput('');
            return;
          }

          const apiBarcode = {
            id: data.barcode_id,
            barcode: data.canonical_barcode,
            short_code: data.matched_barcode,
            tag: data.barcode_tag,
            purchase_price: data.purchase_price,
            supplier_id: data.supplier_id,
            supplier_name: data.supplier_name,
          };
          const apiProduct = {
            id: data.id,
            name: data.name,
            sku: data.sku,
          };

          if (selectedDefectiveProducts.has(apiBarcode.id)) {
            setBarcodeScanError(`"${apiProduct.name}" barcode is already selected.`);
            setTimeout(() => setBarcodeScanError(null), 2000);
            return;
          }
          setSelectedDefectiveProducts(prev => new Set(prev).add(apiBarcode.id));
          setSelectedDefectiveProductsData(prev => {
            const next = new Map(prev);
            next.set(apiBarcode.id, { product: apiProduct, barcode: apiBarcode });
            return next;
          });
          setBarcodeInput('');
        } else if (data && data.barcode_tag) {
          // Barcode exists but isn't defective
          setBarcodeScanError(`Code "${trimmedBarcode}" is not defective (current status: ${data.barcode_tag}).`);
          setTimeout(() => setBarcodeScanError(null), 3000);
        } else {
          setBarcodeScanError(`Code "${trimmedBarcode}" not found. Try barcode or short code, and ensure product is defective.`);
          setTimeout(() => setBarcodeScanError(null), 3000);
        }
      } catch (error: any) {
        setBarcodeScanError(`Code "${trimmedBarcode}" not found. Try barcode or short code, and ensure product is defective.`);
        setTimeout(() => setBarcodeScanError(null), 3000);
      }
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

  // Remove one selected barcode from selection.
  const handleRemoveFromSelection = (barcodeId: number) => {
    setSelectedDefectiveProducts(prev => {
      const newSet = new Set(prev);
      newSet.delete(barcodeId);
      return newSet;
    });
    setSelectedDefectiveProductsData(prev => {
      const newMap = new Map(prev);
      newMap.delete(barcodeId);
      return newMap;
    });
  };

  const handleDeselectAllDefective = () => {
    setSelectedDefectiveProducts(new Set());
    setSelectedDefectiveProductsData(new Map());
  };

  // Move out defective products - create move-out record with invoice
  const moveOutDefectiveMutation = useMutation({
    mutationFn: async (data: { productIds: number[]; barcodeIds: number[]; reason: string; notes: string }) => {
      // Get first store for move-out
      const store = stores.length > 0 ? stores[0] : null;
      if (!store) {
        throw new Error('No store available. Please create a store first.');
      }

      // Call the new API endpoint
      const response = await catalogApi.defectiveProducts.moveOut({
        store: store.id,
        product_ids: data.productIds,
        barcode_ids: data.barcodeIds,
        reason: data.reason,
        notes: data.notes,
      });

      return response.data;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['existing-move-outs'] });
      setSelectedDefectiveProducts(new Set());
      setSelectedDefectiveProductsData(new Map());
      setShowMoveOutModal(false);
      setMoveOutData({ reason: 'return_to_supplier', notes: '' });
      setMoveOutMode('new');
      setSelectedExistingMoveOutId(null);

      // Backend now returns { move_outs: [...], total_move_outs: N, ... }
      const moveOuts: any[] = response.move_outs || [response];
      const count = moveOuts.length;

      if (count === 1) {
        alert(`Move-out created successfully!\nMove-out: ${moveOuts[0].move_out_number}\nInvoice: ${moveOuts[0].invoice_number || 'N/A'}`);
        if (moveOuts[0].invoice) {
          navigate(`/invoices/${moveOuts[0].invoice}`);
        }
      } else {
        const details = moveOuts
          .map((m: any) => `• ${m.move_out_number}  →  Invoice: ${m.invoice_number || 'N/A'}  (${m.notes || ''})`)
          .join('\n');
        alert(`${count} move-outs created (one per supplier):\n\n${details}`);
        navigate('/defective-move-outs');
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

  // Add items to existing move-out mutation
  const addToMoveOutMutation = useMutation({
    mutationFn: async (data: { moveOutId: number; productIds: number[]; barcodeIds: number[] }) => {
      const response = await catalogApi.defectiveProducts.moveOuts.addItems(data.moveOutId, {
        product_ids: data.productIds,
        barcode_ids: data.barcodeIds,
      });
      return response.data;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs'] });
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs-for-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['existing-move-outs'] });
      setSelectedDefectiveProducts(new Set());
      setSelectedDefectiveProductsData(new Map());
      setShowMoveOutModal(false);
      setMoveOutData({ reason: 'return_to_supplier', notes: '' });
      setMoveOutMode('new');
      setSelectedExistingMoveOutId(null);

      const mo = response.move_out;
      alert(`Added ${response.added_items} item(s) to move-out ${mo?.move_out_number || ''}.${response.skipped_already_moved ? ` (${response.skipped_already_moved} already in a move-out)` : ''}`);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to add items to move-out';
      alert(errorMsg);
    },
  });

  // Fetch existing move-outs when modal is open
  const { data: existingMoveOutsData } = useQuery({
    queryKey: ['existing-move-outs'],
    queryFn: ({ signal }) => catalogApi.defectiveProducts.moveOuts.list(undefined, { signal }),
    enabled: showMoveOutModal,
  });

  const existingMoveOuts = useMemo(() => {
    if (!existingMoveOutsData) return [];
    const results = existingMoveOutsData.data?.results || existingMoveOutsData.data || [];
    return Array.isArray(results) ? results : [];
  }, [existingMoveOutsData]);

  const handleMoveOutDefective = () => {
    if (selectedDefectiveProducts.size === 0) {
      alert('Please select at least one defective barcode to move out.');
      return;
    }
    setMoveOutMode(existingMoveOuts.length > 0 ? 'existing' : 'new');
    setSelectedExistingMoveOutId(null);
    setShowMoveOutModal(true);
  };

  // Prevent stale/hidden selections when leaving defective view or changing supplier filter.
  useEffect(() => {
    setSelectedDefectiveProducts(new Set());
    setSelectedDefectiveProductsData(new Map());
    setBarcodeScanError(null);
  }, [supplierFilter, tagFilter]);

  const handleMoveOutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedBarcodes = Array.from(selectedDefectiveProducts)
      .map((barcodeId) => selectedDefectiveProductsData.get(barcodeId))
      .filter(Boolean);
    const barcodeIds = selectedBarcodes.map((row: any) => row?.barcode?.id).filter(Boolean);
    const productIds = [...new Set(selectedBarcodes.map((row: any) => row?.product?.id).filter(Boolean))];

    if (moveOutMode === 'existing' && selectedExistingMoveOutId) {
      addToMoveOutMutation.mutate({
        moveOutId: selectedExistingMoveOutId,
        productIds,
        barcodeIds,
      });
    } else {
      moveOutDefectiveMutation.mutate({
        productIds,
        barcodeIds,
        reason: moveOutData.reason,
        notes: moveOutData.notes,
      });
    }
  };

  // Helper function to get table headers based on tag
  const getTableHeaders = (tag: string): string[] => {
    switch (tag) {
      case 'new':
        return ['S.No', 'Name', 'Brand', 'Category', 'Total Stock', 'Status', 'Actions', 'Low Stock Limit'];
      case 'sold':
        return ['S.No', 'Name', 'Short Code', 'Brand', 'Category', 'Status', 'Actions'];
      case 'unknown':
        return ['S.No', 'Name', 'Short Code', 'Brand', 'Category', 'Status', 'Actions'];
      case 'returned':
        return ['S.No', 'Name', 'Short Code', 'Brand', 'Category', 'Status', 'Actions'];
      case 'defective':
        return ['', 'S.No', 'Name', 'Short Code', 'Brand', 'Category', 'Actions'];
      case 'in-cart':
        return ['S.No', 'Name', 'Brand', 'Category', 'Quantity', 'Status', 'Actions'];
      default:
        return ['S.No', 'Name', 'Brand', 'Category', 'Total Stock', 'Status', 'Actions', 'Low Stock Limit'];
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

  const handleLabelButtonClick = async (product: any) => {
    const cached = labelStatuses[product.id];
    if (cached?.all_generated) {
      await handlePrintLabels(product);
      return;
    }
    if (cached && cached.all_generated === false && !cached.generating) {
      await handleGenerateLabels(product);
      return;
    }

    setGeneratingLabelsFor(product.id);
    try {
      const response = await productsApi.labelsStatus(product.id);
      const allGenerated = Boolean(response.data?.all_generated);
      setLabelStatuses((prev) => ({
        ...prev,
        [product.id]: { all_generated: allGenerated, generating: false },
      }));
      setGeneratingLabelsFor(null);
      if (allGenerated) {
        await handlePrintLabels(product);
      } else {
        await handleGenerateLabels(product);
      }
    } catch (error: any) {
      setGeneratingLabelsFor(null);
      const errorMsg = error?.response?.data?.error || error?.message || 'Failed to check label status';
      alert(errorMsg);
    }
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

  const exportFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const asList = (data: any) => {
      const list = data?.results || data?.data || data || [];
      return Array.isArray(list) ? list : [];
    };
    if (search) labels.push(`Search: ${search}`);
    if (categoryFilter) {
      const cat = asList(categoriesData).find((c: any) => String(c.id) === String(categoryFilter));
      labels.push(`Category: ${cat?.name || categoryFilter}`);
    }
    if (brandFilter) {
      const brand = asList(brandsData).find((b: any) => String(b.id) === String(brandFilter));
      labels.push(`Brand: ${brand?.name || brandFilter}`);
    }
    if (supplierFilter) {
      const supplier = asList(suppliersData).find((s: any) => String(s.id) === String(supplierFilter));
      labels.push(`Supplier: ${supplier?.name || supplier?.code || supplierFilter}`);
    }
    if (tagFilter === 'new') {
      if (stockStatusFilter === 'low_stock' || activeStockTab === 'low') labels.push('Stock: Low');
      else if (stockStatusFilter === 'out_of_stock' || activeStockTab === 'out') labels.push('Stock: Out');
      else if (stockStatusFilter === 'in_stock') labels.push('Stock: In stock');
    }
    return labels;
  }, [
    search,
    categoryFilter,
    brandFilter,
    supplierFilter,
    stockStatusFilter,
    activeStockTab,
    tagFilter,
    categoriesData,
    brandsData,
    suppliersData,
  ]);

  const fetchAllProductsForExport = async (): Promise<any[]> => {
    const allRows: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // List view uses lite=true (no prices). Export needs include_prices so PDF
      // purchase/selling columns are populated instead of dashes.
      const params = { ...buildQueryParams(), page, limit: 100, include_prices: 'true' };
      const response = await productsApi.list(params);
      const data = response.data;
      const pageRows: any[] = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
      allRows.push(...pageRows);

      const totalPages = data?.total_pages;
      if (totalPages != null && totalPages !== '' && !Number.isNaN(Number(totalPages))) {
        hasMore = page < Number(totalPages);
      } else if (data?.next != null && data.next !== '') {
        hasMore = true;
      } else {
        const pageSize = Number(data?.page_size ?? data?.limit ?? 100);
        const count = data?.count;
        hasMore =
          count != null &&
          count !== '' &&
          !Number.isNaN(Number(count)) &&
          pageSize > 0 &&
          page * pageSize < Number(count);
      }

      page += 1;
      if (page > 500) break;
    }

    const withStock = allRows.map((product: any) => {
      const stock = getStockInfo(product);
      return {
        ...product,
        stock_quantity: stock.total,
        available_quantity: stock.available,
        isLowStock: stock.isLowStock,
        isOutOfStock: stock.isOutOfStock,
        barcodeCount: tagFilter && tagFilter !== 'new' ? stock.total : stock.available,
      };
    });

    if (tagFilter === 'new') {
      if (activeStockTab === 'low' || stockStatusFilter === 'low_stock') {
        return withStock.filter((p: any) => p.isLowStock && !p.isOutOfStock);
      }
      if (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock') {
        return withStock.filter((p: any) => p.isOutOfStock);
      }
    }
    return withStock;
  };

  // Fetch move-outs for defective metrics
  const { data: moveOutsData } = useQuery({
    queryKey: ['defective-move-outs-for-metrics'],
    queryFn: ({ signal }) => catalogApi.defectiveProducts.moveOuts.list(undefined, { signal }),
    enabled: tagFilter === 'defective' && defectiveReady,
    retry: false,
  });

  // Calculate defective products metrics
  const defectiveMetrics = useMemo(() => {
    if (tagFilter !== 'defective') {
      return { count: 0, totalLoss: 0, totalItems: 0, purchaseValue: 0 };
    }

    // Use productsList (all defective products) instead of filteredProducts for accurate metrics
    const defectiveProducts = productsList.filter((p: any) => p.barcodeCount > 0);
    let totalCount = 0;
    let purchaseValue = 0;

    defectiveProducts.forEach((product: any) => {
      const barcodes = product.barcodes || [];
      const defectiveBarcodes = barcodes.filter((b: any) => b.tag === 'defective');
      totalCount += defectiveBarcodes.length;
      defectiveBarcodes.forEach((b: any) => {
        purchaseValue += Number(b?.purchase_price || 0);
      });
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
      purchaseValue,
    };
  }, [tagFilter, productsList, moveOutsData]);

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

  const openProductImagePreview = (product: any) => {
    const src = String(product?.image || '').trim();
    if (!src) return;
    setProductImagePreview({ src, title: String(product?.name || 'Product Image') });
  };

  const renderProductImageAction = (product: any, mobile = false) => {
    if (!product?.image) return null;
    return (
      <button
        onClick={() => openProductImagePreview(product)}
        className={
          mobile
            ? 'flex items-center justify-center w-7 h-7 text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors'
            : 'flex items-center justify-center w-8 h-8 text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200'
        }
        title="View product image"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </button>
    );
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

  const listEmptyMessage = isLoading
    ? 'Loading products...'
    : (tagFilter === 'defective' && isFetchingDefectiveBarcodes)
      ? 'Loading defective barcodes...'
      : 'No products found. Add products first.';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowExportModal(true)}
          >
            <Download className="h-5 w-5 mr-2 inline" />
            Export
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowBarcodeStatusTool(true)}
          >
            <Barcode className="h-5 w-5 mr-2 inline" />
            Barcode Status
          </Button>
          <Button onClick={() => { setEditingProduct(undefined); setShowForm(true); }}>
            <Plus className="h-5 w-5 mr-2 inline" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Tag Tabs - Primary Navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => applyProductTab('new')}
            className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${tagFilter === 'new'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            All Products
          </button>
          <button
            onClick={() => applyProductTab('sold')}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'sold'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Sold
          </button>
          <button
            onClick={() => applyProductTab('unknown')}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'unknown'
              ? 'bg-yellow-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Unknown
          </button>
          <button
            onClick={() => applyProductTab('returned')}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'returned'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Returned
          </button>
          <button
            onClick={() => applyProductTab('defective')}
            className={`px-4 py-2 rounded-lg transition-colors font-medium ${tagFilter === 'defective'
              ? 'bg-red-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Defective
          </button>
          <button
            onClick={() => applyProductTab('in-cart')}
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
      {tagFilter === 'defective' && defectiveReady && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Defective Purchase Value</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{defectiveMetrics.purchaseValue.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-orange-100 rounded-lg">
                <Coins className="h-6 w-6 text-orange-600" />
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
      {tagFilter === 'defective' && defectiveReady && (
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
                    {selectedDefectiveProducts.size} barcode(s) selected
                  </span>
                  <button
                    onClick={handleDeselectAllDefective}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Clear selection
                  </button>
                </>
              ) : (
                <span className="text-sm text-gray-600">No barcodes selected yet</span>
              )}
              <button
                onClick={() => {
                  const next = new Set<number>();
                  const nextMap = new Map<number, any>();
                  filteredProducts.forEach((product: any) => {
                    getDefectiveBarcodesForProduct(product).forEach((barcode: any) => {
                      next.add(barcode.id);
                      nextMap.set(barcode.id, { product, barcode });
                    });
                  });
                  setSelectedDefectiveProducts(next);
                  setSelectedDefectiveProductsData(nextMap);
                }}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Select all visible
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate('/defective-move-outs')}
                className="flex items-center gap-2"
              >
                <Eye className="h-4 w-4" />
                View Move-Outs
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
            onChange={(e) => {
              const value = e.target.value;
              setSupplierFilter(value);
              if (tagFilter === 'defective' && !value) {
                setDefectiveScopeReady(false);
              }
            }}
            icon={<Filter className="h-4 w-4" />}
          >
            {tagFilter === 'defective'
              ? (!supplierFilter && <option value="">Select a supplier</option>)
              : <option value="">All Suppliers</option>}
            {supplierOptions.map((supplier: any) => (
              <option key={supplier.id} value={supplier.id.toString()}>{supplier.name}</option>
            ))}
          </Select>
        </div>
      </Card>

      {/* Desktop Table View */}
      <div className="hidden md:block">
        {tagFilter === 'defective' && !defectiveReady ? (
          <Card>
            <div className="py-12 text-center text-gray-500">
              Select a supplier to view defective products.
            </div>
          </Card>
        ) : tagFilter === 'defective' ? (
          <div className="flex flex-col gap-4">
            {/* Selected Barcodes panel - sticky at top */}
            <div className="sticky top-0 z-10 bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-gray-900">
                    Selected Barcodes
                    {selectedDefectiveProducts.size > 0 && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        {selectedDefectiveProducts.size}
                      </span>
                    )}
                  </h3>
                  {selectedDefectiveProducts.size > 0 && (
                    <Button onClick={handleDeselectAllDefective} variant="outline" size="sm">
                      Clear All
                    </Button>
                  )}
                </div>
                {selectedDefectiveProducts.size === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-2">
                    No barcodes selected. Scan barcodes or tick checkboxes below.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {Array.from(selectedDefectiveProductsData.entries()).map(([barcodeId, row]) => {
                      const product = row?.product;
                      const barcode = row?.barcode;
                      if (!product || !barcode) return null;
                      return (
                        <div
                          key={barcodeId}
                          className="flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-xs"
                        >
                          <span className="font-medium text-gray-800" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>
                            {product.name}
                          </span>
                          <span className="text-gray-500 font-mono">{barcode.short_code || barcode.barcode || '-'}</span>
                          <button
                            onClick={() => handleRemoveFromSelection(barcodeId)}
                            className="text-gray-400 hover:text-red-600 transition-colors"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 min-w-0 overflow-x-auto">
              <Table headers={getTableHeaders(tagFilter)}>
                {filteredProducts.length > 0 ? (() => {
                  let serial = 0;
                  return filteredProducts.flatMap((product: any) => {
                  const barcodes: any[] = getDefectiveBarcodesForProduct(product);
                  if (barcodes.length === 0) return [];
                  return barcodes.map((barcode: any) => {
                    serial += 1;
                    const rowSerial = serial;
                    const isSelected = selectedDefectiveProducts.has(barcode.id);
                    return (
                      <tr key={`${product.id}-barcode-${barcode.id}`} className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}>
                        {/* Checkbox */}
                        <td className="px-4 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDefectiveProducts(prev => new Set(prev).add(barcode.id));
                                setSelectedDefectiveProductsData(prev => {
                                  const next = new Map(prev);
                                  next.set(barcode.id, { product, barcode });
                                  return next;
                                });
                              } else {
                                handleRemoveFromSelection(barcode.id);
                              }
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            title="Select barcode for move-out"
                          />
                        </td>
                        {/* S.No */}
                        <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 tabular-nums">
                          {rowSerial}
                        </td>
                        {/* Name */}
                        <td className="px-6 py-3 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>
                            {product.name}
                          </span>
                        </td>
                        {/* Short Code */}
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Barcode className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                            <span className="text-sm font-mono text-gray-700">{barcode.short_code || barcode.barcode || '-'}</span>
                          </div>
                        </td>
                        {/* Brand */}
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                          {product.brand_name || '-'}
                        </td>
                        {/* Category */}
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                          {product.category_name || '-'}
                        </td>
                        {/* Actions */}
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleMarkBarcodeAsFresh(barcode.id, 'defective')}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                              title="Mark as Fresh"
                              disabled={markAsFreshMutation.isPending}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Fresh
                            </button>
                            {!isRetailUser && (
                              <button
                                onClick={() => handleDeleteProduct(product.id, product.name)}
                                className="flex items-center justify-center w-7 h-7 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 hover:text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete Product"
                                disabled={deleteProductMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  });
                });
                })() : (
                  <tr>
                    <td colSpan={getTableHeaders('defective').length} className="px-6 py-8 text-center text-gray-500">
                      {productsList.length === 0
                        ? listEmptyMessage
                        : 'No defective products found.'}
                    </td>
                  </tr>
                )}
              </Table>
              {hasMoreProducts && (
                <div className="flex justify-center py-3">
                  <Button variant="outline" onClick={() => setCurrentPage((p) => p + 1)} disabled={isFetching}>
                    {isFetching ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (tagFilter === 'sold' || tagFilter === 'unknown' || tagFilter === 'returned') ? (
          <>
            <Table headers={getTableHeaders(tagFilter)}>
              {filteredProducts.length > 0 ? (() => {
                let serial = 0;
                return filteredProducts.flatMap((product: any) => {
                const barcodes: any[] = Array.isArray(product.barcodes) ? product.barcodes : [];
                if (barcodes.length === 0) return [];

                const statusVariant: 'info' | 'warning' = tagFilter === 'unknown' ? 'warning' : 'info';
                const statusLabel = tagFilter === 'sold' ? 'Sold' : tagFilter === 'unknown' ? 'Unknown' : 'Returned';

                return barcodes.map((barcode: any, index: number) => {
                  serial += 1;
                  const rowSerial = serial;
                  const barcodeValue = typeof barcode === 'string' ? barcode : (barcode?.short_code || barcode?.barcode || '-');
                  const rowKey = typeof barcode === 'string'
                    ? `${product.id}-barcode-${barcode}-${index}`
                    : `${product.id}-barcode-${barcode?.id || index}`;

                  return (
                    <tr key={rowKey} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 tabular-nums">
                        {rowSerial}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>
                          {product.name}
                        </span>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Barcode className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm font-mono text-gray-700">{barcodeValue}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                        {product.brand_name || '-'}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                        {product.category_name || '-'}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <Badge variant={statusVariant}>{statusLabel}</Badge>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewSKUs(product)}
                            className="flex items-center justify-center w-8 h-8 text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                            title="View SKUs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                            {renderProductImageAction(product)}
                          {tagFilter === 'sold' && !isRetailUser && (
                            <button
                              onClick={() => handleDeleteProduct(product.id, product.name)}
                              className="flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Delete Product"
                              disabled={deleteProductMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                });
              });
              })() : (
                <tr>
                  <td colSpan={getTableHeaders(tagFilter).length} className="px-6 py-8 text-center text-gray-500">
                    {productsList.length === 0
                      ? listEmptyMessage
                      : tagFilter === 'sold'
                        ? 'No sold products found.'
                        : tagFilter === 'unknown'
                          ? 'No unknown products found.'
                          : 'No returned products found.'}
                  </td>
                </tr>
              )}
            </Table>
            {hasMoreProducts && (
              <div className="flex justify-center py-3">
                <Button variant="outline" onClick={() => setCurrentPage((p) => p + 1)} disabled={isFetching}>
                  {isFetching ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <Table headers={getTableHeaders(tagFilter)}>
              {filteredProducts.length > 0 ? filteredProducts.map((product: any, productIndex: number) => {
                // Use the same rendering logic as the defective section above
                // This ensures Purchase/Edit buttons show correctly for all products
                const currentTagFilter = tagFilter as 'new' | 'sold' | 'unknown' | 'returned' | 'defective' | 'in-cart';

                // Determine status badge
                let statusBadge;
                if (currentTagFilter === 'new') {
                  const hasBarcodes = product.barcodes && product.barcodes.length > 0;
                  const hasStock = (product.barcodeCount || 0) > 0 || (Number(product.stock_quantity) || 0) > 0;
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
                    case 'S.No':
                      return (
                        <td key={cellKey} className="px-3 py-4 whitespace-nowrap text-sm text-gray-500 tabular-nums">
                          {productIndex + 1}
                        </td>
                      );
                    case 'Name':
                      return (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>{product.name}</span>
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
                        ? barcodes.map((b: any) => b.short_code || b.barcode || b).filter((b: any) => b)
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
                    case 'Low Stock Threshold':
                    case 'Low Stock Limit':
                      return currentTagFilter === 'new' ? (
                        <td key={cellKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <span className="font-medium">
                            {typeof product.low_stock_threshold === 'number'
                              ? product.low_stock_threshold
                              : (parseFloat(product.low_stock_threshold || '0') || 0)}
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
                                      className="flex items-center justify-center w-8 h-8 text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                      title="Create Purchase for this Product"
                                    >
                                      <ShoppingCart className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                <button
                                  onClick={() => handleViewSKUs(product)}
                                  className="flex items-center justify-center w-8 h-8 text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                  title="View SKUs"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                {renderProductImageAction(product)}
                                {(() => {
                                  const hasLabels = productHasStockForLabels(product) || (product.barcodes && product.barcodes.length > 0);
                                  const status = labelStatuses[product.id];
                                  const isGenerating = generatingLabelsFor === product.id || (status?.generating);
                                  const allGenerated = status?.all_generated;
                                  if (!hasLabels) return null;
                                  if (isGenerating) {
                                    return (
                                      <button
                                        disabled
                                        className="flex items-center justify-center w-8 h-8 text-gray-500 bg-gray-50 border border-gray-200 rounded-md cursor-not-allowed"
                                        title="Generating Labels..."
                                      >
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      </button>
                                    );
                                  }
                                  if (allGenerated) {
                                    return (
                                      <button
                                        onClick={() => handleLabelButtonClick(product)}
                                        className="flex items-center justify-center w-8 h-8 text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-all duration-200"
                                        title="Print Labels"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                      </button>
                                    );
                                  }
                                  return (
                                    <button
                                      onClick={() => handleLabelButtonClick(product)}
                                      className="flex items-center justify-center w-8 h-8 text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-all duration-200"
                                      title={status ? 'Generate Labels' : 'Print or generate labels'}
                                    >
                                      <Printer className="h-3.5 w-3.5" />
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
                                  className="flex items-center justify-center w-8 h-8 text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                  title="View SKUs"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                {renderProductImageAction(product)}
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
                              <>
                                <button
                                  onClick={() => handleViewSKUs(product)}
                                  className="flex items-center justify-center w-8 h-8 text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-all duration-200"
                                  title="View SKUs"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                {renderProductImageAction(product)}
                              </>
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
                      ? listEmptyMessage
                      : tagFilter === 'new' && (activeStockTab === 'low' || stockStatusFilter === 'low_stock')
                        ? 'No products match the "Low Stock" filter.'
                        : tagFilter === 'new' && (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock')
                          ? 'No products match the "Out of Stock" filter.'
                          : `No products found with tag "${tagFilter === 'new' ? 'Fresh (New)' : tagFilter === 'sold' ? 'Sold' : tagFilter === 'unknown' ? 'Unknown' : tagFilter === 'returned' ? 'Returned' : tagFilter === 'defective' ? 'Defective' : tagFilter === 'in-cart' ? 'In Cart' : tagFilter}"`}
                  </td>
                </tr>
              )}
            </Table>
            {hasMoreProducts && (
              <div className="flex justify-center py-3">
                <Button variant="outline" onClick={() => setCurrentPage((p) => p + 1)} disabled={isFetching}>
                  {isFetching ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {/* Barcode Input for Defective Products - Mobile */}
        {tagFilter === 'defective' && defectiveReady && (
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
                    {selectedDefectiveProducts.size} barcode(s) selected
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
        {tagFilter === 'defective' && !defectiveReady ? (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            Select a supplier to view defective products.
          </div>
        ) : filteredProducts.length > 0 ? filteredProducts.map((product: any, productIndex: number) => {
          // Determine status - only show stock status for fresh (new) products
          // Determine status - show stock/tag status as clickable badge to change barcode tags (mobile view)
          let statusBadge;
          if (tagFilter === 'new') {
            // Check if product has no barcodes (not purchased yet)
            const hasBarcodes = product.barcodes && product.barcodes.length > 0;
            const hasStock = (product.barcodeCount || 0) > 0 || (Number(product.stock_quantity) || 0) > 0;

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

          const hasLabels = productHasStockForLabels(product) || (product.barcodes && product.barcodes.length > 0);
          const status = labelStatuses[product.id];
          const isGenerating = generatingLabelsFor === product.id || (status?.generating);
          const allGenerated = status?.all_generated;

          return (
            <div key={product.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
              <div className="px-4 py-3">
                {/* Row 1: Product name, status, and stock */}
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-xs font-medium text-gray-500 tabular-nums mt-1 flex-shrink-0 w-5">
                      {productIndex + 1}.
                    </span>
                    <Package className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900 text-base break-words leading-tight" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>{product.name}</h4>
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
                      {renderProductImageAction(product, true)}
                      {hasLabels && (
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
                              onClick={() => handleLabelButtonClick(product)}
                              className="flex items-center justify-center w-7 h-7 text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                              title="Print Labels"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleLabelButtonClick(product)}
                              className="flex items-center justify-center w-7 h-7 text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                              title={status ? 'Generate Labels' : 'Print or generate labels'}
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
                      {renderProductImageAction(product, true)}
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
                      {renderProductImageAction(product, true)}
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
                      {renderProductImageAction(product, true)}
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
                      {renderProductImageAction(product, true)}
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
                    <>
                      {renderProductImageAction(product, true)}
                      {!product?.image && <span className="text-xs text-gray-400">-</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            {productsList.length === 0
              ? listEmptyMessage
              : tagFilter === 'new' && (activeStockTab === 'low' || stockStatusFilter === 'low_stock')
                ? 'No products match the "Low Stock" filter.'
                : tagFilter === 'new' && (activeStockTab === 'out' || stockStatusFilter === 'out_of_stock')
                  ? 'No products match the "Out of Stock" filter.'
                  : `No products found with tag "${tagFilter === 'new' ? 'Fresh (New)' : tagFilter === 'sold' ? 'Sold' : tagFilter === 'unknown' ? 'Unknown' : tagFilter === 'returned' ? 'Returned' : tagFilter === 'defective' ? 'Defective' : tagFilter === 'in-cart' ? 'In Cart' : tagFilter}"`}
          </div>
        )}
        {hasMoreProducts && (
          <div className="flex justify-center py-3">
            <Button variant="outline" onClick={() => setCurrentPage((p) => p + 1)} disabled={isFetching}>
              {isFetching ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </div>

      {showExportModal && (
        <ProductExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          fetchProducts={fetchAllProductsForExport}
          tagFilter={tagFilter}
          filterLabels={exportFilterLabels}
          visibleCount={filteredProducts.length}
        />
      )}

      {showForm && (
        <ProductForm
          productId={editingProduct}
          onClose={() => { setShowForm(false); setEditingProduct(undefined); }}
          onProductCreated={() => {
            // Invalidate and refetch products to show new product immediately
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.refetchQueries({ queryKey: ['products'] });
            // Close the modal
            setShowForm(false);
            setEditingProduct(undefined);
          }}
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
                {adjustingProduct ? (() => {
                  const p = allProducts.find((p: any) => p.id === adjustingProduct);
                  const name = p?.name || 'Unknown';
                  const color = getProductNameColor(name);
                  return <span style={color ? { color } : undefined}>{name}</span>;
                })() : 'Select product'}
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

      {productImagePreview && (
        <Modal
          isOpen={Boolean(productImagePreview)}
          onClose={() => setProductImagePreview(null)}
          title={productImagePreview.title}
          size="lg"
        >
          <div className="flex justify-center p-1">
            <img
              src={productImagePreview.src}
              alt=""
              className="max-h-[72vh] w-auto max-w-full rounded-md object-contain"
            />
          </div>
        </Modal>
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

      <Modal
        isOpen={showBarcodeStatusTool}
        onClose={() => {
          setShowBarcodeStatusTool(false);
          setStatusLookupInput('');
          setBulkStatusInput('');
          setStatusUpdateTag('');
          setStatusLookupError(null);
          setScannedStatusRows([]);
        }}
        title="Barcode Status Update"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Scan fresh inventory barcodes and set status to Defective to remove them from available stock (no sale required).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Scan / Enter Barcode or Short Code</label>
              <Input
                value={statusLookupInput}
                onChange={(e) => setStatusLookupInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSingleStatusLookup();
                  }
                }}
                placeholder="Scan one code and press Enter"
              />
            </div>
            <Button type="button" onClick={addSingleStatusLookup}>
              Add Code
            </Button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bulk Scan / Paste (comma, space, or newline separated)</label>
            <textarea
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows={4}
              value={bulkStatusInput}
              onChange={(e) => setBulkStatusInput(e.target.value)}
              placeholder="Paste multiple barcodes/short codes"
            />
            <div className="mt-2 flex justify-end">
              <Button type="button" variant="outline" onClick={addBulkStatusLookups}>
                Add Bulk Codes
              </Button>
            </div>
          </div>

          {statusLookupError && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              {statusLookupError}
            </div>
          )}

          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700">
              Scanned Items ({scannedStatusRows.length})
            </div>
            {scannedStatusRows.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No barcodes scanned yet.</div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {scannedStatusRows.map((row: any) => (
                  <div key={row.barcodeId} className="px-3 py-2 border-b last:border-b-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{row.productName}</div>
                      <div className="text-xs text-gray-600">
                        {row.barcode} {row.shortCode ? `(${row.shortCode})` : ''} {row.sku ? `• SKU: ${row.sku}` : ''}
                      </div>
                      <div className="text-xs text-gray-700 mt-0.5">
                        Current: {getReadableTagLabel(row.currentTag)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeScannedStatusRow(row.barcodeId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Set New Status For All Scanned Items</label>
              <Select
                value={statusUpdateTag}
                onChange={(e) => setStatusUpdateTag(e.target.value)}
              >
                <option value="">Select target status</option>
                <option value="new">Fresh (New)</option>
                <option value="unknown">Unknown</option>
                <option value="defective">Defective</option>
              </Select>
            </div>
            <Button
              type="button"
              onClick={handleApplyBulkStatus}
              disabled={bulkStatusUpdateMutation.isPending || !statusUpdateTag || scannedStatusRows.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {bulkStatusUpdateMutation.isPending ? 'Updating...' : 'Apply Status'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={tagFilter === 'defective' && !defectiveScopeReady}
        onClose={() => {}}
        title="Filter defective products?"
        size="md"
        closeOnBackdropClick={false}
        hideCloseButton
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Select a supplier to view defective products. This keeps the list small and fast.
          </p>
          <Select
            value={pendingDefectiveSupplier}
            onChange={(e) => setPendingDefectiveSupplier(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">Select a supplier</option>
            {supplierOptions.map((supplier: any) => (
              <option key={supplier.id} value={supplier.id.toString()}>{supplier.name}</option>
            ))}
          </Select>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/defective-move-outs')}
              className="flex items-center justify-center gap-2"
            >
              <FileText className="h-4 w-4" />
              Go to Move-Outs
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pendingDefectiveSupplier) return;
                setSupplierFilter(pendingDefectiveSupplier);
                setDefectiveScopeReady(true);
                setCurrentPage(1);
                setLoadedProducts([]);
              }}
              disabled={!pendingDefectiveSupplier}
            >
              View this supplier
            </Button>
          </div>
        </div>
      </Modal>

      {/* Move Out Modal for Defective Products */}
      {showMoveOutModal && (
        <Modal
          isOpen={showMoveOutModal}
          onClose={() => {
            setShowMoveOutModal(false);
            setMoveOutData({ reason: 'return_to_supplier', notes: '' });
            setMoveOutMode('new');
            setSelectedExistingMoveOutId(null);
          }}
          title="Move Out Defective Products"
          size="md"
        >
          <form onSubmit={handleMoveOutSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selected Barcodes
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm">
                {selectedDefectiveProducts.size} barcode(s) selected
              </div>
            </div>

            {/* Choose: add to existing or create new */}
            {existingMoveOuts.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Add to existing move-out or create new?
                </label>
                <div className="flex gap-4 mb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="moveOutMode"
                      value="existing"
                      checked={moveOutMode === 'existing'}
                      onChange={() => setMoveOutMode('existing')}
                      className="text-blue-600"
                    />
                    <span className="text-sm">Add to existing</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="moveOutMode"
                      value="new"
                      checked={moveOutMode === 'new'}
                      onChange={() => { setMoveOutMode('new'); setSelectedExistingMoveOutId(null); }}
                      className="text-blue-600"
                    />
                    <span className="text-sm">Create new</span>
                  </label>
                </div>

                {moveOutMode === 'existing' && (
                  <Select
                    value={selectedExistingMoveOutId?.toString() || ''}
                    onChange={(e) => setSelectedExistingMoveOutId(e.target.value ? Number(e.target.value) : null)}
                    required
                  >
                    <option value="">Select a move-out...</option>
                    {existingMoveOuts.map((mo: any) => (
                      <option key={mo.id} value={mo.id}>
                        {(mo.move_out_number || '').split('-').pop()} — {mo.customer_name || 'Unknown'} ({mo.total_items} items, {mo.reason_display})
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}

            {/* Show reason/notes only for new move-outs */}
            {moveOutMode === 'new' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason
                  </label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900">
                    Return to Supplier
                  </div>
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
              </>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowMoveOutModal(false);
                  setMoveOutData({ reason: 'return_to_supplier', notes: '' });
                  setMoveOutMode('new');
                  setSelectedExistingMoveOutId(null);
                }}
                disabled={moveOutDefectiveMutation.isPending || addToMoveOutMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={moveOutDefectiveMutation.isPending || addToMoveOutMutation.isPending || (moveOutMode === 'existing' && !selectedExistingMoveOutId)}
              >
                {(moveOutDefectiveMutation.isPending || addToMoveOutMutation.isPending)
                  ? (moveOutMode === 'existing' ? 'Adding...' : 'Creating...')
                  : (moveOutMode === 'existing' ? 'Add to Move-Out' : 'Create Move-Out')}
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
    // Only allow transitions: unknown -> returned/defective, returned/defective/in-cart -> new
    if (currentTag === 'unknown') {
      return ['returned', 'defective'];
    }
    if (currentTag === 'returned' || currentTag === 'defective' || currentTag === 'in-cart') {
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

            {/* Quick action for returned/defective/in-cart products - mark all as fresh */}
            {(tagFilter === 'returned' || tagFilter === 'defective' || tagFilter === 'in-cart') && barcodes.length > 0 && (
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
                        <div className="text-sm text-gray-700 font-mono">{barcode.short_code || barcode.barcode}</div>
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
                {selectedBarcodeForTagChange.short_code || selectedBarcodeForTagChange.barcode}
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
