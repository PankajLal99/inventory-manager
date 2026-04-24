import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import { Printer, Save, RotateCcw, Ruler, Type } from 'lucide-react';

export interface ThermalPrintSettings {
  paperWidth: number;      // mm — default 72
  paperHeight: number;     // mm — 0 means auto
  fontSize: number;        // px — default 10
  headerFontSize: number;  // px — default 14
  fontWeight: 'normal' | 'bold' | '900'; // font weight
  fontFamily: 'monospace' | 'sans-serif';
  textStroke: number;      // 0–1.2 px — adds CSS -webkit-text-stroke for extra ink darkness
}

const DEFAULT_SETTINGS: ThermalPrintSettings = {
  paperWidth: 72,
  paperHeight: 0,        // 0 = auto
  fontSize: 10,
  headerFontSize: 14,
  fontWeight: 'normal',
  fontFamily: 'monospace',
  textStroke: 0,
};

const STORAGE_KEY = 'thermal_print_settings';

export const loadThermalPrintSettings = (): ThermalPrintSettings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load thermal print settings:', error);
  }
  return DEFAULT_SETTINGS;
};

export const saveThermalPrintSettings = (settings: ThermalPrintSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save thermal print settings:', error);
  }
};

interface ThermalPrintSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FONT_WEIGHT_OPTIONS: { value: ThermalPrintSettings['fontWeight']; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Standard weight — default for most thermal printers' },
  { value: 'bold', label: 'Bold', description: 'Darker / heavier — good for low-contrast printers' },
  { value: '900', label: 'Extra Bold', description: 'Maximum darkness — for very faint print output' },
];

const FONT_FAMILY_OPTIONS: { value: ThermalPrintSettings['fontFamily']; label: string }[] = [
  { value: 'monospace', label: 'Monospace (Courier)' },
  { value: 'sans-serif', label: 'Sans-Serif (Arial)' },
];

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
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveThermalPrintSettings(settings);
    setHasChanges(false);
    alert('Thermal print settings saved successfully!');
  };

  const handleReset = () => {
    if (window.confirm('Reset all thermal print settings to default values?')) {
      setSettings(DEFAULT_SETTINGS);
      setHasChanges(true);
    }
  };

  const handleApply = () => {
    saveThermalPrintSettings(settings);
    setHasChanges(false);
    onClose();
  };

  const paperWidthIn = (settings.paperWidth / 25.4).toFixed(2);
  const paperHeightLabel = settings.paperHeight === 0 ? 'Auto' : `${settings.paperHeight} mm`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Thermal Print Settings"
      size="xl"
    >
      <div className="space-y-6">

        {/* Paper Size */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Ruler className="h-5 w-5" />
            Paper Size
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Paper Width */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Paper Width (mm)
                <span className="ml-2 text-xs text-gray-400">≈ {paperWidthIn} in</span>
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="48"
                  max="120"
                  step="1"
                  value={settings.paperWidth.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 48;
                    handleChange('paperWidth', Math.max(48, Math.min(120, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="48"
                  max="120"
                  step="1"
                  value={settings.paperWidth}
                  onChange={(e) => handleChange('paperWidth', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[58, 72, 80].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleChange('paperWidth', w)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      settings.paperWidth === w
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {w}mm
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Common: 58mm (2¼in), 72mm, 80mm (3⅛in)</p>
            </div>

            {/* Paper Height */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Paper Height (mm)
                <span className="ml-2 text-xs text-gray-400">{paperHeightLabel}</span>
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="0"
                  max="500"
                  step="10"
                  value={settings.paperHeight === 0 ? '' : settings.paperHeight.toString()}
                  placeholder="0 = auto"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const val = raw === '' ? 0 : parseFloat(raw) || 0;
                    handleChange('paperHeight', Math.max(0, Math.min(500, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="10"
                  value={settings.paperHeight}
                  onChange={(e) => handleChange('paperHeight', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[{ label: 'Auto', val: 0 }, { label: '210mm', val: 210 }, { label: '297mm', val: 297 }].map(({ label, val }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleChange('paperHeight', val)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      settings.paperHeight === val
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Set to 0 for continuous / roll paper (recommended)</p>
            </div>
          </div>
        </div>

        {/* Typography */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Type className="h-5 w-5" />
            Typography &amp; Darkness
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Body Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Body Font Size (px)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="8"
                  max="16"
                  step="1"
                  value={settings.fontSize.toString()}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 8;
                    handleChange('fontSize', Math.max(8, Math.min(16, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="8"
                  max="16"
                  step="1"
                  value={settings.fontSize}
                  onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[9, 10, 11, 12].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleChange('fontSize', s)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      settings.fontSize === s
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {s}px
                  </button>
                ))}
              </div>
            </div>

            {/* Header Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Header Font Size (px)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="10"
                  max="22"
                  step="1"
                  value={settings.headerFontSize.toString()}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 10;
                    handleChange('headerFontSize', Math.max(10, Math.min(22, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="10"
                  max="22"
                  step="1"
                  value={settings.headerFontSize}
                  onChange={(e) => handleChange('headerFontSize', parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[12, 14, 16, 18].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleChange('headerFontSize', s)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      settings.headerFontSize === s
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {s}px
                  </button>
                ))}
              </div>
            </div>

            {/* Font Weight / Darkness */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Font Darkness (font-weight)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {FONT_WEIGHT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleChange('fontWeight', opt.value)}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      settings.fontWeight === opt.value
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div
                      className="text-base mb-1"
                      style={{ fontWeight: opt.value, fontFamily: settings.fontFamily === 'monospace' ? 'Courier New, monospace' : 'Arial, sans-serif' }}
                    >
                      {opt.label}
                    </div>
                    <div className="text-xs text-gray-500">{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Text Stroke / Darkness */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Text Darkness — Stroke Width
                <span className="ml-2 text-xs text-gray-400">
                  {settings.textStroke === 0 ? 'Off (default)' : `${settings.textStroke}px stroke`}
                </span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1.2"
                  step="0.1"
                  value={settings.textStroke}
                  onChange={(e) => handleChange('textStroke', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <Input
                  type="number"
                  min="0"
                  max="1.2"
                  step="0.1"
                  value={settings.textStroke.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    handleChange('textStroke', isNaN(val) ? 0 : Math.max(0, Math.min(1.2, val)));
                  }}
                  className="w-20"
                />
              </div>
              <div className="flex gap-2 mt-2">
                {[{ label: 'Off', val: 0 }, { label: 'Light', val: 0.3 }, { label: 'Medium', val: 0.5 }, { label: 'Heavy', val: 0.8 }, { label: 'Max', val: 1.2 }].map(({ label, val }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleChange('textStroke', val)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      settings.textStroke === val
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Adds a CSS text stroke to push more ink — useful when thermal output looks faint
              </p>
            </div>

            {/* Font Family */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Font Family
              </label>
              <div className="flex gap-3">
                {FONT_FAMILY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleChange('fontFamily', opt.value)}
                    className={`flex-1 p-3 rounded-lg border-2 text-left transition-all ${
                      settings.fontFamily === opt.value
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span
                      className="text-sm"
                      style={{ fontFamily: opt.value === 'monospace' ? 'Courier New, monospace' : 'Arial, sans-serif' }}
                    >
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Summary / Preview */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Live Preview</h4>
          <div
            className="bg-white border border-gray-300 rounded p-3 max-w-xs mx-auto"
            style={{
              width: `${Math.min(settings.paperWidth * 2.5, 280)}px`,
              fontFamily: settings.fontFamily === 'monospace' ? 'Courier New, monospace' : 'Arial, sans-serif',
              fontSize: `${settings.fontSize}px`,
              fontWeight: settings.fontWeight,
              color: '#000',
              WebkitTextStroke: settings.textStroke > 0 ? `${settings.textStroke}px #000` : undefined,
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: 4, marginBottom: 4 }}>
              <div style={{ fontSize: settings.headerFontSize, fontWeight: 'bold' }}>INVOICE</div>
              <div style={{ fontSize: settings.fontSize - 1 }}>INV-2024-001</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span>Item A</span>
              <span>₹250.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span>Item B</span>
              <span>₹150.00</span>
            </div>
            <div style={{ borderTop: '1px dashed #000', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
              <span>TOTAL</span>
              <span>₹400.00</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-600 space-y-1 text-center">
            <p><span className="font-medium">Paper:</span> {settings.paperWidth}mm × {settings.paperHeight === 0 ? 'auto' : `${settings.paperHeight}mm`}</p>
            <p><span className="font-medium">Font:</span> {settings.fontSize}px body / {settings.headerFontSize}px header · weight {settings.fontWeight}{settings.textStroke > 0 ? ` · stroke ${settings.textStroke}px` : ''}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={handleReset}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Default
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button
              onClick={handleApply}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              Save &amp; Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
