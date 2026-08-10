import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import {
  PRODUCT_EXPORT_COLUMNS,
  defaultProductExportColumnIds,
  exportProductsToPdf,
  formatFallbackPriceChange,
  getSellingPriceFallbackInfo,
  type ProductExportColumnId,
  type SellingPriceFallbackInfo,
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
  const [pendingProducts, setPendingProducts] = useState<any[] | null>(null);
  const [fallbackInfo, setFallbackInfo] = useState<SellingPriceFallbackInfo | null>(null);
  const [pendingOffset, setPendingOffset] = useState(0);

  const selectedCount = selectedIds.length;
  const includesPriceColumn = selectedIds.includes('price');
  const showFallbackWarning =
    pendingProducts !== null && fallbackInfo !== null && fallbackInfo.count > 0;

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

  const resetPending = () => {
    setPendingProducts(null);
    setFallbackInfo(null);
    setPendingOffset(0);
  };

  const runPdfExport = (products: any[], priceOffset: number) => {
    exportProductsToPdf({
      products,
      columnIds: selectedIds,
      tagFilter,
      filterLabels,
      priceOffset,
    });
    resetPending();
    onClose();
  };

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

      if (selectedIds.includes('price')) {
        const fallback = getSellingPriceFallbackInfo(products, priceOffset);
        if (fallback.count > 0) {
          setPendingProducts(products);
          setFallbackInfo(fallback);
          setPendingOffset(priceOffset);
          return;
        }
      }

      runPdfExport(products, priceOffset);
    } catch (e: any) {
      setError(e?.message || 'Failed to export products.');
    } finally {
      setExporting(false);
    }
  };

  const handleContinueAfterWarning = () => {
    if (!pendingProducts) return;
    setExporting(true);
    try {
      runPdfExport(pendingProducts, pendingOffset);
    } catch (e: any) {
      setError(e?.message || 'Failed to export products.');
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    resetPending();
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen && !showFallbackWarning} onClose={handleClose} title="Export Products to PDF" size="md">
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
            Adds this amount to the Price column in the PDF only. Database prices are not changed.
            {!includesPriceColumn ? (
              <span className="block mt-1 text-amber-600">
                Select Price above for this to appear in the PDF.
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
            <Button variant="outline" onClick={handleClose} disabled={exporting}>
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

      <Modal
        isOpen={isOpen && showFallbackWarning}
        onClose={() => {
          resetPending();
        }}
        title="Selling price missing"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm text-gray-700">
                These products have empty/0 selling price. Purchase price will be used
                {pendingOffset > 0 ? ` (+${pendingOffset} adjustment)` : ''} in the PDF:
              </p>
            </div>
          </div>

          <div className="max-h-80 overflow-auto rounded-lg border border-amber-100 bg-amber-50/60 p-3 space-y-3">
            {fallbackInfo?.groups.map((categoryGroup) => (
              <div key={categoryGroup.category} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {categoryGroup.category}
                </div>
                {categoryGroup.brands.map((brandGroup) => (
                  <div key={`${categoryGroup.category}-${brandGroup.brand}`} className="pl-2 space-y-1.5">
                    <div className="text-xs font-medium text-amber-800">
                      {brandGroup.brand}
                    </div>
                    <ul className="pl-2 space-y-1">
                      {brandGroup.products.map((item) => (
                        <li
                          key={`${item.id ?? item.name}-${item.originalPrice}`}
                          className="flex items-start justify-between gap-3 text-sm text-gray-800"
                        >
                          <span className="min-w-0 break-words">{item.name}</span>
                          <span className="flex-shrink-0 font-medium tabular-nums text-gray-900">
                            {formatFallbackPriceChange(item)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={() => {
                resetPending();
              }}
              disabled={exporting}
            >
              Cancel
            </Button>
            <Button onClick={handleContinueAfterWarning} disabled={exporting}>
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 inline animate-spin" />
                  Exporting…
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
