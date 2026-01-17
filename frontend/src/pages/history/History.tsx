import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { historyApi } from '../../lib/api';
import Modal from '../../components/ui/Modal';
import { 
  History as HistoryIcon, 
  Search, 
  Filter,
  Calendar,
  User,
  FileText,
  Package,
  Coins,
  Trash2,
  Edit,
  Eye,
  ShoppingCart,
  Info,
  Clock,
  Globe
} from 'lucide-react';

interface AuditLog {
  id: number;
  user: {
    id: number;
    username: string;
    email: string;
  } | null;
  action: string;
  model_name: string;
  object_id: string;
  object_name?: string | null;
  object_reference?: string | null;
  barcode?: string | null;
  changes: Record<string, any>;
  ip_address: string | null;
  created_at: string;
}

const actionIcons: Record<string, any> = {
  create: Edit,
  update: Edit,
  delete: Trash2,
  view: Eye,
  stock_adjust: Package,
  price_change: Coins,
  invoice_void: FileText,
  invoice_create: FileText,
  invoice_update: FileText,
  invoice_checkout: FileText,
  payment_add: Coins,
  return: FileText,
  refund: Coins,
  cart_add: ShoppingCart,
  cart_remove: ShoppingCart,
  cart_checkout: ShoppingCart,
  cart_update: ShoppingCart,
  barcode_scan: Package,
  barcode_tag_change: Package,
  stock_purchase: Package,
  stock_sale: Package,
  replacement_create: Package,
  replacement_replace: Package,
  replacement_return: Package,
  replacement_defective: Package,
};

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700 border-green-200',
  update: 'bg-blue-100 text-blue-700 border-blue-200',
  delete: 'bg-red-100 text-red-700 border-red-200',
  view: 'bg-gray-100 text-gray-700 border-gray-200',
  stock_adjust: 'bg-purple-100 text-purple-700 border-purple-200',
  price_change: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  invoice_void: 'bg-orange-100 text-orange-700 border-orange-200',
  invoice_create: 'bg-teal-100 text-teal-700 border-teal-200',
  invoice_update: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  invoice_checkout: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  payment_add: 'bg-green-100 text-green-700 border-green-200',
  return: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  refund: 'bg-pink-100 text-pink-700 border-pink-200',
  cart_add: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  cart_remove: 'bg-amber-100 text-amber-700 border-amber-200',
  cart_checkout: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cart_update: 'bg-sky-100 text-sky-700 border-sky-200',
  barcode_scan: 'bg-violet-100 text-violet-700 border-violet-200',
  barcode_tag_change: 'bg-rose-100 text-rose-700 border-rose-200',
  stock_purchase: 'bg-lime-100 text-lime-700 border-lime-200',
  stock_sale: 'bg-red-100 text-red-700 border-red-200',
  replacement_create: 'bg-slate-100 text-slate-700 border-slate-200',
  replacement_replace: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  replacement_return: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  replacement_defective: 'bg-rose-100 text-rose-700 border-rose-200',
};

export default function History() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', search, actionFilter, modelFilter, dateFrom, dateTo],
    queryFn: async () => {
      const response = await historyApi.list({
        action: actionFilter || undefined,
        model: modelFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      return response.data;
    },
    retry: false,
  });

  const logs: AuditLog[] = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      log.model_name.toLowerCase().includes(searchLower) ||
      log.user?.username.toLowerCase().includes(searchLower) ||
      log.action.toLowerCase().includes(searchLower) ||
      log.object_id.toLowerCase().includes(searchLower) ||
      log.object_name?.toLowerCase().includes(searchLower) ||
      log.object_reference?.toLowerCase().includes(searchLower) ||
      log.barcode?.toLowerCase().includes(searchLower)
    );
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActionLabel = (action: string) => {
    return action.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatChanges = (changes: Record<string, any>): { short: string; full: string } => {
    if (!changes || Object.keys(changes).length === 0) {
      return { short: '-', full: '-' };
    }

    const formatted: string[] = [];
    const shortFormatted: string[] = [];

    // Handle tag changes (old -> new) - always show this first and prominently
    if (changes.tag) {
      if (typeof changes.tag === 'object' && changes.tag.old && changes.tag.new) {
        const tagChange = `Tag: ${changes.tag.old} → ${changes.tag.new}`;
        formatted.push(tagChange);
        shortFormatted.push(tagChange);
      } else {
        formatted.push(`Tag: ${changes.tag}`);
        shortFormatted.push(`Tag: ${changes.tag}`);
      }
    }

    // Handle other common change patterns
    Object.keys(changes).forEach(key => {
      if (key === 'tag') return; // Already handled
      
      const value = changes[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Check if it's an old/new pattern
        if (value.old !== undefined && value.new !== undefined) {
          formatted.push(`${key}: ${value.old} → ${value.new}`);
          // Only add to short if it's important
          if (['status', 'quantity', 'price', 'amount'].includes(key.toLowerCase())) {
            shortFormatted.push(`${key}: ${value.old} → ${value.new}`);
          }
        } else {
          formatted.push(key);
        }
      } else if (Array.isArray(value)) {
        formatted.push(`${key}: ${value.length} item(s)`);
        if (key === 'items') {
          shortFormatted.push(`${value.length} item(s)`);
        }
      } else if (value !== null && value !== undefined) {
        // For short version, only show key-value for important fields
        const importantKeys = ['invoice_number', 'cart_number', 'total', 'quantity', 'status', 'invoice_type'];
        if (importantKeys.includes(key.toLowerCase())) {
          shortFormatted.push(`${key}: ${value}`);
        }
        formatted.push(`${key}: ${value}`);
      }
    });

    const full = formatted.length > 0 ? formatted.join(', ') : '-';
    const short = shortFormatted.length > 0 
      ? shortFormatted.join(', ') 
      : (formatted.length > 0 ? formatted.slice(0, 2).join(', ') + (formatted.length > 2 ? '...' : '') : '-');

    return { short, full };
  };

  const formatObjectDisplay = (log: AuditLog): { short: string; full: string } => {
    if (log.object_name) {
      const short = log.object_name.length > 30 
        ? log.object_name.substring(0, 30) + '...' 
        : log.object_name;
      const full = log.object_reference 
        ? `${log.object_name} (${log.object_reference})`
        : log.object_name;
      return { short, full };
    } else if (log.object_reference) {
      return { 
        short: log.object_reference.length > 30 
          ? log.object_reference.substring(0, 30) + '...' 
          : log.object_reference,
        full: log.object_reference 
      };
    } else {
      return { 
        short: `ID: ${log.object_id}`,
        full: `Object ID: ${log.object_id}`
      };
    }
  };

  const handleRowClick = (log: AuditLog) => {
    setSelectedLog(log);
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <HistoryIcon className="h-8 w-8 text-blue-600" />
            Activity History
          </h1>
          <p className="text-gray-600 mt-1">View all system activity and audit logs</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Action Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
            >
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="view">View</option>
              <option value="stock_adjust">Stock Adjustment</option>
              <option value="price_change">Price Change</option>
              <option value="invoice_void">Invoice Void</option>
              <option value="return">Return</option>
              <option value="refund">Refund</option>
              <option value="invoice_create">Invoice Created</option>
              <option value="invoice_update">Invoice Updated</option>
              <option value="invoice_checkout">Invoice Checkout</option>
              <option value="invoice_void">Invoice Void</option>
              <option value="payment_add">Payment Added</option>
              <option value="cart_add">Add to Cart</option>
              <option value="cart_remove">Remove from Cart</option>
              <option value="cart_checkout">Cart Checkout</option>
              <option value="cart_update">Cart Update</option>
              <option value="barcode_scan">Barcode Scan</option>
              <option value="barcode_tag_change">Barcode Tag Change</option>
              <option value="stock_purchase">Stock Added (Purchase)</option>
              <option value="stock_sale">Stock Removed (Sale)</option>
              <option value="replacement_create">Replacement Created</option>
              <option value="replacement_replace">Item Replaced</option>
              <option value="replacement_return">Item Returned</option>
              <option value="replacement_defective">Item Marked Defective</option>
            </select>
          </div>

          {/* Model Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
            >
              <option value="">All Models</option>
              <option value="Product">Product</option>
              <option value="Purchase">Purchase</option>
              <option value="Cart">Cart</option>
              <option value="CartItem">Cart Item</option>
              <option value="Invoice">Invoice</option>
              <option value="Barcode">Barcode</option>
              <option value="StockAdjustment">Stock Adjustment</option>
            </select>
          </div>

          {/* Date From */}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="From Date"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Date To */}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="To Date"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading activity logs...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <p className="text-red-600">Error loading activity logs. Please try again.</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <HistoryIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No activity logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[200px]">
                    Object
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Barcode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[200px]">
                    Changes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLogs.map((log) => {
                  const ActionIcon = actionIcons[log.action] || FileText;
                  return (
                    <tr 
                      key={log.id} 
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(log)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <ActionIcon className="h-4 w-4" />
                          <span className={`px-2 py-1 text-xs font-medium rounded-md border ${actionColors[log.action] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                            {getActionLabel(log.action)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            {log.user?.username || 'System'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 font-medium">
                          {log.model_name}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="max-w-[200px]">
                          {(() => {
                            const { short, full } = formatObjectDisplay(log);
                            const hasMore = full !== short;
                            return (
                              <div className="group relative">
                                <div 
                                  className="text-xs text-gray-900 truncate" 
                                  title={hasMore ? full : undefined}
                                >
                                  {short}
                                </div>
                                {hasMore && (
                                  <span className="md:hidden text-xs text-blue-600 ml-1">...</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.barcode ? (
                          <span className="text-sm text-gray-900 font-mono bg-gray-50 px-2 py-1 rounded">
                            {log.barcode}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="max-w-[200px]">
                          {(() => {
                            const { short, full } = formatChanges(log.changes || {});
                            const hasMore = full !== short && full !== '-';
                            return (
                              <div className="group relative">
                                <div 
                                  className="text-xs text-gray-600 truncate cursor-help" 
                                  title={hasMore ? full : undefined}
                                >
                                  {short}
                                </div>
                                {hasMore && (
                                  <>
                                    {/* Desktop hover tooltip */}
                                    <div className="hidden md:block absolute left-0 top-full mt-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 max-w-sm whitespace-normal break-words pointer-events-none">
                                      <div className="font-semibold mb-2 flex items-center gap-1 text-white">
                                        <Info className="h-3 w-3" />
                                        Full Changes:
                                      </div>
                                      <div className="space-y-1 max-h-60 overflow-y-auto">
                                        {full.split(', ').map((change, idx) => (
                                          <div key={idx} className="text-gray-200 text-xs">{change}</div>
                                        ))}
                                      </div>
                                      <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                    </div>
                                    {/* Mobile: Show indicator */}
                                    <span className="md:hidden text-xs text-blue-600 ml-1">...</span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">
                          {formatDate(log.created_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (() => {
        const ModalActionIcon = actionIcons[selectedLog.action] || FileText;
        return (
          <Modal
            isOpen={showModal}
            onClose={() => {
              setShowModal(false);
              setSelectedLog(null);
            }}
            title="Activity Log Details"
            size="lg"
          >
            <div className="space-y-6">
              {/* Action & User Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ModalActionIcon className="h-4 w-4 text-gray-500" />
                    <span className="text-xs font-medium text-gray-500 uppercase">Action</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1.5 text-sm font-medium rounded-md border ${actionColors[selectedLog.action] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                      {getActionLabel(selectedLog.action)}
                    </span>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-4 w-4 text-gray-500" />
                    <span className="text-xs font-medium text-gray-500 uppercase">User</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {selectedLog.user?.username || 'System'}
                  </p>
                  {selectedLog.user?.email && (
                    <p className="text-xs text-gray-500 mt-1">{selectedLog.user.email}</p>
                  )}
                </div>
              </div>

            {/* Object Information */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-900 uppercase">Object Information</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs font-medium text-gray-600">Model:</span>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{selectedLog.model_name}</p>
                </div>
                {selectedLog.object_name && (
                  <div>
                    <span className="text-xs font-medium text-gray-600">Name:</span>
                    <p className="text-sm text-gray-900 mt-0.5">{selectedLog.object_name}</p>
                  </div>
                )}
                {selectedLog.object_reference && (
                  <div>
                    <span className="text-xs font-medium text-gray-600">Reference:</span>
                    <p className="text-sm font-mono text-gray-900 mt-0.5">{selectedLog.object_reference}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs font-medium text-gray-600">Object ID:</span>
                  <p className="text-sm font-mono text-gray-700 mt-0.5">{selectedLog.object_id}</p>
                </div>
                {selectedLog.barcode && (
                  <div>
                    <span className="text-xs font-medium text-gray-600">Barcode:</span>
                    <p className="text-sm font-mono text-gray-900 bg-white px-2 py-1 rounded mt-0.5 inline-block">
                      {selectedLog.barcode}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Changes Section */}
            {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
              <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                <div className="flex items-center gap-2 mb-3">
                  <Edit className="h-4 w-4 text-green-600" />
                  <span className="text-xs font-medium text-green-900 uppercase">Changes</span>
                </div>
                <div className="space-y-2">
                  {Object.entries(selectedLog.changes).map(([key, value]) => {
                    if (key === 'tag' && typeof value === 'object' && value !== null && 'old' in value && 'new' in value) {
                      return (
                        <div key={key} className="bg-white rounded p-3 border border-green-200">
                          <span className="text-xs font-medium text-gray-600 block mb-1">Tag Change:</span>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">
                              {value.old}
                            </span>
                            <span className="text-gray-400">→</span>
                            <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                              {value.new}
                            </span>
                          </div>
                        </div>
                      );
                    } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'old' in value && 'new' in value) {
                      return (
                        <div key={key} className="bg-white rounded p-3 border border-green-200">
                          <span className="text-xs font-medium text-gray-600 block mb-1 capitalize">{key.replace(/_/g, ' ')}:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-700">{String(value.old)}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-xs font-medium text-gray-900">{String(value.new)}</span>
                          </div>
                        </div>
                      );
                    } else if (Array.isArray(value)) {
                      return (
                        <div key={key} className="bg-white rounded p-3 border border-green-200">
                          <span className="text-xs font-medium text-gray-600 block mb-1 capitalize">{key.replace(/_/g, ' ')}:</span>
                          <p className="text-xs text-gray-900">{value.length} item(s)</p>
                        </div>
                      );
                    } else {
                      return (
                        <div key={key} className="bg-white rounded p-3 border border-green-200">
                          <span className="text-xs font-medium text-gray-600 block mb-1 capitalize">{key.replace(/_/g, ' ')}:</span>
                          <p className="text-xs text-gray-900 break-words">{String(value)}</p>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>
            )}

            {/* Metadata Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500 uppercase">Date & Time</span>
                </div>
                <p className="text-sm text-gray-900">{formatDate(selectedLog.created_at)}</p>
              </div>

              {selectedLog.ip_address && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="h-4 w-4 text-gray-500" />
                    <span className="text-xs font-medium text-gray-500 uppercase">IP Address</span>
                  </div>
                  <p className="text-sm font-mono text-gray-900">{selectedLog.ip_address}</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}

