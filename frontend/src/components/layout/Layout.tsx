import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth } from '../../lib/auth';
import { productsApi } from '../../lib/api';
import BarcodeScanner from '../BarcodeScanner';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import PrintSettingsModal from '../PrintSettings';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Menu,
  X,
  LogOut,
  ShoppingBag,
  Search,
  Bell,
  User,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Settings,
  FileText,
  History,
  BarChart3,
  RefreshCw,
  BookOpen,
  ScanLine,
  Loader2,
  ExternalLink,
  Wrench,
  Receipt,
} from 'lucide-react';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Load collapsed state from localStorage
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved === 'true';
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState(auth.getUser());
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [_searchSelectedIndex, _setSearchSelectedIndex] = useState(-1);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', sidebarCollapsed.toString());
  }, [sidebarCollapsed]);

  useEffect(() => {
    // Load user on mount
    const loadUser = async () => {
      if (auth.isAuthenticated()) {
        try {
          const loadedUser = await auth.loadUser();
          setUser(loadedUser);
        } catch (error) {
          // If loading fails, redirect to login
          navigate('/login');
        }
      }
    };
    loadUser();
  }, [navigate]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.user-menu-container')) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  const handleBarcodeScan = async (barcode: string) => {
    setIsLoadingProduct(true);
    setScanError(null);
    setScannedProduct(null);

    try {
      const response = await productsApi.byBarcode(barcode);
      setScannedProduct(response.data);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.response?.data?.error || 'Product not found';
      setScanError(errorMessage);
    } finally {
      setIsLoadingProduct(false);
    }
  };

  const handleSearch = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    setScanError(null);
    setSearchResults(null);

    try {
      // Try to find by barcode/SKU using the byBarcode API
      const response = await productsApi.byBarcode(trimmedQuery);
      setSearchResults(response.data);
    } catch (error: any) {
      // If barcode search fails, try product search
      try {
        const searchResponse = await productsApi.list({ search: trimmedQuery });
        const searchData = searchResponse.data || searchResponse;
        let products: any[] = [];
        if (Array.isArray(searchData.results)) {
          products = searchData.results;
        } else if (Array.isArray(searchData.data)) {
          products = searchData.data;
        } else if (Array.isArray(searchData)) {
          products = searchData;
        }

        // If we found products, use the first one
        if (products.length > 0) {
          setSearchResults(products[0]);
        } else {
          setScanError('Product not found');
        }
      } catch (searchError: any) {
        const errorMessage = searchError?.response?.data?.message || searchError?.response?.data?.error || 'Product not found';
        setScanError(errorMessage);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      handleSearch(searchQuery);
    }
  };

  const handleCloseScanner = () => {
    setScannerOpen(false);
    setScannedProduct(null);
    setSearchResults(null);
    setScanError(null);
    setIsLoadingProduct(false);
    setIsSearching(false);
    setSearchQuery('');
  };


  const userGroups = user?.groups || [];
  // Check if user is Admin (superuser, staff, or Admin group)
  // Note: For Retail users, is_admin should be false unless they're also superuser/staff
  const isAdmin = Boolean(user?.is_admin);
  const canAccessDashboard = user?.can_access_dashboard === true;
  const canAccessReports = user?.can_access_reports === true;
  const canAccessCustomers = user?.can_access_customers === true;
  const canAccessLedger = user?.can_access_ledger === true;
  const canAccessHistory = user?.can_access_history === true;

  // Debug logging
  if (user && userGroups.includes('Retail') && !userGroups.includes('Admin') && !userGroups.includes('RetailAdmin')) {
    console.log('Retail user permissions check:', {
      groups: userGroups,
      is_admin: user.is_admin,
      is_staff: user.is_staff,
      is_superuser: user.is_superuser,
      can_access_customers: user.can_access_customers,
      canAccessCustomers,
      isAdmin
    });
  }

  // Helper function to check if user has access based on showFor value
  const hasAccess = (showFor: string | string[] | ((user: any, groups: string[]) => boolean)): boolean => {
    if (typeof showFor === 'function') {
      return showFor(user, userGroups);
    }
    if (Array.isArray(showFor)) {
      // Show if user is in any of the specified groups
      return showFor.some(group => userGroups.includes(group));
    }
    // String values
    switch (showFor) {
      case 'all':
        return true;
      case 'admin':
        // For 'admin', check if user has admin-only permissions
        // Use can_access_customers as the definitive check since only Admin group has it
        // This ensures Retail users (even if staff/superuser) don't see admin-only items
        return canAccessCustomers;
      case 'dashboard':
        return canAccessDashboard;
      case 'reports':
        return canAccessReports;
      case 'customers':
        return canAccessCustomers;
      case 'ledger':
        return canAccessLedger;
        return canAccessHistory;
      default:
        // If it's a group name, check if user is in that group
        return userGroups.includes(showFor);
    }
  };

  // Debug: Log admin status (remove in production)
  useEffect(() => {
    if (user) {
    }
  }, [user, userGroups, isAdmin]);

  const menuGroups = [
    {
      title: 'Core Operations',
      items: [
        { path: '/', icon: ShoppingCart, label: 'POS', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'] },
        { path: '/pos-repair', icon: Wrench, label: 'Repair Shop', showFor: ['Admin', 'RetailAdmin', 'WholesaleAdmin', 'Repair','Retail', 'Wholesale'] },
        { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', showFor: ['Admin', 'RetailAdmin'] },
        { path: '/search', icon: Search, label: 'Search', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair'] },
      ],
    },
    {
      title: 'Sales & Transactions',
      items: [
        { path: '/invoices', icon: FileText, label: 'Invoices', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'] },
        { path: '/credit-notes', icon: Receipt, label: 'Credit Notes', showFor: ['Admin', 'RetailAdmin', 'Retail'] },
        { path: '/customers', icon: Users, label: 'Customers', showFor: ['Admin', 'RetailAdmin', 'WholesaleAdmin'] },
        { path: '/replacement', icon: RefreshCw, label: 'Replacement', showFor: ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'] },
        { path: '/repairs', icon: Wrench, label: 'Repairs', showFor: ['Admin', 'RetailAdmin','WholesaleAdmin', 'Repair','Retail', 'Wholesale'] },
      ],
    },
    {
      title: 'Inventory & Products',
      items: [
        { path: '/products', icon: Package, label: 'Products', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair'] },
        { path: '/purchases', icon: ShoppingBag, label: 'Purchases', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'] },
        // { path: '/pricing', icon: Coins, label: 'Pricing', showFor: 'all' }, // Hidden for now
      ],
    },
    {
      title: 'Financial',
      items: [
        { path: '/ledger', icon: BookOpen, label: 'Ledger', showFor: ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin'] },
        { path: '/personal-ledger', icon: BookOpen, label: 'Personal Ledger', showFor: 'admin' },
        { path: '/internal-ledger', icon: BookOpen, label: 'Shop Boys Ledger', showFor: ['Admin', 'RetailAdmin', 'Retail', 'Repair'] },
      ],
    },
    {
      title: 'Administration',
      items: [
        // { path: '/stores', icon: Store, label: 'Stores', showFor: 'admin' }, // Hidden for now
        { path: '/vendors', icon: Users, label: 'Vendors', showFor: ['Admin', 'RetailAdmin', 'WholesaleAdmin'] },
        { path: '/reports', icon: BarChart3, label: 'Reports', showFor: ['Admin', 'RetailAdmin', 'WholesaleAdmin'] },
        { path: '/history', icon: History, label: 'History', showFor: 'admin' },
      ],
    },
  ];

  // Filter menu groups and items based on user permissions
  const filteredMenuGroups = menuGroups.map(group => ({
    ...group,
    items: group.items.filter(item => hasAccess(item.showFor)),
  })).filter(group => group.items.length > 0); // Only show groups that have visible items

  const getPageTitle = () => {
    // Flatten all menu items from all groups
    const allMenuItems = filteredMenuGroups.flatMap(group => group.items);
    const currentItem = allMenuItems.find(
      (item) => item.path === location.pathname || (item.path === '/' && (location.pathname === '/' || location.pathname === '/pos'))
    );
    return currentItem?.label || 'POS';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
          }`}
        onClick={() => setSidebarOpen(false)}
      >
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm" />
      </div>

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 shadow-lg transform transition-all duration-300 ease-in-out lg:translate-x-0 flex flex-col w-72 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-72'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {/* Sidebar Header */}
        <div className={`flex items-center justify-between h-20 border-b border-gray-200 flex-shrink-0 px-6 ${sidebarCollapsed ? 'lg:px-3' : 'lg:px-6'
          }`}>
          <div className={`flex items-center space-x-3 ${sidebarCollapsed ? 'lg:hidden' : ''
            }`}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Package className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Inventory</h1>
              <p className="text-xs text-gray-500">Manager</p>
            </div>
          </div>
          {sidebarCollapsed && (
            <div className="hidden lg:flex items-center justify-center">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mx-auto">
                <Package className="h-6 w-6 text-white" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Collapse/Expand Button - Desktop only */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:flex text-gray-500 hover:text-gray-700 transition-colors p-1.5 rounded-lg hover:bg-gray-100"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <ChevronLeft className="h-5 w-5" />
              )}
            </button>
            {/* Close Button - Mobile only */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-gray-500 hover:text-gray-700 transition-colors p-1.5 rounded-lg hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto py-6 space-y-6 min-h-0 px-4 ${sidebarCollapsed ? 'lg:px-2' : 'lg:px-4'
          }`}>
          {filteredMenuGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="space-y-2">
              <h3 className={`px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider ${sidebarCollapsed ? 'lg:hidden' : ''
                }`}>
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.path ||
                    (item.path === '/' && (location.pathname === '/' || location.pathname === '/pos'));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`group flex items-center rounded-xl transition-all duration-200 px-4 py-3 ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''
                        } ${isActive
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      onClick={() => setSidebarOpen(false)}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon
                        className={`h-5 w-5 transition-transform duration-200 mr-3 ${sidebarCollapsed ? 'lg:mr-0' : ''
                          } ${isActive ? 'scale-110' : 'group-hover:scale-110'
                          }`}
                      />
                      <span className={`font-medium ${sidebarCollapsed ? 'lg:hidden' : ''
                        }`}>{item.label}</span>
                      {isActive && (
                        <div className={`ml-auto w-1.5 h-1.5 bg-white rounded-full ${sidebarCollapsed ? 'lg:hidden' : ''
                          }`} />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User Section at Bottom */}
        <div className={`flex-shrink-0 border-t border-gray-200 bg-gray-50 mt-auto p-4 ${sidebarCollapsed ? 'lg:p-2' : ''
          }`}>
          <div className={`flex items-center space-x-3 mb-3 px-2 ${sidebarCollapsed ? 'lg:hidden' : ''
            }`}>
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
              <User className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {auth.getUser()?.username || 'User'}
              </p>
              <p className="text-xs text-gray-500 truncate">Administrator</p>
            </div>
          </div>
          {sidebarCollapsed && (
            <div className="hidden lg:flex justify-center mb-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={`flex items-center w-full text-gray-700 rounded-lg hover:bg-red-50 hover:text-red-600 transition-all duration-200 group px-4 py-2.5 ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''
              }`}
            title={sidebarCollapsed ? 'Logout' : undefined}
          >
            <LogOut className={`h-4 w-4 group-hover:rotate-12 transition-transform mr-3 ${sidebarCollapsed ? 'lg:mr-0' : ''
              }`} />
            <span className={`text-sm font-medium ${sidebarCollapsed ? 'lg:hidden' : ''
              }`}>Logout</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}>
        {/* Top Navigation Bar */}
        <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/50 shadow-sm">
          <div className="flex items-center justify-between h-16 px-6">
            {/* Left side - Mobile menu & Page title */}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-lg hover:bg-gray-100"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="hidden lg:block">
                <h2 className="text-xl font-semibold text-gray-900">
                  {getPageTitle()}
                </h2>
              </div>
            </div>

            {/* Right side - Actions & User menu */}
            <div className="flex items-center space-x-3">
              {/* QR Code Scanner Button */}
              <button
                onClick={() => setScannerOpen(true)}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all duration-200"
                title="Scan QR Code"
                aria-label="Scan QR Code"
              >
                <ScanLine className="h-5 w-5" />
              </button>

              {/* Notifications */}
              <button className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all duration-200">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
              </button>

              {/* User Menu */}
              <div className="relative user-menu-container">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-all duration-200 group"
                >
                  <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center shadow-md">
                    <User className="h-4 w-4 text-white" />
                  </div>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium text-gray-900">
                      {auth.getUser()?.username || 'User'}
                    </p>
                    <p className="text-xs text-gray-500">Admin</p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''
                      }`}
                  />
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">
                        {auth.getUser()?.username || 'User'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {auth.getUser()?.email || 'user@example.com'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setPrintSettingsOpen(true);
                      }}
                      className="w-full flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Settings className="h-4 w-4 mr-3 text-gray-400" />
                      Print Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4 mr-3" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>

      {/* Print Settings Modal */}
      <PrintSettingsModal
        isOpen={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
      />

      {/* QR Code Scanner Modal */}
      <Modal
        isOpen={scannerOpen}
        onClose={handleCloseScanner}
        title="Scan QR Code"
        size="md"
      >
        <div className="space-y-4 flex flex-col items-center">
          <div className="w-full max-w-sm">
            <BarcodeScanner
              isOpen={scannerOpen}
              onScan={handleBarcodeScan}
              onClose={handleCloseScanner}
              continuous={false}
            />
          </div>

          {/* Manual Search Input */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or search manually by SKU/Barcode:
            </label>
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter SKU or Barcode..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button type="submit" size="sm" disabled={!searchQuery.trim() || isSearching}>
                {isSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </>
                )}
              </Button>
            </form>
          </div>

          {/* Loading State */}
          {(isLoadingProduct || isSearching) && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="ml-2 text-sm text-gray-600">Looking up product...</span>
            </div>
          )}

          {/* Error State */}
          {scanError && !isLoadingProduct && !isSearching && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600 font-medium">Product Not Found</p>
              <p className="text-xs text-red-500 mt-1">{scanError}</p>
            </div>
          )}

          {/* Product Found */}
          {(scannedProduct || searchResults) && !isLoadingProduct && !isSearching && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900 mb-1">Product Found!</p>
                  <h3 className="text-lg font-semibold text-gray-900">{(scannedProduct || searchResults).name}</h3>
                  {(scannedProduct || searchResults).sku && (
                    <p className="text-sm text-gray-600 mt-1">SKU: {(scannedProduct || searchResults).sku}</p>
                  )}
                  {(scannedProduct || searchResults).category_name && (
                    <p className="text-xs text-gray-500 mt-1">Category: {(scannedProduct || searchResults).category_name}</p>
                  )}
                  {(scannedProduct || searchResults).brand_name && (
                    <p className="text-xs text-gray-500">Brand: {(scannedProduct || searchResults).brand_name}</p>
                  )}
                </div>
                <Package className="h-8 w-8 text-green-600 flex-shrink-0" />
              </div>

              <div className="flex gap-2 pt-2 border-t border-green-200">
                <Button
                  onClick={() => {
                    const product = scannedProduct || searchResults;
                    if (product?.id) {
                      navigate(`/products/${product.id}`);
                      handleCloseScanner();
                    }
                  }}
                  variant="default"
                  size="sm"
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Product
                </Button>
                <Button
                  onClick={handleCloseScanner}
                  variant="outline"
                  size="sm"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

