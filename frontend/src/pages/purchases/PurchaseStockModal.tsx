import React, { useState, useEffect } from 'react';
import {
    X,
    Save,
    AlertCircle,
    Package,
    Store,
    Warehouse as WarehouseIcon,
    Calculator,
    ArrowRightLeft
} from 'lucide-react';
import { purchasingApi } from '../../lib/api';
import { formatNumber, formatDateOnlyDisplay } from '../../lib/utils';
import ProductName from '../../components/ProductName';

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

type MoveDirection = 'wh_to_shop' | 'shop_to_wh';

const PurchaseStockModal: React.FC<PurchaseStockModalProps> = ({
    purchase,
    isOpen,
    onClose,
    onSuccess
}) => {
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [moveQtyByItem, setMoveQtyByItem] = useState<Record<number, string>>({});
    const [moveDirByItem, setMoveDirByItem] = useState<Record<number, MoveDirection>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (purchase && purchase.items) {
            setItems(purchase.items.map(item => ({
                ...item,
                shop_quantity: Number(item.shop_quantity).toString(),
                warehouse_quantity: Number(item.warehouse_quantity).toString()
            })));
            setMoveQtyByItem({});
            setMoveDirByItem({});
        }
    }, [purchase]);

    if (!isOpen) return null;

    const formatVal = (v: number) => Number(v.toFixed(3)).toString();

    const applyMoveForItem = (index: number) => {
        const item = items[index];
        const itemId = item.id;
        const raw = (moveQtyByItem[itemId] ?? '').trim();
        if (!raw) return;

        let m = parseFloat(raw);
        if (isNaN(m) || m <= 0) {
            setMoveQtyByItem((prev) => ({ ...prev, [itemId]: '' }));
            return;
        }

        const direction = moveDirByItem[itemId] || 'wh_to_shop';
        const totalQty = parseFloat(item.quantity);
        let wh = parseFloat(item.warehouse_quantity);
        let sh = parseFloat(item.shop_quantity);
        if (isNaN(wh)) wh = 0;
        if (isNaN(sh)) sh = 0;

        if (direction === 'wh_to_shop') {
            m = Math.min(m, wh);
            wh = wh - m;
            sh = sh + m;
        } else {
            m = Math.min(m, sh);
            sh = sh - m;
            wh = wh + m;
        }

        sh = totalQty - wh;

        const newItems = [...items];
        newItems[index] = {
            ...newItems[index],
            warehouse_quantity: formatVal(wh),
            shop_quantity: formatVal(sh),
        };
        setItems(newItems);
        setMoveQtyByItem((prev) => ({ ...prev, [itemId]: '' }));
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
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Store className="w-5 h-5 text-indigo-600" />
                            Stock Distribution
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {purchase.purchase_number} • {purchase.supplier_name} • {formatDateOnlyDisplay(purchase.purchase_date) || '-'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200/50 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 animate-in slide-in-from-top-2 duration-300">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    )}

                    <div className="overflow-x-auto overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
                        <table className="w-full text-left border-collapse min-w-[720px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Product</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-28">Total Qty</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-40">Warehouse Qty</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-52">Move Qty</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-40">Shop Qty</th>
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
                                                    <ProductName as="p"
                                                      className="font-semibold text-slate-900"
                                                     name={item.product_name} />
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
                                            <div className="flex items-center gap-2 pl-1">
                                                <WarehouseIcon className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                                                <span className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm font-semibold text-slate-800 min-w-[4.5rem] inline-block">
                                                    {formatNumber(item.warehouse_quantity, 3)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex flex-col gap-2">
                                                <select
                                                    value={moveDirByItem[item.id] || 'wh_to_shop'}
                                                    onChange={(e) =>
                                                        setMoveDirByItem((prev) => ({
                                                            ...prev,
                                                            [item.id]: e.target.value as MoveDirection,
                                                        }))
                                                    }
                                                    className="w-full text-xs font-medium border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                                >
                                                    <option value="wh_to_shop">Warehouse → Shop</option>
                                                    <option value="shop_to_wh">Shop → Warehouse</option>
                                                </select>
                                                <div className="relative group flex items-center gap-1">
                                                    <ArrowRightLeft className="w-4 h-4 text-slate-400 shrink-0" />
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step="any"
                                                        placeholder="Qty"
                                                        value={moveQtyByItem[item.id] ?? ''}
                                                        onChange={(e) =>
                                                            setMoveQtyByItem((prev) => ({
                                                                ...prev,
                                                                [item.id]: e.target.value,
                                                            }))
                                                        }
                                                        onBlur={() => applyMoveForItem(index)}
                                                        className="w-full min-w-0 pl-2 pr-3 py-2 bg-amber-50/80 border border-amber-200/80 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-mono text-sm"
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2 pl-1">
                                                <Store className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                                                <span className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm font-semibold text-slate-800 min-w-[4.5rem] inline-block">
                                                    {formatNumber(item.shop_quantity, 3)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-start gap-2 text-slate-500 text-sm italic">
                        <Calculator className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            Moves are logged when you save. Adjust quantities only via Move Qty (tab out to apply). Warehouse + Shop always equals total per line.
                        </span>
                    </div>
                    <div className="flex gap-3 shrink-0">
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
