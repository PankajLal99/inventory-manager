import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import {
  PRODUCT_EXPORT_COLUMNS,
  defaultProductExportColumnIds,
  exportProductsToPdf,
  type ProductExportColumnId,
} from '../../utils/exportProductsPdf';

type ProductExportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Fetch all products matching current filters (all pages). */
  fetchProducts: () => Promise<any[]>;
  tagFilter: string;
  filterLabels: string[];
  /** Currently loaded/visible count for preview copy. */
  visibleCount: number;
};

function parsePriceOffset(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export default function ProductExportModal({
  isOpen,
  onClose,
  fetchProducts,
  tagFilter,
  filterLabels,
  visibleCount,
}: ProductExportModalProps) {
  const [selectedIds, setSelectedIds] = useState<ProductExportColumnId[]>(
    () => defaultProductExportColumnIds()
  );
  const [priceOffsetInput, setPriceOffsetInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selectedIds.length;
  const includesPriceColumn =
    selectedIds.includes('purchase_price') || selectedIds.includes('selling_price');

  const previewNote = useMemo(() => {
    if (filterLabels.length === 0) {
      return `Exports all products in the current view (${visibleCount}+ loaded).`;
    }
    return `Exports products matching: ${filterLabels.join(', ')}`;
  }, [filterLabels, visibleCount]);

  const toggleColumn = (id: ProductExportColumnId) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        // Keep at least one column selected
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== id);
      }
      return [...prev, id];
    });
  };

  const selectDefaults = () => setSelectedIds(defaultProductExportColumnIds());
  const selectAll = () => setSelectedIds(PRODUCT_EXPORT_COLUMNS.map((c) => c.id));

  const handleExport = async () => {
    if (selectedIds.length === 0) {
      setError('Select at least one column.');
      return;
    }

    const priceOffset = parsePriceOffset(priceOffsetInput);
    if (priceOffset === null) {
      setError('Price adjustment must be a positive whole number (or leave blank).');
      return;
    }

    setError(null);
    setExporting(true);
    try {
      const products = await fetchProducts();
      if (!products.length) {
        setError('No products to export for the current filters.');
        return;
      }
      exportProductsToPdf({
        products,
        columnIds: selectedIds,
        tagFilter,
        filterLabels,
        priceOffset,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to export products.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export Products to PDF" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{previewNote}</p>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">
              Columns
              <span className="ml-2 text-xs font-normal text-gray-500">
                ({selectedCount} selected)
              </span>
            </h4>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectDefaults}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Defaults
              </button>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Select all
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-auto rounded-lg border border-gray-200 p-2">
            {PRODUCT_EXPORT_COLUMNS.map((col) => {
              const checked = selectedIds.includes(col.id);
              return (
                <label
                  key={col.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={checked}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span>
                    {col.label}
                    {col.defaultOn ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-400">
                        default
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <Input
            label="Price adjustment (PDF only)"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 50"
            value={priceOffsetInput}
            onChange={(e) => setPriceOffsetInput(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            Adds this amount to Purchase Price and/or Selling Price columns in the PDF only.
            Database prices are not changed.
            {!includesPriceColumn ? (
              <span className="block mt-1 text-amber-600">
                Select Purchase Price or Selling Price above for this to appear in the PDF.
              </span>
            ) : null}
          </p>
        </div>

        <p className="text-xs text-gray-500">
          PDF is grouped by category, then brand, and ends with a summary of product, category, and
          brand counts.
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || selectedIds.length === 0}>
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 inline animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2 inline" />
                Export PDF
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
