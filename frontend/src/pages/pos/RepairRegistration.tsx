import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { posApi, customersApi, catalogApi } from '../../lib/api';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import { auth } from '../../lib/auth';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import {
    User,
    Phone,
    Package,
    IndianRupee,
    Wrench,
    Search,
    Plus,
    X,
    ChevronRight,
    Store,
    ChevronDown,
    Printer,
    CheckCircle2,
    Filter,
    Barcode as BarcodeIcon
} from 'lucide-react';

export default function RepairRegistration() {
    const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [repairContactNo, setRepairContactNo] = useState('');
    const [repairModelName, setRepairModelName] = useState('');
    const [repairBookingAmount, setRepairBookingAmount] = useState('');
    const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');
    const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [registeredRepair, setRegisteredRepair] = useState<any>(null);
    const [repairDescription, setRepairDescription] = useState('');
    const [customerGroupFilter, setCustomerGroupFilter] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);


    const user = auth.getUser();
    const isAdmin = user?.is_admin || user?.is_superuser || user?.is_staff || (user?.groups && user.groups.includes('Admin'));

    // Toast helpers
    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        const id = Math.random().toString(36).substring(7);
        setToasts((prev) => [...prev, { id, message, type }]);
    };
    const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

    // Fetch stores
    const { data: storesResponse } = useQuery({
        queryKey: ['stores'],
        queryFn: async () => {
            const resp = await catalogApi.stores.list();
            return resp.data;
        },
    });

    const stores = useMemo(() => {
        if (!storesResponse) return [];
        const data = storesResponse.results || storesResponse.data || storesResponse;
        return Array.isArray(data) ? data : [];
    }, [storesResponse]);

    const filteredStores = useMemo(() => {
        return stores.filter((s: any) => s.is_active && s.shop_type === 'repair');
    }, [stores]);

    const currentStore = useMemo(() => {
        if (selectedStoreId) return filteredStores.find((s: any) => s.id === selectedStoreId);
        return filteredStores[0];
    }, [selectedStoreId, filteredStores]);

    useEffect(() => {
        if (filteredStores.length > 0 && !selectedStoreId) {
            setSelectedStoreId(filteredStores[0].id);
        }
    }, [filteredStores, selectedStoreId]);

    // Fetch customer groups to find 'REPAIR' group
    const { data: customerGroups } = useQuery({
        queryKey: ['customer-groups'],
        queryFn: async () => {
            const response = await customersApi.groups.list();
            return response.data;
        },
    });

    const repairGroup = useMemo(() => {
        if (!customerGroups) return null;
        const groups = customerGroups.results || customerGroups.data || customerGroups;
        return Array.isArray(groups) ? groups.find((g: any) => g.name === 'REPAIR') : null;
    }, [customerGroups]);

    const customerGroupsList = useMemo(() => {
        if (!customerGroups) return [];
        const groups = customerGroups.results || customerGroups.data || customerGroups;
        return Array.isArray(groups) ? groups : [];
    }, [customerGroups]);

    useEffect(() => {
        if (repairGroup && !customerGroupFilter && !customerSearch) {
            setCustomerGroupFilter(repairGroup.id.toString());
        }
    }, [repairGroup, customerGroupFilter, customerSearch]);

    // Customer search
    const { data: customersResponse } = useQuery({
        queryKey: ['customers', customerSearch.trim(), customerGroupFilter],
        queryFn: async () => {
            const params: any = { search: customerSearch.trim() };
            if (customerGroupFilter) params.customer_group = customerGroupFilter;
            const response = await customersApi.list(params);
            return response.data;
        },
        enabled: customerSearch.trim().length > 0 || !!customerGroupFilter,
        select: (data) => {
            if (!data) return data;
            const customers = data.results || data.data || (Array.isArray(data) ? data : []);

            // UI level filtering to ensure we don't show non-matching groups if backend filter is loose
            let filtered = customers;
            if (customerGroupFilter) {
                filtered = customers.filter((c: any) =>
                    String(c.customer_group) === customerGroupFilter ||
                    String(c.customer_group_id) === String(customerGroupFilter)
                );
            }

            // UI level sorting to prioritize REPAIR group (matching POSRepair.tsx)
            const sorted = [...filtered].sort((a: any, b: any) => {
                const aIsRepair = a.customer_group_name === 'REPAIR';
                const bIsRepair = b.customer_group_name === 'REPAIR';
                if (aIsRepair === bIsRepair) return 0;
                return aIsRepair ? -1 : 1;
            });

            if (data.results) return { ...data, results: sorted };
            return sorted;
        }
    });

    // Mutations
    const createCustomerMutation = useMutation({
        mutationFn: (data: { name: string; phone?: string }) => {
            const payload: any = { ...data };
            if (repairGroup) payload.customer_group = repairGroup.id;
            return customersApi.create(payload);
        },
        onSuccess: (resp) => {
            setSelectedCustomer(resp.data);
            setCustomerSearch(''); // Clear search to show the selected card
            setShowCreateCustomerModal(false);
            setNewCustomerName('');
            setNewCustomerPhone('');
            showToast('Customer registered successfully');
        },
        onError: (err: any) => showToast(err.response?.data?.error || 'Failed to create customer', 'error'),
    });

    const registerMutation = useMutation({
        mutationFn: async (data: any) => {
            // 1. Create a temporary cart for this store
            const cartResp = await posApi.carts.create({ store: currentStore.id });
            const cartId = cartResp.data.id;

            // 2. Set customer
            if (selectedCustomer) {
                await posApi.carts.update(cartId, { customer: selectedCustomer.id });
            }

            // 3. Checkout with repair info
            const checkoutResp = await posApi.carts.checkout(cartId, {
                invoice_type: 'pending',
                repair_contact_no: data.contact_no,
                repair_model_name: data.model_name,
                repair_description: data.description,
                repair_booking_amount: data.booking_amount || null,
            });

            return checkoutResp.data;
        },
        onSuccess: (data) => {
            setRegisteredRepair(data);
            showToast('Repair registered successfully!', 'success');
            // Reset form
            setRepairContactNo('');
            setRepairModelName('');
            setRepairDescription('');
            setRepairBookingAmount('');
            setSelectedCustomer(null);
        },
        onError: (err: any) => showToast(err.response?.data?.error || 'Failed to register repair', 'error'),
    });

    const generateLabelMutation = useMutation({
        mutationFn: async (invoiceId: number) => {
            return await posApi.repair.generateLabel(invoiceId);
        },
        onSuccess: (response: any) => {
            if (response?.data?.label?.image) {
                printLabelsFromResponse({ labels: [{ image: response.data.label.image }] });
                showToast('Repair label generated and opened for printing', 'success');
            } else {
                showToast('Label generated but no image found', 'error');
            }
        },
        onError: (error: any) => {
            const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to generate repair label';
            showToast(errorMsg, 'error');
        },
    });

    const handleRegister = () => {
        if (!selectedCustomer) return showToast('Please select a customer', 'error');
        if (!repairContactNo.trim() || !repairModelName.trim()) return showToast('Please fill required fields', 'error');
        if (!currentStore) return showToast('No store selected', 'error');

        registerMutation.mutate({
            contact_no: repairContactNo,
            model_name: repairModelName,
            description: repairDescription,
            booking_amount: repairBookingAmount,
        });
    };

    if (registeredRepair) {
        return (
            <div className="max-w-2xl mx-auto py-12 px-4">
                <div className="bg-white rounded-3xl shadow-2xl border border-blue-50 overflow-hidden transform transition-all hover:scale-[1.01]">
                    <div className="bg-blue-600 p-8 text-center text-white">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-full mb-4 animate-bounce">
                            <CheckCircle2 className="h-12 w-12 text-white" />
                        </div>
                        <h2 className="text-3xl font-black mb-2">Registration Successful!</h2>
                        <p className="text-blue-100 font-medium">Repair ticket has been generated</p>
                    </div>

                    <div className="p-8 space-y-8">
                        <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                            <BarcodeIcon className="h-16 w-16 text-gray-400 mb-2" />
                            <div className="text-4xl font-black text-gray-900 tracking-wider mb-2 font-mono">
                                {registeredRepair.repair?.barcode}
                            </div>
                            <p className="text-sm text-gray-500 font-bold uppercase tracking-widest">Repair ID / Barcode</p>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Customer</label>
                                <p className="font-bold text-gray-900 text-lg">{registeredRepair.customer_name || 'Walk-in Customer'}</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Model</label>
                                <p className="font-bold text-gray-900 text-lg">{registeredRepair.repair?.model_name}</p>
                            </div>
                            <div className="col-span-2 space-y-1">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Description</label>
                                <p className="font-bold text-gray-900">{registeredRepair.repair?.description || 'N/A'}</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Invoice</label>
                                <p className="font-bold text-gray-900">#{registeredRepair.invoice_number}</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Booking Amt</label>
                                <p className="font-bold text-green-600 text-xl">₹{registeredRepair.repair?.booking_amount || '0.00'}</p>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button
                                variant="primary"
                                onClick={() => generateLabelMutation.mutate(registeredRepair.id)}
                                disabled={generateLabelMutation.isPending}
                                className="flex-1 h-16 text-lg font-black rounded-2xl shadow-xl hover:shadow-2xl transition-all"
                            >
                                <Printer className="h-6 w-6 mr-2" />
                                {generateLabelMutation.isPending ? 'PRINTING...' : 'PRINT TICKET'}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setRegisteredRepair(null)}
                                className="flex-1 h-16 text-lg font-black rounded-2xl border-2"
                            >
                                NEW REGISTRATION
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Premium Header */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200">
                        <Wrench className="h-8 w-8 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Repair Booking</h1>
                        <p className="text-gray-500 font-medium">Quick device registration kiosk</p>
                    </div>
                </div>

                {isAdmin && filteredStores.length > 0 && (
                    <div className="relative group">
                        <div className="flex items-center gap-3 bg-gray-50 border-2 border-gray-100 rounded-2xl px-5 py-3 hover:border-blue-400 transition-all cursor-pointer">
                            <Store className="h-5 w-5 text-gray-400" />
                            <div className="text-left">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Current Store</p>
                                <p className="text-sm font-bold text-gray-900 uppercase">{currentStore?.name || 'Select Store'}</p>
                            </div>
                            <ChevronDown className="h-5 w-5 text-gray-400 transition-transform group-hover:rotate-180" />
                        </div>
                        <select
                            value={selectedStoreId || ''}
                            onChange={(e) => setSelectedStoreId(parseInt(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        >
                            {filteredStores.map((s: any) => (
                                <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-8">
                {/* Customer Section */}
                <div className="bg-white rounded-[2rem] shadow-xl border border-gray-100 p-8 space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                            <User className="h-6 w-6 text-blue-600" />
                        </div>
                        <h2 className="text-xl font-black text-gray-900">Who's the customer?</h2>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-gray-300" />
                            <Input
                                placeholder="Search by name or phone number..."
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                                className="pl-12 h-14 text-lg font-medium rounded-2xl border-2 border-gray-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all bg-gray-50 focus:bg-white"
                            />
                        </div>

                        <div className="relative w-full md:w-64">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
                            <select
                                value={customerGroupFilter}
                                onChange={(e) => setCustomerGroupFilter(e.target.value)}
                                className="w-full h-14 pl-12 pr-10 appearance-none bg-gray-50 border-2 border-gray-100 rounded-2xl font-bold text-gray-700 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all outline-none"
                            >
                                <option value="">All Groups</option>
                                {customerGroupsList.map((group: any) => (
                                    <option key={group.id} value={group.id.toString()}>
                                        {group.name}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
                        </div>
                    </div>

                    <div className="relative">
                        {selectedCustomer && !customerSearch ? (
                            <div className="h-14 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-between px-5 shadow-inner shadow-black/20 overflow-hidden">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                                        <User className="h-4 w-4 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-white/60 uppercase tracking-widest leading-none mb-1">Selected</p>
                                        <p className="font-bold text-white truncate">{selectedCustomer.name}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedCustomer(null)}
                                    className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        ) : (
                            <>
                                {(isSearchFocused || customerSearch) && (customerSearch || customerGroupFilter) && customersResponse && (
                                    <div className="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-2xl p-2 max-h-72 overflow-y-auto animate-in fade-in zoom-in duration-200">
                                        {(customersResponse.results || customersResponse.data || customersResponse).length > 0 ? (
                                            (customersResponse.results || customersResponse.data || customersResponse).map((c: any) => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => {
                                                        setSelectedCustomer(c);
                                                        setCustomerSearch('');
                                                        setRepairContactNo(c.phone || '');
                                                    }}
                                                    className="w-full text-left px-5 py-4 hover:bg-blue-50 rounded-xl flex items-center justify-between group transition-colors"
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-blue-600 transition-colors">
                                                            <User className="h-5 w-5 text-gray-400 group-hover:text-white" />
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-gray-900">{c.name}</p>
                                                            <p className="text-xs font-black text-gray-400 group-hover:text-blue-600 transition-colors uppercase">{c.phone || 'No Phone'}</p>
                                                        </div>
                                                    </div>
                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <ChevronRight className="h-6 w-6 text-blue-600" />
                                                    </div>
                                                </button>
                                            ))
                                        ) : (
                                            <div className="p-8 text-center">
                                                <User className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                                                <p className="text-gray-400 font-bold">No customers found</p>
                                            </div>
                                        )}

                                        {customerSearch && (
                                            <button
                                                onClick={() => {
                                                    setNewCustomerName(customerSearch);
                                                    setShowCreateCustomerModal(true);
                                                }}
                                                className="w-full text-left p-5 text-blue-600 font-black hover:bg-blue-50 rounded-xl flex items-center gap-3 transition-colors border-2 border-dashed border-blue-100 mt-2"
                                            >
                                                <Plus className="h-6 w-6" />
                                                Register New: "{customerSearch}"
                                            </button>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Repair Details Section */}
                <div className="bg-white rounded-[2rem] shadow-xl border border-gray-100 p-8 space-y-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                            <Package className="h-6 w-6 text-indigo-600" />
                        </div>
                        <h2 className="text-xl font-black text-gray-900">Repair Information</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Contact Number *</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300" />
                                <Input
                                    placeholder="Customer's mobile no"
                                    value={repairContactNo}
                                    onChange={(e) => setRepairContactNo(e.target.value)}
                                    className="pl-12 h-14 font-bold border-2 border-gray-100 focus:border-indigo-500 rounded-2xl bg-gray-50 focus:bg-white transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Device Model *</label>
                            <div className="relative">
                                <Package className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300" />
                                <Input
                                    placeholder="e.g. Samsung S23 Ultra"
                                    value={repairModelName}
                                    onChange={(e) => setRepairModelName(e.target.value)}
                                    className="pl-12 h-14 font-bold border-2 border-gray-100 focus:border-indigo-500 rounded-2xl bg-gray-50 focus:bg-white transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Issue Description</label>
                        <textarea
                            placeholder="Describe the problem..."
                            value={repairDescription}
                            onChange={(e) => setRepairDescription(e.target.value)}
                            className="w-full h-32 p-4 font-bold border-2 border-gray-100 focus:border-indigo-500 rounded-2xl bg-gray-50 focus:bg-white transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Booking Amount</label>
                        <div className="relative group">
                            <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-gray-300" />
                            <Input
                                type="number"
                                placeholder="0.00"
                                value={repairBookingAmount}
                                onChange={(e) => setRepairBookingAmount(e.target.value)}
                                className="pl-12 h-16 text-2xl font-black border-2 border-gray-100 focus:border-green-500 rounded-2xl bg-gray-50 focus:bg-white transition-all text-green-600"
                            />
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button
                            onClick={handleRegister}
                            disabled={registerMutation.isPending || !selectedCustomer || !repairContactNo.trim() || !repairModelName.trim()}
                            className="w-full h-16 text-xl font-black rounded-2xl shadow-2xl hover:shadow-blue-200 hover:-translate-y-1 transition-all bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
                        >
                            {registerMutation.isPending ? 'PROCESSING...' : 'REGISTER REPAIR & PRINT TICKET'}
                        </Button>
                    </div>
                </div>
            </div>

            <ToastContainer toasts={toasts} onRemove={removeToast} />

            {/* Quick Customer Modal */}
            <Modal
                isOpen={showCreateCustomerModal}
                onClose={() => setShowCreateCustomerModal(false)}
                title="New Customer Registration"
                size="md"
            >
                <div className="p-2 space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Full Name</label>
                        <Input
                            value={newCustomerName}
                            onChange={(e) => setNewCustomerName(e.target.value)}
                            placeholder="Customer Name"
                            className="h-14 font-bold rounded-2xl"
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Phone Number</label>
                        <Input
                            value={newCustomerPhone}
                            onChange={(e) => setNewCustomerPhone(e.target.value)}
                            placeholder="Mobile Number"
                            className="h-14 font-bold rounded-2xl"
                        />
                    </div>
                    <Button
                        onClick={() => {
                            if (!newCustomerName.trim()) return showToast('Name is required', 'error');
                            createCustomerMutation.mutate({
                                name: newCustomerName.trim(),
                                phone: newCustomerPhone.trim() || undefined,
                            });
                        }}
                        disabled={createCustomerMutation.isPending}
                        className="w-full h-14 font-black rounded-2xl text-lg"
                    >
                        {createCustomerMutation.isPending ? 'CREATING...' : 'CREATE CUSTOMER'}
                    </Button>
                </div>
            </Modal>

            {/* Print Styles */}
            <style>{`
        @media print {
          body * { visibility: hidden; }
          .max-w-2xl, .max-w-2xl * { visibility: visible; }
          .max-w-2xl { position: absolute; left: 0; top: 0; width: 100%; border: none; box-shadow: none; }
          button { display: none !important; }
        }
      `}</style>
        </div >
    );
}
