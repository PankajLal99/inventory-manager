import { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { purchasingApi, productsApi } from '../../lib/api';
import { formatNumber, toLocalDateString, getProductNameColor } from '../../lib/utils';
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
import { Plus, Edit, Trash2, FileText, UserPlus, Filter, Search, X, Printer, Loader2, RotateCcw, Store } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import ProductForm from '../products/ProductForm';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import DatePicker from '../../components/ui/DatePicker';
import PurchaseStockModal from './PurchaseStockModal';

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

const PURCHASES_PAGE_LIMIT = 15;

function parsePurchasesPageMeta(payload: unknown): {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
} | null {
  const d = payload as Record<string, unknown> | null;
  if (!d) return null;
  if (d.data && typeof d.data === 'object' && d.data !== null && 'count' in (d.data as object)) {
    const inner = d.data as Record<string, unknown>;
    return {
      currentPage: Number(inner.page) || 1,
      totalPages: Number(inner.total_pages) || 1,
      totalItems: Number(inner.count) || 0,
      pageSize: Number(inner.page_size) || PURCHASES_PAGE_LIMIT,
    };
  }
  if ('count' in d) {
    return {
      currentPage: Number(d.page) || 1,
      totalPages: Number(d.total_pages) || 1,
      totalItems: Number(d.count) || 0,
      pageSize: Number(d.page_size) || PURCHASES_PAGE_LIMIT,
    };
  }
  return null;
}

/** Map all purchase rows from useInfiniteQuery `data.pages` into one list (dedupe by id). */
function flattenPurchasesPages(pages: unknown[] | undefined): any[] {
  if (!pages?.length) return [];
  const out: any[] = [];
  const seen = new Set<number>();
  for (const page of pages) {
    let chunk: any[] = [];
    const p = page as Record<string, unknown>;
    if (p?.data && Array.isArray((p.data as Record<string, unknown>).results)) {
      chunk = (p.data as { results: any[] }).results;
    } else if (Array.isArray(p?.results)) {
      chunk = p.results as any[];
    } else if (Array.isArray(p?.data)) {
      chunk = p.data as any[];
    } else if (Array.isArray(page)) {
      chunk = page as any[];
    }
    for (const row of chunk) {
      const id = row?.id;
      if (typeof id === 'number') {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
    }
  }
  return out;
}

function updatePrintedInPurchasesInfiniteCache(old: unknown, itemId: number, printed: boolean): unknown {
  if (!old || typeof old !== 'object' || !('pages' in old)) return old;
  const o = old as { pages: unknown[]; pageParams?: unknown[] };
  const newPages = o.pages.map((page) => {
    const updated = JSON.parse(JSON.stringify(page));
    const rec = updated as Record<string, unknown>;
    const results = (rec.data as Record<string, unknown>)?.results ?? rec.results;
    if (!Array.isArray(results)) return updated;
    for (const purchase of results as { items?: { id: number; printed?: boolean; printed_at?: string | null }[] }[]) {
      if (purchase.items) {
        for (const item of purchase.items) {
          if (item.id === itemId) {
            item.printed = printed;
            item.printed_at = printed ? new Date().toISOString() : null;
          }
        }
      }
    }
    return updated;
  });
  return { ...o, pages: newPages };
}

function clearPrintedFlagsInPurchasesInfiniteCache(old: unknown, purchaseId: number): unknown {
  if (!old || typeof old !== 'object' || !('pages' in old)) return old;
  const o = old as { pages: unknown[]; pageParams?: unknown[] };
  const newPages = o.pages.map((page) => {
    const updated = JSON.parse(JSON.stringify(page));
    const rec = updated as Record<string, unknown>;
    const results = (rec.data as Record<string, unknown>)?.results ?? rec.results;
    if (!Array.isArray(results)) return updated;
    for (const purchase of results as { id?: number; items?: { printed?: boolean; printed_at?: string | null }[] }[]) {
      if (purchase.id === purchaseId && purchase.items) {
        for (const item of purchase.items) {
          item.printed = false;
          item.printed_at = null;
        }
      }
    }
    return updated;
  });
  return { ...o, pages: newPages };
}

export default function Purchases() {
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRetailUser = userGroups.includes('Retail') && !userGroups.includes('Admin') && !userGroups.includes('RetailAdmin');
  const [searchParams, setSearchParams] = useSearchParams();
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get('supplier') || '');
  const [supplierFilterSearch, setSupplierFilterSearch] = useState(''); // For typable filter dropdown
  const [showSupplierFilterDropdown, setShowSupplierFilterDropdown] = useState(false);
  const [productFilter, setProductFilter] = useState(searchParams.get('product_filter') || '');
  const [productFilterSearch, setProductFilterSearch] = useState(''); // For typable filter dropdown
  const [showProductFilterDropdown, setShowProductFilterDropdown] = useState(false);
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [showForm, setShowForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<number | null>(null);
  const [editingPurchaseStatus, setEditingPurchaseStatus] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    supplier: '',
    purchase_date: toLocalDateString(new Date()),
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
  const productFilterRef = useRef<HTMLDivElement>(null);
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [checkingStatusFor, setCheckingStatusFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<string, { all_generated: boolean; generating: boolean }>>({});
  const [stockModalPurchse, setStockModalPurchase] = useState<any | null>(null);

  const purchasesInfiniteQueryKey = ['purchases', supplierFilter, productFilter, dateFrom, dateTo] as const;

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
        search_mode: 'name_only', // Search only by product name
        exclude_other_custom: 'true', // Exclude Other/Custom products from purchase add
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

  // Fetch products for product filter dropdown
  const { data: productFilterProductsData } = useQuery({
    queryKey: ['products', 'filter', productFilterSearch],
    queryFn: async () => {
      if (!productFilterSearch.trim()) return { results: [] };
      const response = await productsApi.list({
        search: productFilterSearch.trim(),
        tag: 'new',
        search_mode: 'name_only',
        exclude_other_custom: 'true', // Exclude Other/Custom products from purchase filter
      });
      return response.data;
    },
    enabled: productFilterSearch.trim().length > 0,
    retry: false,
  });

  const productFilterProducts = (() => {
    if (!productFilterProductsData) return [];
    if (Array.isArray(productFilterProductsData.results)) return productFilterProductsData.results;
    if (Array.isArray(productFilterProductsData.data)) return productFilterProductsData.data;
    if (Array.isArray(productFilterProductsData)) return productFilterProductsData;
    return [];
  })();

  // Sync URL params with state on mount
  useEffect(() => {
    const urlSupplier = searchParams.get('supplier') || '';
    const urlProduct = searchParams.get('product_filter') || '';
    const urlDateFrom = searchParams.get('date_from') || '';
    const urlDateTo = searchParams.get('date_to') || '';

    if (urlSupplier !== supplierFilter) setSupplierFilter(urlSupplier);
    if (urlProduct !== productFilter) setProductFilter(urlProduct);
    if (urlDateFrom !== dateFrom) setDateFrom(urlDateFrom);
    if (urlDateTo !== dateTo) setDateTo(urlDateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (productFilter) params.set('product_filter', productFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierFilter, productFilter, dateFrom, dateTo]);

  const {
    data: purchasesInfiniteData,
    isLoading: purchasesLoading,
    isError: purchasesError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: purchasesInfiniteQueryKey,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = {
        page: pageParam,
        limit: PURCHASES_PAGE_LIMIT,
      };
      if (supplierFilter) params.supplier = supplierFilter;
      if (productFilter) params.product = productFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await purchasingApi.purchases.list(params);
      return response.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const meta = parsePurchasesPageMeta(lastPage);
      if (!meta) return undefined;
      if (meta.currentPage < meta.totalPages) return meta.currentPage + 1;
      return undefined;
    },
    retry: false,
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

  // Preserve product ID when it's detected in URL (product param = add to new purchase, NOT product_filter = filter)
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
    onSuccess: async (response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });

      const createdPurchase = response?.data || response;
      const isDraft = createdPurchase?.status === 'draft' || variables?.status === 'draft';

      if (isDraft) {
        // Stay in form in edit mode so user can continue editing the draft
        setEditingPurchase(createdPurchase.id);
        setEditingPurchaseStatus('draft');
        setFormData({
          supplier: createdPurchase.supplier?.toString() || createdPurchase.supplier_id?.toString() || '',
          purchase_date: createdPurchase.purchase_date || formData.purchase_date,
          bill_number: createdPurchase.bill_number || '',
          notes: createdPurchase.notes || '',
        });
        const items = (createdPurchase?.items || []).map((item: any) => ({
          id: item.id,
          product: item.product,
          variant: item.variant || null,
          product_name: item.product_name,
          product_sku: item.product_sku,
          variant_name: item.variant_name || null,
          variant_sku: item.variant_sku || null,
          quantity: formatNumber(item.quantity, 3, false),
          unit_price: formatNumber(item.unit_price, 2, false),
          selling_price: item.selling_price ? formatNumber(item.selling_price, 2, false) : '',
          line_total: item.line_total,
          sold_count: item.sold_count || 0,
        }));
        setPurchaseItems(items);
        setSupplierSearch(createdPurchase.supplier_name || '');
        return;
      }

      setShowForm(false);
      const items = createdPurchase?.items || purchaseItems;
      if (items.length > 0) {
        const purchaseId = createdPurchase?.id ? parseInt(createdPurchase.id) : undefined;
        setTimeout(() => autoGenerateLabels(items, purchaseId), 1000);
      }
      resetForm();
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to create purchase');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => purchasingApi.purchases.update(id, data),
    onSuccess: async (response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });

      const updatedPurchase = response?.data || response;
      const isDraft = updatedPurchase?.status === 'draft' || variables?.data?.status === 'draft';

      if (isDraft) {
        // Stay in form so user can continue editing the draft
        return;
      }

      setShowForm(false);
      setEditingPurchase(null);
      setEditingPurchaseStatus(null);
      const items = updatedPurchase?.items || purchaseItems;
      if (items.length > 0) {
        const purchaseId = updatedPurchase?.id ? parseInt(updatedPurchase.id) : undefined;
        setTimeout(() => autoGenerateLabels(items, purchaseId), 1000);
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
      purchase_date: toLocalDateString(new Date()),
      bill_number: '',
      notes: '',
    });
    setPurchaseItems([]);
    setProductSearch('');
    setShowProductDropdown(false);
    setSupplierSearch('');
    setSupplierFilterInput('');
    setShowSupplierDropdown(false);
    setEditingPurchase(null);
    setEditingPurchaseStatus(null);
    addedProductForIdRef.current = null;
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
      setEditingPurchaseStatus(fullPurchase.status || null);
      setFormData({
        supplier: fullPurchase.supplier?.toString() || fullPurchase.supplier_id?.toString() || '',
        purchase_date: fullPurchase.purchase_date || toLocalDateString(new Date()),
        bill_number: fullPurchase.bill_number || '',
        notes: fullPurchase.notes || '',
      });

      // Convert items to form format; for draft, show empty string for 0 qty/price (placeholders)
      const isDraft = fullPurchase.status === 'draft';
      const items = (fullPurchase.items || []).map((item: any) => {
        const qty = item.quantity != null ? Number(item.quantity) : 0;
        const price = item.unit_price != null ? Number(item.unit_price) : 0;
        return {
          id: item.id,
          product: item.product,
          variant: item.variant || null,
          product_name: item.product_name,
          product_sku: item.product_sku,
          variant_name: item.variant_name || null,
          variant_sku: item.variant_sku || null,
          quantity: isDraft && qty === 0 ? '' : formatNumber(item.quantity, 3, false),
          unit_price: isDraft && price === 0 ? '' : formatNumber(item.unit_price, 2, false),
          selling_price: item.selling_price ? formatNumber(item.selling_price, 2, false) : '',
          line_total: item.line_total,
          sold_count: item.sold_count || 0,
        };
      });

      setPurchaseItems(items);
      setShowForm(true);

      // Auto-uncheck "Printed" for all items of this purchase while editing (update list cache)
      queryClient.setQueryData(purchasesInfiniteQueryKey, (old: unknown) =>
        clearPrintedFlagsInPurchasesInfiniteCache(old, fullPurchase.id)
      );
    } catch (error: any) {
      console.error('Error fetching purchase details:', error);
      alert(error?.response?.data?.message || 'Failed to load purchase details. Please try again.');
    }
  };

  const handleDelete = (id: number) => {
    if (
      confirm(
        'Archive this purchase? It will be hidden from lists; related data is kept. Non-sold barcodes from this purchase are archived; sold units stay linked for invoices.'
      )
    ) {
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

  const calculateTotalQty = () => {
    return purchaseItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent multiple submissions
    if (createMutation.isPending || updateMutation.isPending) {
      return;
    }

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
      if (editingPurchaseStatus === 'draft') {
        submitData.status = 'finalized'; // Finalize when saving from draft
      }
      updateMutation.mutate({ id: editingPurchase, data: submitData });
    } else {
      submitData.status = 'finalized'; // New purchase save = create as finalized
      createMutation.mutate(submitData);
    }
  };

  const handleSaveDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (createMutation.isPending || updateMutation.isPending) return;

    let supplierId = formData.supplier;
    if (!supplierId && supplierSearch.trim()) {
      const matchingSupplier = suppliers.find((supplier: any) =>
        supplier.name.toLowerCase() === supplierSearch.trim().toLowerCase()
      );
      if (matchingSupplier) {
        supplierId = matchingSupplier.id.toString();
        setFormData((prev) => ({ ...prev, supplier: supplierId }));
      } else {
        alert('Please select a valid supplier from the dropdown or create a new one.');
        return;
      }
    }
    if (!supplierId) {
      alert('Please select a supplier.');
      return;
    }

    // For draft: send ALL items so placeholders (no qty/price yet) are saved and reappear on edit
    if (editingPurchase) {
      for (const item of purchaseItems) {
        const quantity = parseInt(item.quantity) || 0;
        const soldCount = (item as any).sold_count || 0;
        if (quantity < soldCount) {
          const variantText = (item as any).variant_name ? ` (${(item as any).variant_name})` : '';
          alert(
            `Cannot set quantity for "${item.product_name || 'product'}${variantText}" below ${soldCount} (already sold).`
          );
          return;
        }
      }
    }

    const submitData: any = {
      supplier: parseInt(supplierId),
      purchase_date: formData.purchase_date,
      status: 'draft',
      items: purchaseItems.map((item) => {
        const itemData: any = {
          product: item.product,
          quantity: parseInt(item.quantity) || 0,
          unit_price: parseFloat(String(item.unit_price).trim() || '0') || 0,
        };
        if (item.variant) itemData.variant = item.variant;
        if (item.selling_price && String(item.selling_price).trim() !== '') {
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

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    try {
      let date: Date;
      const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, y, m, d] = match.map(Number);
        date = new Date(y, m - 1, d);
      } else {
        date = new Date(dateString);
      }
      if (isNaN(date.getTime())) return dateString;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return dateString;
    }
  };


  const handlePrintLabels = async (productId: number, purchaseId: number) => {
    try {
      const response = await productsApi.getLabels(productId, purchaseId);
      if (response.data && response.data.labels && response.data.labels.length > 0) {
        printLabelsFromResponse(response.data);
      } else {
        await triggerGenerateAndWait(productId, purchaseId);
      }
    } catch (error: any) {
      const backendMessage = (error?.response?.data?.error || error?.response?.data?.message || '').toString();
      if (backendMessage.toLowerCase().includes('no barcodes found')) {
        await triggerGenerateAndWait(productId, purchaseId);
        return;
      }
      alert(error?.response?.data?.error || 'Failed to print labels. Please try again.');
    }
  };

  const getLabelKey = (productId: number, purchaseId?: number) => `${productId}:${purchaseId ?? 'na'}`;

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const waitForLabelsToBeGenerated = async (
    productId: number,
    purchaseId: number,
    maxAttempts = 12,
    intervalMs = 3000
  ) => {
    const labelKey = getLabelKey(productId, purchaseId);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await productsApi.labelsStatus(productId, purchaseId);
        const data = response.data || {};
        const allGenerated = data.all_generated || false;

        queryClient.setQueryData(['label-status', productId, purchaseId], { productId, purchaseId, data, error: null });
        setLabelStatuses(prev => ({ ...prev, [labelKey]: { all_generated: allGenerated, generating: !allGenerated } }));

        if (allGenerated) return true;
      } catch {
        // Keep polling; generation can be eventually consistent.
      }
      await sleep(intervalMs);
    }
    return false;
  };

  const triggerGenerateAndWait = async (productId: number, purchaseId: number) => {
    const labelKey = getLabelKey(productId, purchaseId);
    setGeneratingLabelsFor(productId);
    setLabelStatuses(prev => ({ ...prev, [labelKey]: { all_generated: false, generating: true } }));
    try {
      // Prefer generate-labels for missing labels; regenerate-labels is for rebuilding existing ones.
      // Fallback to product-level generation if purchase linkage is missing in older data.
      try {
        await productsApi.generateLabels(productId, purchaseId);
      } catch (error: any) {
        const backendMessage = (error?.response?.data?.error || error?.response?.data?.message || '').toString().toLowerCase();
        if (backendMessage.includes('no barcodes found')) {
          await productsApi.generateLabels(productId);
        } else {
          throw error;
        }
      }
      const generated = await waitForLabelsToBeGenerated(productId, purchaseId);
      if (generated) {
        alert('Labels generated successfully. You can print now.');
      } else {
        alert('Label generation was triggered and is still processing. Please try Print in a few seconds.');
      }
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to trigger label generation';
      alert(errorMsg);
    } finally {
      setGeneratingLabelsFor(null);
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId, purchaseId] });
      await queryClient.invalidateQueries({ queryKey: ['label-status', productId] });
    }
  };

  const handleCheckLabelStatus = async (productId: number, purchaseId: number) => {
    setCheckingStatusFor(productId);
    const labelKey = getLabelKey(productId, purchaseId);
    try {
      const response = await productsApi.labelsStatus(productId, purchaseId);
      const data = response.data || {};
      const allGenerated = data.all_generated || false;
      const total = data.total_barcodes ?? 0;
      const generated = data.generated_labels ?? 0;
      queryClient.setQueryData(['label-status', productId, purchaseId], { productId, purchaseId, data, error: null });
      setLabelStatuses(prev => ({ ...prev, [labelKey]: { all_generated: allGenerated, generating: false } }));
      if (total > 0) {
        alert(`Status: ${generated} of ${total} label(s) generated.${allGenerated ? ' All ready to print.' : ''}`);
      } else {
        await triggerGenerateAndWait(productId, purchaseId);
      }
    } catch (error: any) {
      setLabelStatuses(prev => ({ ...prev, [labelKey]: { all_generated: false, generating: false } }));
      if (error?.response?.status === 404) {
        await triggerGenerateAndWait(productId, purchaseId);
      } else {
        alert(error?.response?.data?.error || 'Failed to check label status.');
      }
    } finally {
      setCheckingStatusFor(null);
    }
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
      const previousData = queryClient.getQueryData(purchasesInfiniteQueryKey);

      queryClient.setQueryData(purchasesInfiniteQueryKey, (old: unknown) =>
        updatePrintedInPurchasesInfiniteCache(old, itemId, printed)
      );

      // Return context with previous data for rollback
      return { previousData };
    },
    // On error, rollback to previous data
    onError: (error: any, _variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(purchasesInfiniteQueryKey, context.previousData);
      }
      alert(error?.response?.data?.error || 'Failed to update printed status. Please try again.');
    },
    // On success, don't invalidate - keep the optimistic update
    onSettled: () => {
      // Mark as stale but don't refetch to preserve optimistic update
      queryClient.invalidateQueries({
        queryKey: [...purchasesInfiniteQueryKey],
        refetchType: 'none',
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
      if (productFilterRef.current && !productFilterRef.current.contains(event.target as Node)) {
        setShowProductFilterDropdown(false);
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

  // Fetch selected product name for product filter display
  const { data: selectedProductForFilter } = useQuery({
    queryKey: ['product', productFilter],
    queryFn: () => productsApi.get(parseInt(productFilter)),
    enabled: !!productFilter,
    retry: false,
  });

  // Update product filter search when productFilter changes
  useEffect(() => {
    if (productFilter && selectedProductForFilter?.data) {
      setProductFilterSearch(selectedProductForFilter.data.name || '');
    } else if (!productFilter) {
      setProductFilterSearch('');
    }
  }, [productFilter, selectedProductForFilter?.data?.name]);

  const purchases = useMemo(
    () => flattenPurchasesPages(purchasesInfiniteData?.pages),
    [purchasesInfiniteData?.pages],
  );

  const purchasesListMeta = (() => {
    const pages = purchasesInfiniteData?.pages;
    if (!pages?.length) return null;
    return parsePurchasesPageMeta(pages[pages.length - 1]);
  })();

  // Max label-status queries to avoid tab crash when many purchases/items are on the page
  const MAX_LABEL_STATUS_QUERIES = 15;

  // Load only unprinted items and cap at MAX to keep this page light.
  const labelStatusQueriesData = useMemo(() => {
    if (!purchases || purchases.length === 0) return [];

    const seenKeys = new Set<string>();
    const unprinted: Array<{ productId: number; purchaseId?: number; labelKey: string }> = [];

    purchases.forEach((purchase: any) => {
      if (purchase.items && purchase.items.length > 0) {
        purchase.items.forEach((item: any) => {
          const productId = item.product;
          if (!productId || !item.product_track_inventory) return;
          const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
          const labelKey = getLabelKey(productId, purchaseId);
          if (seenKeys.has(labelKey)) return;
          seenKeys.add(labelKey);
          const entry = { productId, purchaseId, labelKey };
          if (!item.printed) unprinted.push(entry);
        });
      }
    });

    return unprinted.slice(0, MAX_LABEL_STATUS_QUERIES);
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

    // Batch all query results into one setState to avoid many re-renders
    const nextStatuses: Record<string, { all_generated: boolean; generating: boolean }> = {};
    let hasChanges = false;
    labelStatusQueries.forEach((query) => {
      const queryData = query.data as LabelStatusQueryData | undefined;
      if (queryData && queryData.labelKey) {
        const labelKey = queryData.labelKey;
        const all_generated = queryData.data?.all_generated || false;
        const generating = query.isFetching || false;
        nextStatuses[labelKey] = { all_generated, generating };
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setLabelStatuses(prev => {
        let changed = false;
        const next = { ...prev };
        for (const [key, val] of Object.entries(nextStatuses)) {
          const current = prev[key];
          if (current?.all_generated !== val.all_generated || current?.generating !== val.generating) {
            next[key] = val;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
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

  // Handle product filter selection
  const handleProductFilterSelect = (productId: string) => {
    setProductFilter(productId);
    const selectedProduct = productFilterProducts.find((p: any) => p.id.toString() === productId);
    setProductFilterSearch(selectedProduct?.name || '');
    setShowProductFilterDropdown(false);
  };

  // Early returns must come AFTER all hooks
  if (purchasesLoading && !purchasesInfiniteData) {
    return <LoadingState message="Loading purchases..." />;
  }

  if (purchasesError) {
    return (
      <ErrorState
        message="Error loading purchases. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <div className="relative" ref={productFilterRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                value={productFilterSearch}
                onChange={(e) => {
                  setProductFilterSearch(e.target.value);
                  setShowProductFilterDropdown(true);
                }}
                onFocus={() => {
                  setShowProductFilterDropdown(true);
                }}
                placeholder="Type to search products..."
                className="pl-10"
              />
              {showProductFilterDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  <div
                    onClick={() => {
                      setProductFilter('');
                      setProductFilterSearch('');
                      setShowProductFilterDropdown(false);
                    }}
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                  >
                    All Products
                  </div>
                  {productFilterProducts.length > 0 ? (
                    productFilterProducts.map((product: any) => (
                      <div
                        key={product.id}
                        onClick={() => handleProductFilterSelect(product.id.toString())}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      >
                        {product.name} {product.sku && `(${product.sku})`}
                      </div>
                    ))
                  ) : productFilterSearch.trim() ? (
                    <div className="px-4 py-2 text-gray-500 text-sm">No products found</div>
                  ) : (
                    <div className="px-4 py-2 text-gray-400 text-sm italic">Type to search products</div>
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
                          ₹{formatNumber(purchase.total || 0)}
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
                          {purchase.status === 'finalized' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setStockModalPurchase(purchase)}
                              className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            >
                              <Store className="h-4 w-4" />
                              <span>Stock</span>
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
                                    const labelKey = getLabelKey(productId, purchase.id);
                                    const labelStatus = labelStatuses[labelKey] || { all_generated: false, generating: false };

                                    return (
                                      <tr key={item.id || `${purchase.id} -item - ${idx} `}>
                                        <td className="px-3 py-2">
                                          <div className="text-sm font-medium text-gray-900" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>{item.product_name || '-'}</div>
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
                                          <span className="text-sm text-gray-900">₹{formatNumber(item.unit_price || 0)}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <span className="text-sm font-semibold text-gray-900">₹{formatNumber(item.line_total || 0)}</span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {trackInventory ? (
                                            <div className="flex items-center justify-center flex-wrap gap-1.5">
                                              {(() => {
                                                const isGenerating = generatingLabelsFor === productId || labelStatus.generating;
                                                const isChecking = checkingStatusFor === productId;
                                                const alreadyPrinted = item.printed;
                                                const allGenerated = alreadyPrinted || labelStatus.all_generated;

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
                                                        title="Get barcodes and open print dialog"
                                                      >
                                                        <Printer className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">Print</span>
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
                                                  <div className="flex items-center gap-1.5">
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => handleCheckLabelStatus(productId, purchase.id)}
                                                      disabled={isChecking || isGenerating}
                                                      className="flex items-center gap-1.5 text-gray-700 bg-gray-50 border-gray-200 hover:bg-gray-100"
                                                      title="Check label status via API"
                                                    >
                                                      {isChecking ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                      ) : (
                                                        <FileText className="h-3.5 w-3.5" />
                                                      )}
                                                      <span className="hidden sm:inline">{isChecking ? 'Checking...' : 'Check status'}</span>
                                                    </Button>
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => handlePrintLabels(productId, purchase.id)}
                                                      disabled={isGenerating}
                                                      className="flex items-center gap-1.5 text-green-700 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300"
                                                      title="Get barcodes and open print dialog"
                                                    >
                                                      <Printer className="h-3.5 w-3.5" />
                                                      <span className="hidden sm:inline">Get barcodes & Print</span>
                                                    </Button>
                                                  </div>
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
            <div className="flex flex-col items-center gap-2 py-4 border-t border-gray-100">
              {hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="min-w-[140px]"
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                      Loading…
                    </>
                  ) : (
                    'Load more'
                  )}
                </Button>
              ) : null}
              {purchases.length > 0 ? (
                <p className="text-xs text-gray-500">
                  Showing {purchases.length}
                  {purchasesListMeta?.totalItems != null
                    ? ` of ${purchasesListMeta.totalItems} purchases`
                    : ' purchases'}
                </p>
              ) : null}
            </div>
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
                        {purchase.status === 'finalized' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStockModalPurchase(purchase)}
                            className="p-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            title="Distribute stock"
                          >
                            <Store className="h-4 w-4" />
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
                          ₹{formatNumber(purchase.total || 0)}
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
                          const labelKey = getLabelKey(productId, purchase.id);
                          const labelStatus = labelStatuses[labelKey] || { all_generated: false, generating: false };

                          return (
                            <div key={item.id || `${purchase.id} -item - ${idx} `} className="bg-white rounded-md p-3 border border-gray-200">
                              <div className="flex justify-between items-start mb-1">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>{item.product_name || '-'}</div>
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
                                  <div className="font-semibold text-gray-900">₹{formatNumber(item.unit_price || 0)}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 mb-0.5">Total</div>
                                  <div className="font-semibold text-gray-900">₹{formatNumber(item.line_total || 0)}</div>
                                </div>
                              </div>
                              {trackInventory && (
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <div className="flex items-center justify-center">
                                    {(() => {
                                      const isGenerating = generatingLabelsFor === productId || labelStatus.generating;
                                      const isChecking = checkingStatusFor === productId;
                                      const alreadyPrinted = item.printed;
                                      const allGenerated = alreadyPrinted || labelStatus.all_generated;

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
                                              title="Get barcodes and open print dialog"
                                            >
                                              <Printer className="h-3.5 w-3.5" />
                                              <span>Get barcodes & Print</span>
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
                                        <div className="flex flex-col gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleCheckLabelStatus(productId, purchase.id)}
                                            disabled={isChecking || isGenerating}
                                            className="flex items-center gap-1.5 w-full text-gray-700 bg-gray-50 border-gray-200 hover:bg-gray-100"
                                            title="Check label status via API"
                                          >
                                            {isChecking ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <FileText className="h-3.5 w-3.5" />
                                            )}
                                            <span>{isChecking ? 'Checking...' : 'Check status'}</span>
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePrintLabels(productId, purchase.id)}
                                            disabled={isGenerating}
                                            className="flex items-center gap-1.5 w-full text-green-700 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300"
                                            title="Get barcodes and open print dialog"
                                          >
                                            <Printer className="h-3.5 w-3.5" />
                                            <span>Get barcodes & Print</span>
                                          </Button>
                                        </div>
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
            <div className="flex flex-col items-center gap-2 py-4">
              {hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="min-w-[140px]"
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                      Loading…
                    </>
                  ) : (
                    'Load more'
                  )}
                </Button>
              ) : null}
              {purchases.length > 0 ? (
                <p className="text-xs text-gray-500 text-center">
                  Showing {purchases.length}
                  {purchasesListMeta?.totalItems != null
                    ? ` of ${purchasesListMeta.totalItems} purchases`
                    : ' purchases'}
                </p>
              ) : null}
            </div>
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
          closeOnBackdropClick={false}
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
                            <div className="font-medium text-gray-900" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>{product.name}</div>
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
                                <div className="text-sm font-medium text-gray-900" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>{item.product_name || 'Product'}</div>
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
                                  ₹{formatNumber(item.line_total || 0)}
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
                            Total qty: {formatNumber(calculateTotalQty())} · Total:
                          </td>
                          <td colSpan={2} className="px-3 py-2 text-right text-sm font-bold text-gray-900">
                            ₹{formatNumber(calculateTotal())}
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
                              <div className="text-sm font-medium text-gray-900" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>{item.product_name || 'Product'}</div>
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
                                ₹{formatNumber(item.line_total || 0)}
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
                    <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Total qty:</span>
                        <span className="text-sm font-semibold text-gray-900">{formatNumber(calculateTotalQty())}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Total:</span>
                        <span className="text-lg font-bold text-gray-900">₹{formatNumber(calculateTotal())}</span>
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

            <div className="flex justify-end flex-wrap gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                Cancel
              </Button>
              {(editingPurchaseStatus === 'draft' || !editingPurchase) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={createMutation.isPending || updateMutation.isPending || !formData.supplier}
                >
                  {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save as draft'}
                </Button>
              )}
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  purchaseItems.length === 0 ||
                  (!formData.supplier && !supplierSearch.trim())
                }
              >
                {(createMutation.isPending || updateMutation.isPending)
                  ? 'Saving...'
                  : editingPurchaseStatus === 'draft'
                    ? 'Finalize purchase'
                    : 'Save Purchase'}
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
          closeOnBackdropClick={false}
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

      {/* Stock Redistribution Modal */}
      {stockModalPurchse && (
        <PurchaseStockModal
          isOpen={!!stockModalPurchse}
          purchase={stockModalPurchse}
          onClose={() => setStockModalPurchase(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['purchases'] });
            setStockModalPurchase(null);
          }}
        />
      )}
    </div>
  );
}
