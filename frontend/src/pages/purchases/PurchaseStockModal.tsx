import React, { useState, useEffect } from 'react';
import {
    X,
    Save,
    AlertCircle,
    Package,
    Store,
    Warehouse as WarehouseIcon,
    Calculator
} from 'lucide-react';
import { purchasingApi } from '../../lib/api';
import { formatNumber, formatDateOnlyDisplay } from '../../lib/utils';

interface PurchaseItem {
    id: number;
    product_name: string;
    variant_name?: string;
    quantity: string;
    shop_quantity: string;
    warehouse_quantity: string;
}

interface Purchase {
    id: number;
    purchase_number: string;
    supplier_name: string;
    purchase_date: string;
    bill_number: string;
    items: PurchaseItem[];
}

interface PurchaseStockModalProps {
    purchase: Purchase;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const PurchaseStockModal: React.FC<PurchaseStockModalProps> = ({
    purchase,
    isOpen,
    onClose,
    onSuccess
}) => {
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (purchase && purchase.items) {
            setItems(purchase.items.map(item => ({
                ...item,
                shop_quantity: Number(item.shop_quantity).toString(),
                warehouse_quantity: Number(item.warehouse_quantity).toString()
            })));
        }
    }, [purchase]);

    if (!isOpen) return null;

    const handleQuantityChange = (index: number, field: 'shop_quantity' | 'warehouse_quantity', value: string) => {
        const newItems = [...items];
        const totalQty = parseFloat(newItems[index].quantity);

        // Handle empty or invalid input by treating as 0
        let newVal = parseFloat(value);
        if (isNaN(newVal)) newVal = 0;

        // Strict validation: Non-negative and cannot exceed total
        if (newVal < 0) newVal = 0;
        if (newVal > totalQty) newVal = totalQty;

        // Helper to format number string without trailing zeros
        const formatVal = (v: number) => Number(v.toFixed(3)).toString();

        newItems[index] = {
            ...newItems[index],
            [field]: newVal.toString() // Use the validated number string
        };

        // Auto-adjust the other field to maintain total
        const otherField = field === 'shop_quantity' ? 'warehouse_quantity' : 'shop_quantity';
        newItems[index][otherField] = formatVal(totalQty - newVal);

        setItems(newItems);
    };

    const handleQuantityBlur = (index: number, field: 'shop_quantity' | 'warehouse_quantity', value: string) => {
        const newItems = [...items];
        newItems[index] = {
            ...newItems[index],
            [field]: Number(parseFloat(value) || 0).toString()
        };
        setItems(newItems);
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const distribution = items.map(item => ({
                item_id: item.id,
                shop_quantity: parseFloat(item.shop_quantity),
                warehouse_quantity: parseFloat(item.warehouse_quantity)
            }));

            await purchasingApi.purchases.redistributeStock(purchase.id, distribution);
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to update stock distribution');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Store className="w-5 h-5 text-indigo-600" />
                            Stock Distribution
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {purchase.purchase_number} • {purchase.supplier_name} • {formatDateOnlyDisplay(purchase.purchase_date) || (purchase.purchase_date ? new Date(purchase.purchase_date).toLocaleDateString() : '-')}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200/50 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 animate-in slide-in-from-top-2 duration-300">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    )}

                    <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Product</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-32">Total Qty</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-40">Shop Qty</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-40">Warehouse Qty</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {items.map((item, index) => (
                                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
                                                    <Package className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900">{item.product_name}</p>
                                                    {item.variant_name && (
                                                        <p className="text-xs text-slate-500">{item.variant_name}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md font-mono text-sm font-bold">
                                                {formatNumber(item.quantity, 3)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="relative group">
                                                <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                                                <input
                                                    type="number"
                                                    value={item.shop_quantity}
                                                    onChange={(e) => handleQuantityChange(index, 'shop_quantity', e.target.value)}
                                                    onBlur={(e) => handleQuantityBlur(index, 'shop_quantity', e.target.value)}
                                                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-sm"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="relative group">
                                                <WarehouseIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                                                <input
                                                    type="number"
                                                    value={item.warehouse_quantity}
                                                    onChange={(e) => handleQuantityChange(index, 'warehouse_quantity', e.target.value)}
                                                    onBlur={(e) => handleQuantityBlur(index, 'warehouse_quantity', e.target.value)}
                                                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-sm"
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-500 text-sm italic">
                        <Calculator className="w-4 h-4" />
                        Stock is synchronized in real-time between locations.
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 border border-slate-200 rounded-xl font-semibold text-slate-600 hover:bg-white hover:border-slate-300 transition-all active:scale-95 disabled:opacity-50"
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSaving ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Save className="w-5 h-5" />
                            )}
                            {isSaving ? 'Saving...' : 'Update Distribution'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PurchaseStockModal;
