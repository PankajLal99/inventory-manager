import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import { Printer, Save, RotateCcw, Ruler, Type, Store } from 'lucide-react';
import {
  type ThermalPrintSettings,
  DEFAULT_THERMAL_PRINT_SETTINGS,
  THERMAL_PAPER_PRESETS,
  THERMAL_FONT_OPTIONS,
  THERMAL_79MM_ROLL_SETTINGS,
  THERMAL_ROLL_SPEC_GUIDE,
  loadThermalPrintSettings,
  saveThermalPrintSettings,
  resolveThermalFont,
} from '../utils/thermalPrintStyles';

interface ThermalPrintSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function NumberField({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={String(min)}
          max={String(max)}
          step={String(step)}
          value={value.toString()}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isNaN(val)) return;
            onChange(Math.max(min, Math.min(max, val)));
          }}
          className="flex-1"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
      </div>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function FontSelect({
  label,
  value,
  globalFont,
  onChange,
}: {
  label: string;
  value: string;
  globalFont: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default ({globalFont})</option>
      {THERMAL_FONT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}

function BoldToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pt-7">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );
}

function ThermalReceiptPreview({ settings }: { settings: ThermalPrintSettings }) {
  const previewScale = Math.min(280 / settings.paperWidthMm, 1.2);
  const previewWidth = settings.paperWidthMm * previewScale;
  const pageMargin = settings.pageMarginMm * previewScale;
  const contentPadding = settings.contentPaddingPx * previewScale;
  const fontStack = resolveThermalFont(settings.fontFamily, settings.fontFamily);
  const shopFont = resolveThermalFont(settings.shopNameFontFamily, settings.fontFamily);
  const subFont = resolveThermalFont(settings.subHeaderFontFamily, settings.fontFamily);
  const titleFont = resolveThermalFont(settings.documentTitleFontFamily, settings.fontFamily);
  const footerFont = resolveThermalFont(settings.footerFontFamily, settings.fontFamily);

  const scaled = (px: number) => px * previewScale;

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative bg-white border-2 border-gray-400 shadow-lg overflow-hidden"
        style={{ width: `${previewWidth}px` }}
      >
        <div
          className="absolute inset-0 bg-gray-100 opacity-40 pointer-events-none"
          style={{
            top: `${pageMargin}px`,
            left: `${pageMargin}px`,
            right: `${pageMargin}px`,
            bottom: `${pageMargin}px`,
          }}
        />
        <div
          style={{
            fontFamily: fontStack,
            fontSize: `${scaled(settings.fontSizeBody)}px`,
            padding: `${contentPadding}px`,
            color: '#000',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              marginBottom: `${scaled(8)}px`,
              borderBottom: '1px dashed #000',
              paddingBottom: `${scaled(5)}px`,
            }}
          >
            {settings.shopName.trim() && (
              <div
                style={{
                  fontFamily: shopFont,
                  fontSize: `${scaled(settings.shopNameFontSize)}px`,
                  fontWeight: settings.shopNameBold ? 'bold' : 'normal',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  lineHeight: 1.2,
                  marginBottom: `${scaled(2)}px`,
                }}
              >
                {settings.shopName}
              </div>
            )}
            {[settings.addressLine1, settings.addressLine2, settings.subHeaderLine1, settings.subHeaderLine2]
              .filter((line) => line.trim())
              .map((line) => (
                <div
                  key={line}
                  style={{
                    fontFamily: subFont,
                    fontSize: `${scaled(settings.subHeaderFontSize)}px`,
                    fontWeight: settings.subHeadersBold ? 'bold' : 'normal',
                    margin: `${scaled(1)}px 0`,
                    lineHeight: 1.25,
                  }}
                >
                  {line}
                </div>
              ))}
            <div
              style={{
                fontFamily: titleFont,
                fontSize: `${scaled(settings.fontSizeHeader)}px`,
                fontWeight: settings.documentTitleBold ? 'bold' : 'normal',
                marginTop: `${scaled(4)}px`,
                marginBottom: `${scaled(3)}px`,
              }}
            >
              {settings.documentTitle}
            </div>
            <div style={{ fontSize: `${scaled(settings.fontSizeSmall)}px` }}>INV-2026-001</div>
            <div style={{ fontSize: `${scaled(settings.fontSizeSmall)}px` }}>20 Jul 2026, 04:30 PM</div>
          </div>
          {(settings.showInvoiceStore || settings.showCustomer) && (
            <div style={{ fontSize: `${scaled(settings.fontSizeSmall)}px`, marginBottom: `${scaled(6)}px` }}>
              {settings.showInvoiceStore && <div>Store: Main Store</div>}
              {settings.showCustomer && <div>Customer: Walk-in</div>}
            </div>
          )}
          <table style={{ width: '100%', fontSize: `${scaled(settings.fontSizeTable)}px`, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px dashed #000' }}>Item</th>
                <th style={{ textAlign: 'right', borderBottom: '1px dashed #000' }}>Qty</th>
                <th style={{ textAlign: 'right', borderBottom: '1px dashed #000' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{'Sample Product'.substring(0, settings.itemNameMaxChars)}</td>
                <td style={{ textAlign: 'right' }}>2</td>
                <td style={{ textAlign: 'right' }}>₹500</td>
              </tr>
            </tbody>
          </table>
          <div
            style={{
              marginTop: `${scaled(6)}px`,
              borderTop: '1px dashed #000',
              paddingTop: `${scaled(4)}px`,
              fontSize: `${scaled(settings.fontSizeSmall)}px`,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid #000',
                marginTop: `${scaled(4)}px`,
                paddingTop: `${scaled(4)}px`,
                fontWeight: 'bold',
                fontSize: `${scaled(settings.fontSizeTotal)}px`,
              }}
            >
              <span>TOTAL:</span>
              <span>₹500</span>
            </div>
          </div>
          {settings.footerMessage.trim() && (
            <div
              style={{
                marginTop: `${scaled(8)}px`,
                paddingTop: `${scaled(4)}px`,
                borderTop: '1px dashed #000',
                textAlign: 'center',
                fontSize: `${scaled(settings.fontSizeFooter)}px`,
                fontFamily: footerFont,
                fontWeight: settings.footerBold ? 'bold' : 'normal',
              }}
            >
              {settings.footerMessage}
            </div>
          )}
        </div>
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-600 font-mono whitespace-nowrap">
          {settings.paperWidthMm}mm wide
        </div>
      </div>
    </div>
  );
}

export default function ThermalPrintSettingsModal({ isOpen, onClose }: ThermalPrintSettingsModalProps) {
  const [settings, setSettings] = useState<ThermalPrintSettings>(loadThermalPrintSettings());
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(loadThermalPrintSettings());
      setHasChanges(false);
    }
  }, [isOpen]);

  const handleChange = <K extends keyof ThermalPrintSettings>(key: K, value: ThermalPrintSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveThermalPrintSettings(settings);
    setHasChanges(false);
    alert('Thermal print settings saved successfully!');
  };

  const handleReset = () => {
    if (window.confirm('Reset all thermal print settings to default values?')) {
      setSettings(DEFAULT_THERMAL_PRINT_SETTINGS);
      setHasChanges(true);
    }
  };

  const handleApply = () => {
    handleSave();
    onClose();
  };

  const handleApply79mmRoll = () => {
    setSettings((prev) => ({ ...prev, ...THERMAL_79MM_ROLL_SETTINGS }));
    setHasChanges(true);
  };

  const presetMatch = THERMAL_PAPER_PRESETS.find((p) => p.widthMm === settings.paperWidthMm);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Thermal Print Settings" size="xl">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Store className="h-5 w-5" />
            Receipt Header
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Shop / Business Name"
              value={settings.shopName}
              onChange={(e) => handleChange('shopName', e.target.value)}
              placeholder="MANISH TRADERS"
            />
            <NumberField
              label="Shop Name Font Size (px)"
              min={10}
              max={28}
              step={1}
              value={settings.shopNameFontSize}
              onChange={(v) => handleChange('shopNameFontSize', v)}
            />
            <FontSelect
              label="Shop Name Font"
              value={settings.shopNameFontFamily}
              globalFont={settings.fontFamily}
              onChange={(v) => handleChange('shopNameFontFamily', v)}
            />
            <BoldToggle
              label="Shop name bold"
              checked={settings.shopNameBold}
              onChange={(v) => handleChange('shopNameBold', v)}
            />
            <Input
              label="Address Line 1"
              value={settings.addressLine1}
              onChange={(e) => handleChange('addressLine1', e.target.value)}
              placeholder="123 Main Street, City"
            />
            <Input
              label="Address Line 2"
              value={settings.addressLine2}
              onChange={(e) => handleChange('addressLine2', e.target.value)}
              placeholder="State, PIN"
            />
            <Input
              label="Sub-header Line 1 (Phone, etc.)"
              value={settings.subHeaderLine1}
              onChange={(e) => handleChange('subHeaderLine1', e.target.value)}
              placeholder="Ph: +91 98765 43210"
            />
            <Input
              label="Sub-header Line 2 (GST, etc.)"
              value={settings.subHeaderLine2}
              onChange={(e) => handleChange('subHeaderLine2', e.target.value)}
              placeholder="GSTIN: 09XXXXX1234X1Z5"
            />
            <NumberField
              label="Sub-header Font Size (px)"
              min={6}
              max={14}
              step={1}
              value={settings.subHeaderFontSize}
              onChange={(v) => handleChange('subHeaderFontSize', v)}
            />
            <FontSelect
              label="Sub-header Font"
              value={settings.subHeaderFontFamily}
              globalFont={settings.fontFamily}
              onChange={(v) => handleChange('subHeaderFontFamily', v)}
            />
            <BoldToggle
              label="Sub-headers bold"
              checked={settings.subHeadersBold}
              onChange={(v) => handleChange('subHeadersBold', v)}
            />
            <Input
              label="Document Title"
              value={settings.documentTitle}
              onChange={(e) => handleChange('documentTitle', e.target.value)}
              placeholder="INVOICE"
            />
            <NumberField
              label="Document Title Font Size (px)"
              min={10}
              max={24}
              step={1}
              value={settings.fontSizeHeader}
              onChange={(v) => handleChange('fontSizeHeader', v)}
            />
            <FontSelect
              label="Document Title Font"
              value={settings.documentTitleFontFamily}
              globalFont={settings.fontFamily}
              onChange={(v) => handleChange('documentTitleFontFamily', v)}
            />
            <BoldToggle
              label="Document title bold"
              checked={settings.documentTitleBold}
              onChange={(v) => handleChange('documentTitleBold', v)}
            />
            <Input
              label="Footer Message"
              value={settings.footerMessage}
              onChange={(e) => handleChange('footerMessage', e.target.value)}
              placeholder="Thank you for your business!"
            />
            <NumberField
              label="Footer Font Size (px)"
              min={6}
              max={12}
              step={1}
              value={settings.fontSizeFooter}
              onChange={(v) => handleChange('fontSizeFooter', v)}
            />
            <FontSelect
              label="Footer Font"
              value={settings.footerFontFamily}
              globalFont={settings.fontFamily}
              onChange={(v) => handleChange('footerFontFamily', v)}
            />
            <BoldToggle
              label="Footer bold"
              checked={settings.footerBold}
              onChange={(v) => handleChange('footerBold', v)}
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showInvoiceStore}
                onChange={(e) => handleChange('showInvoiceStore', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show store name from invoice
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showCustomer}
                onChange={(e) => handleChange('showCustomer', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show customer on receipt
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Ruler className="h-5 w-5" />
            Paper & Layout
          </h3>

          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-900">Your roll: 7.9 cm wide thermal paper</p>
                <p className="text-xs text-blue-800 mt-1">
                  Only the <strong>7.9 cm width</strong> matters for print settings. The other numbers on the box (45 cm length, 54 gsm, 1.3 cm core) do not change layout.
                </p>
              </div>
              <Button
                type="button"
                onClick={handleApply79mmRoll}
                className="shrink-0 bg-blue-600 hover:bg-blue-700"
              >
                Use 7.9 cm roll preset
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-blue-900 border-b border-blue-200">
                    <th className="py-1.5 pr-3 font-semibold">On the roll</th>
                    <th className="py-1.5 pr-3 font-semibold">What it means</th>
                    <th className="py-1.5 font-semibold">In app</th>
                  </tr>
                </thead>
                <tbody className="text-blue-800">
                  {THERMAL_ROLL_SPEC_GUIDE.map((row) => (
                    <tr key={row.spec} className="border-b border-blue-100 last:border-0">
                      <td className="py-1.5 pr-3 font-mono">{row.spec}</td>
                      <td className="py-1.5 pr-3">{row.meaning}</td>
                      <td className="py-1.5">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Select
                label="Paper Width"
                value={presetMatch ? String(settings.paperWidthMm) : 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') {
                    handleChange('paperWidthMm', parseFloat(val));
                  }
                }}
              >
                {THERMAL_PAPER_PRESETS.map((preset) => (
                  <option key={preset.widthMm} value={preset.widthMm}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom (adjust mm below)</option>
              </Select>
              {presetMatch?.note && (
                <p className="text-xs text-gray-500 mt-1">{presetMatch.note}</p>
              )}
            </div>
            <NumberField
              label="Paper Width (mm)"
              hint="7.9 cm = 79 mm. Fine-tune if text is cut off on the sides."
              min={40}
              max={120}
              step={0.1}
              value={settings.paperWidthMm}
              onChange={(v) => handleChange('paperWidthMm', v)}
            />
            <NumberField
              label="Page Margin (mm)"
              hint="Margin on all sides of the printed page"
              min={0}
              max={10}
              step={0.1}
              value={settings.pageMarginMm}
              onChange={(v) => handleChange('pageMarginMm', v)}
            />
            <NumberField
              label="Content Padding (px)"
              hint="Inner padding around receipt content"
              min={0}
              max={20}
              step={1}
              value={settings.contentPaddingPx}
              onChange={(v) => handleChange('contentPaddingPx', v)}
            />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Type className="h-5 w-5" />
            Body & Table Fonts
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Default Font Family"
              value={settings.fontFamily}
              onChange={(e) => handleChange('fontFamily', e.target.value)}
            >
              {THERMAL_FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <NumberField
              label="Item Name Max Characters"
              hint="Longer names are truncated on thermal receipts"
              min={10}
              max={40}
              step={1}
              value={settings.itemNameMaxChars}
              onChange={(v) => handleChange('itemNameMaxChars', v)}
            />
            <NumberField label="Body Font Size (px)" min={7} max={16} step={1} value={settings.fontSizeBody} onChange={(v) => handleChange('fontSizeBody', v)} />
            <NumberField label="Small Text Size (px)" min={6} max={14} step={1} value={settings.fontSizeSmall} onChange={(v) => handleChange('fontSizeSmall', v)} />
            <NumberField label="Table Font Size (px)" min={6} max={14} step={1} value={settings.fontSizeTable} onChange={(v) => handleChange('fontSizeTable', v)} />
            <NumberField label="Total Font Size (px)" min={8} max={18} step={1} value={settings.fontSizeTotal} onChange={(v) => handleChange('fontSizeTotal', v)} />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Preview</h3>
          <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-6 flex justify-center overflow-auto">
            <ThermalReceiptPreview settings={settings} />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <Button variant="outline" onClick={handleReset} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset to Default
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} disabled={hasChanges}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges} className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button onClick={handleApply} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700">
              <Printer className="h-4 w-4" />
              Save & Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
