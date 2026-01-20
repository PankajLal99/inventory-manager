import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { Plus } from 'lucide-react';

interface ProductFormProps {
  productId?: number;
  onClose: () => void;
  onProductCreated?: (product: any) => void;
  initialName?: string;
}

export default function ProductForm({ productId, onClose, onProductCreated, initialName }: ProductFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: initialName || '',
    category: '',
    brand: '',
    description: '',
    low_stock_threshold: '0',
    track_inventory: true,
    can_go_below_purchase_price: false,
  });
  const [categorySearch, setCategorySearch] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(''); // Separate filter for dropdown
  const [brandFilter, setBrandFilter] = useState(''); // Separate filter for dropdown
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const categoryRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);

  const { data: product } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId!),
    enabled: !!productId,
    retry: false,
  });

  const { data: categoriesResponse, error: categoriesError, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data || response;
    },
    retry: false,
  });

  const { data: brandsResponse, error: brandsError, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data || response;
    },
    retry: false,
  });

  // Handle different response formats: array, { data: [...] }, or { results: [...] }
  const categories = (() => {
    if (!categoriesResponse) return [];
    if (Array.isArray(categoriesResponse)) return categoriesResponse;
    if (Array.isArray(categoriesResponse.data)) return categoriesResponse.data;
    if (Array.isArray(categoriesResponse.results)) return categoriesResponse.results;
    return [];
  })();

  const brands = (() => {
    if (!brandsResponse) return [];
    if (Array.isArray(brandsResponse)) return brandsResponse;
    if (Array.isArray(brandsResponse.data)) return brandsResponse.data;
    if (Array.isArray(brandsResponse.results)) return brandsResponse.results;
    return [];
  })();

  // Filter categories and brands based on filter (not search - search is for display)
  const filteredCategories = categories.filter((cat: any) =>
    cat.name.toLowerCase().includes(categoryFilter.toLowerCase())
  );
  const filteredBrands = brands.filter((brand: any) =>
    brand.name.toLowerCase().includes(brandFilter.toLowerCase())
  );

  // Check if filter value exists (for creating new items)
  const categoryExists = categories.some((cat: any) =>
    cat.name.toLowerCase() === categoryFilter.toLowerCase()
  );
  const brandExists = brands.some((brand: any) =>
    brand.name.toLowerCase() === brandFilter.toLowerCase()
  );

  // Category creation mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await catalogApi.categories.create({ name });
      return response.data || response;
    },
    onSuccess: (newCategory) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      // Use functional update to ensure we have the latest formData
      setFormData((prev) => ({ ...prev, category: newCategory.id.toString() }));
      setCategorySearch(newCategory.name);
      setCategoryFilter(''); // Clear filter
      setShowCategoryDropdown(false);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.name?.[0] ||
        error?.response?.data?.detail ||
        'Failed to create category';
      alert(errorMsg);
    },
  });

  // Brand creation mutation
  const createBrandMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await catalogApi.brands.create({ name });
      return response.data || response;
    },
    onSuccess: (newBrand) => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      // Use functional update to ensure we have the latest formData
      setFormData((prev) => ({ ...prev, brand: newBrand.id.toString() }));
      setBrandSearch(newBrand.name);
      setBrandFilter(''); // Clear filter
      setShowBrandDropdown(false);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.name?.[0] ||
        error?.response?.data?.detail ||
        'Failed to create brand';
      alert(errorMsg);
    },
  });

  // Handle category selection
  const handleCategorySelect = (categoryId: string) => {
    setFormData((prev) => ({ ...prev, category: categoryId }));
    const selectedCategory = categories.find((cat: any) => cat.id.toString() === categoryId);
    setCategorySearch(selectedCategory?.name || '');
    setCategoryFilter(''); // Clear filter when selecting
    setShowCategoryDropdown(false);
  };

  // Handle brand selection
  const handleBrandSelect = (brandId: string) => {
    setFormData((prev) => ({ ...prev, brand: brandId }));
    const selectedBrand = brands.find((brand: any) => brand.id.toString() === brandId);
    setBrandSearch(selectedBrand?.name || '');
    setBrandFilter(''); // Clear filter when selecting
    setShowBrandDropdown(false);
  };

  // Handle creating new category
  const handleCreateCategory = () => {
    if (categoryFilter.trim() && !categoryExists) {
      createCategoryMutation.mutate(categoryFilter.trim());
    }
  };

  // Handle creating new brand
  const handleCreateBrand = () => {
    if (brandFilter.trim() && !brandExists) {
      createBrandMutation.mutate(brandFilter.trim());
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (brandRef.current && !brandRef.current.contains(event.target as Node)) {
        setShowBrandDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update formData when product loads (for edit mode)
  useEffect(() => {
    if (product?.data) {
      const productData = product.data;
      // Convert category and brand to strings, handling both number and object formats
      const categoryId = productData.category
        ? (typeof productData.category === 'object' ? productData.category.id : productData.category)
        : null;
      const brandId = productData.brand
        ? (typeof productData.brand === 'object' ? productData.brand.id : productData.brand)
        : null;

      setFormData({
        name: productData.name || '',
        category: categoryId ? categoryId.toString() : '',
        brand: brandId ? brandId.toString() : '',
        description: productData.description || '',
        low_stock_threshold: productData.low_stock_threshold?.toString() || '0',
        track_inventory: productData.track_inventory !== undefined ? productData.track_inventory : true,
        can_go_below_purchase_price: productData.can_go_below_purchase_price || false,
      });
    } else if (initialName && !productId) {
      // If we have an initial name and we're creating (not editing), set it
      setFormData(prev => ({ ...prev, name: initialName }));
    }
  }, [product, initialName, productId]);

  // Update search fields when formData changes AND categories/brands are loaded (for edit mode)
  useEffect(() => {
    if (formData.category && categories.length > 0) {
      const selectedCategory = categories.find((cat: any) =>
        cat.id.toString() === formData.category.toString()
      );
      if (selectedCategory) {
        setCategorySearch(selectedCategory.name);
      } else {
        // If category not found, clear search to show it's not selected
        setCategorySearch('');
      }
    } else if (!formData.category) {
      setCategorySearch('');
    }
  }, [formData.category, categories]);

  useEffect(() => {
    if (formData.brand && brands.length > 0) {
      const selectedBrand = brands.find((brand: any) =>
        brand.id.toString() === formData.brand.toString()
      );
      if (selectedBrand) {
        setBrandSearch(selectedBrand.name);
      } else {
        // If brand not found, clear search to show it's not selected
        setBrandSearch('');
      }
    } else if (!formData.brand) {
      setBrandSearch('');
    }
  }, [formData.brand, brands]);

  const mutation = useMutation({
    mutationFn: (data: any) =>
      productId ? productsApi.update(productId, data) : productsApi.create(data),
    onSuccess: (response) => {
      // Invalidate all product-related queries across the application
      // This ensures all pages (Products, POS, Purchases, Reports, etc.) refresh with updated data
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Main products list
      queryClient.invalidateQueries({ queryKey: ['product-barcodes'] }); // Product barcodes
      queryClient.invalidateQueries({ queryKey: ['label-status'] }); // Label status
      queryClient.invalidateQueries({ queryKey: ['top-products'] }); // Reports

      // Invalidate the individual product query cache when editing
      if (productId) {
        queryClient.invalidateQueries({ queryKey: ['product', productId] });
      }

      // Refetch the main products list to update the UI immediately
      queryClient.refetchQueries({ queryKey: ['products'] });

      // If callback is provided, call it with the created/updated product
      if (onProductCreated) {
        const product = response?.data || response;
        onProductCreated(product);
        // Don't call onClose here - let the callback handle it
      } else {
        onClose();
        if (!productId) navigate('/products');
      }
    },
    onError: (error: any) => {

      let errorMessage = 'Failed to save product.';

      if (error?.response?.data) {
        const errorData = error.response.data;

        // Handle Django REST Framework validation errors
        if (typeof errorData === 'object') {
          const errorFields = Object.keys(errorData);
          const errorMessages: string[] = [];

          errorFields.forEach(field => {
            const fieldErrors = errorData[field];
            if (Array.isArray(fieldErrors)) {
              errorMessages.push(`${field}: ${fieldErrors.join(', ')}`);
            } else if (typeof fieldErrors === 'string') {
              errorMessages.push(`${field}: ${fieldErrors}`);
            } else if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
              errorMessages.push(`${field}: ${fieldErrors[0]}`);
            }
          });

          if (errorMessages.length > 0) {
            errorMessage = errorMessages.join('\n');
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }

      alert(errorMessage);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent submission if category or brand creation is in progress
    if (createCategoryMutation.isPending || createBrandMutation.isPending) {
      alert('Please wait for category/brand creation to complete before submitting.');
      return;
    }

    // Check if category search matches an existing category but formData.category is not set
    let categoryId = formData.category;
    if (!categoryId && categorySearch.trim()) {
      const matchingCategory = categories.find((cat: any) =>
        cat.name.toLowerCase() === categorySearch.trim().toLowerCase()
      );
      if (matchingCategory) {
        categoryId = matchingCategory.id.toString();
        // Update formData to ensure consistency
        setFormData((prev) => ({ ...prev, category: categoryId }));
      }
    }

    // Check if brand search matches an existing brand but formData.brand is not set
    let brandId = formData.brand;
    if (!brandId && brandSearch.trim()) {
      const matchingBrand = brands.find((brand: any) =>
        brand.name.toLowerCase() === brandSearch.trim().toLowerCase()
      );
      if (matchingBrand) {
        brandId = matchingBrand.id.toString();
        // Update formData to ensure consistency
        setFormData((prev) => ({ ...prev, brand: brandId }));
      }
    }

    const baseData: any = {
      name: formData.name.trim(),
      description: (formData.description || '').trim(),
      low_stock_threshold: parseInt(formData.low_stock_threshold) || 0,
      track_inventory: formData.track_inventory,
      can_go_below_purchase_price: formData.can_go_below_purchase_price,
    };

    // Products are created without quantity - quantity comes from purchases

    // Convert category and brand to integers if they have values
    if (categoryId && categoryId !== '') {
      baseData.category = parseInt(categoryId);
    } else {
      baseData.category = null;
    }

    if (brandId && brandId !== '') {
      baseData.brand = parseInt(brandId);
    } else {
      baseData.brand = null;
    }

    mutation.mutate(baseData);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={productId ? 'Edit Product' : 'Add Product'} size="wide">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        {/* Product Name - Full Width */}
        <div>
          <Input
            label="Product Name *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            disabled={false}
            placeholder="Enter product name"
            className="w-full"
          />
        </div>

        {/* Category and Brand - Mobile: Stacked, Desktop: Side by Side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="relative" ref={categoryRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
            <div className="relative">
              <Input
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  setCategoryFilter(e.target.value); // Update filter for dropdown
                  setShowCategoryDropdown(true);
                }}
                onFocus={() => {
                  setCategoryFilter(''); // Clear filter to show all items when opening
                  setShowCategoryDropdown(true);
                }}
                placeholder={categoriesLoading ? 'Loading...' : 'Type to search or add category'}
                disabled={categoriesLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && categoryFilter.trim() && !categoryExists) {
                    e.preventDefault();
                    handleCreateCategory();
                  }
                }}
                className="w-full"
              />
              {showCategoryDropdown && !categoriesLoading && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {filteredCategories.length > 0 ? (
                    filteredCategories.map((cat: any) => (
                      <div
                        key={cat.id}
                        onClick={() => handleCategorySelect(cat.id.toString())}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      >
                        {cat.name}
                      </div>
                    ))
                  ) : categoryFilter.trim() && !categoryExists ? (
                    <div
                      onClick={handleCreateCategory}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex items-center text-blue-600 text-sm"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add "{categoryFilter}"
                    </div>
                  ) : (
                    <div className="px-4 py-2 text-gray-500 text-sm">No categories found</div>
                  )}
                </div>
              )}
            </div>
            {categoriesError && (
              <p className="text-xs text-red-500 mt-1">Error loading categories</p>
            )}
            {createCategoryMutation.isPending && (
              <p className="text-xs text-blue-500 mt-1">Creating category...</p>
            )}
          </div>
          <div className="relative" ref={brandRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Brand</label>
            <div className="relative">
              <Input
                value={brandSearch}
                onChange={(e) => {
                  setBrandSearch(e.target.value);
                  setBrandFilter(e.target.value); // Update filter for dropdown
                  setShowBrandDropdown(true);
                }}
                onFocus={() => {
                  setBrandFilter(''); // Clear filter to show all items when opening
                  setShowBrandDropdown(true);
                }}
                placeholder={brandsLoading ? 'Loading...' : 'Type to search or add brand'}
                disabled={brandsLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && brandFilter.trim() && !brandExists) {
                    e.preventDefault();
                    handleCreateBrand();
                  }
                }}
                className="w-full"
              />
              {showBrandDropdown && !brandsLoading && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {filteredBrands.length > 0 ? (
                    filteredBrands.map((brand: any) => (
                      <div
                        key={brand.id}
                        onClick={() => handleBrandSelect(brand.id.toString())}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                      >
                        {brand.name}
                      </div>
                    ))
                  ) : brandFilter.trim() && !brandExists ? (
                    <div
                      onClick={handleCreateBrand}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex items-center text-blue-600 text-sm"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add "{brandFilter}"
                    </div>
                  ) : (
                    <div className="px-4 py-2 text-gray-500 text-sm">No brands found</div>
                  )}
                </div>
              )}
            </div>
            {brandsError && (
              <p className="text-xs text-red-500 mt-1">Error loading brands</p>
            )}
            {createBrandMutation.isPending && (
              <p className="text-xs text-blue-500 mt-1">Creating brand...</p>
            )}
          </div>
        </div>

        {/* Low Stock Threshold - Mobile: Full Width, Desktop: Half Width */}
        {!productId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Low Stock Threshold"
              type="number"
              min="0"
              value={formData.low_stock_threshold}
              onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
              placeholder="0"
              className="w-full"
            />
          </div>
        )}

        {/* Checkboxes - Stacked */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              id="track_inventory"
              checked={formData.track_inventory}
              onChange={(e) => setFormData({ ...formData, track_inventory: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
            />
            <label htmlFor="track_inventory" className="ml-3 block text-sm font-medium text-gray-700 cursor-pointer flex-1">
              Track Inventory
            </label>
          </div>
          <div className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              id="can_go_below_purchase_price"
              checked={formData.can_go_below_purchase_price}
              onChange={(e) => setFormData({ ...formData, can_go_below_purchase_price: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
            />
            <label htmlFor="can_go_below_purchase_price" className="ml-3 block text-sm font-medium text-gray-700 cursor-pointer flex-1">
              Can go below Purchase Price
            </label>
          </div>
        </div>

        {/* Description - Full Width */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
          <textarea
            className="block w-full px-3 py-2.5 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-sm"
            rows={4}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Enter product description (optional)"
          />
        </div>

        {/* Info Message - Full Width */}
        {!productId && (
          <div className="flex items-center justify-center py-3 px-4 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="inline-flex items-center text-sm font-medium text-blue-800">
              <span className="mr-2">ℹ️</span>
              SKU will be auto-generated. Quantity will be added when you create a purchase.
            </span>
          </div>
        )}

        {/* Action Buttons - Mobile: Stacked, Desktop: Side by Side */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full sm:w-auto order-1 sm:order-2"
          >
            {mutation.isPending ? 'Saving...' : productId ? 'Update Product' : 'Create Product'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

