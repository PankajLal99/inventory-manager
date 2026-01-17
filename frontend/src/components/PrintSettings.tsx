import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import { Printer, Save, RotateCcw, Ruler } from 'lucide-react';

export interface PrintSettings {
  pageMargin: number; // mm
  labelWidth: number; // mm
  labelHeight: number; // mm
  gapBetweenLabels: number; // mm
}

const DEFAULT_SETTINGS: PrintSettings = {
  pageMargin: 0.5,
  labelWidth: 50,
  labelHeight: 25,
  gapBetweenLabels: 3,
};

const STORAGE_KEY = 'print_settings';

export const loadPrintSettings = (): PrintSettings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load print settings:', error);
  }
  return DEFAULT_SETTINGS;
};

export const savePrintSettings = (settings: PrintSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save print settings:', error);
  }
};

interface PrintSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PrintSettingsModal({ isOpen, onClose }: PrintSettingsModalProps) {
  const [settings, setSettings] = useState<PrintSettings>(loadPrintSettings());
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(loadPrintSettings());
      setHasChanges(false);
    }
  }, [isOpen]);

  const handleChange = (key: keyof PrintSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    savePrintSettings(settings);
    setHasChanges(false);
    // Show success message
    alert('Print settings saved successfully!');
  };

  const handleReset = () => {
    if (window.confirm('Reset all print settings to default values?')) {
      setSettings(DEFAULT_SETTINGS);
      setHasChanges(true);
    }
  };

  const handleApply = () => {
    handleSave();
    onClose();
  };

  // Calculate printable area
  const printableWidth = settings.labelWidth - (settings.pageMargin * 2);
  const printableHeight = settings.labelHeight - (settings.pageMargin * 2);

  // Scale factor for preview (fit in 400px width)
  const previewScale = Math.min(400 / settings.labelWidth, 300 / settings.labelHeight);
  const previewWidth = settings.labelWidth * previewScale;
  const previewHeight = settings.labelHeight * previewScale;
  const previewMargin = settings.pageMargin * previewScale;
  const previewPrintableWidth = printableWidth * previewScale;
  const previewPrintableHeight = printableHeight * previewScale;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Print Settings"
      size="xl"
    >
      <div className="space-y-6">
        {/* Settings Section */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Ruler className="h-5 w-5" />
            Dimensions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Label Width */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Label Width (mm)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="20"
                  max="100"
                  step="1"
                  value={settings.labelWidth.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 20;
                    handleChange('labelWidth', Math.max(20, Math.min(100, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="20"
                  max="100"
                  step="1"
                  value={settings.labelWidth}
                  onChange={(e) => handleChange('labelWidth', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            </div>

            {/* Label Height */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Label Height (mm)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="10"
                  max="50"
                  step="1"
                  value={settings.labelHeight.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 10;
                    handleChange('labelHeight', Math.max(10, Math.min(50, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="10"
                  max="50"
                  step="1"
                  value={settings.labelHeight}
                  onChange={(e) => handleChange('labelHeight', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            </div>

            {/* Page Margin */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Page Margin (mm)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={settings.pageMargin.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    handleChange('pageMargin', Math.max(0, Math.min(5, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={settings.pageMargin}
                  onChange={(e) => handleChange('pageMargin', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Margin on all sides of the page
              </p>
            </div>

            {/* Gap Between Labels */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gap Between Labels (mm)
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={settings.gapBetweenLabels.toString()}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    handleChange('gapBetweenLabels', Math.max(0, Math.min(10, val)));
                  }}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={settings.gapBetweenLabels}
                  onChange={(e) => handleChange('gapBetweenLabels', parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Spacing between labels when printing multiple
              </p>
            </div>

            {/* Summary Info */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Summary</h4>
              <div className="text-xs text-gray-700 space-y-1">
                <p><span className="font-medium">Page Size:</span> {settings.labelWidth}mm × {settings.labelHeight}mm</p>
                <p><span className="font-medium">Printable Area:</span> {printableWidth.toFixed(1)}mm × {printableHeight.toFixed(1)}mm</p>
                <p><span className="font-medium">Margins:</span> {settings.pageMargin}mm (all sides)</p>
                <p><span className="font-medium">Gap:</span> {settings.gapBetweenLabels}mm</p>
              </div>
            </div>
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
              disabled={hasChanges}
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
              Save & Close
            </Button>
          </div>
        </div>

        {/* Visual Preview with Ruler */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Preview</h3>
          <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center overflow-auto">
            <div className="flex flex-col">
              {/* Ruler - Top */}
              <div className="flex mb-1">
                <div className="w-8 h-6"></div>
                <div className="relative bg-gradient-to-b from-gray-50 to-gray-100 border border-gray-400 rounded-t shadow-sm" style={{ width: `${previewWidth}px`, height: '24px' }}>
                  {/* Major ticks every 10mm */}
                  {Array.from({ length: Math.ceil(settings.labelWidth / 10) + 1 }).map((_, i) => {
                    const pos = (i * 10 * previewScale);
                    const value = i * 10;
                    if (value > settings.labelWidth) return null;
                    return (
                      <div key={`top-major-${i}`} className="absolute" style={{ left: `${pos}px` }}>
                        <div className="border-l-2 border-gray-700" style={{ height: '16px' }}></div>
                        <div className="absolute top-0 left-0.5 text-[10px] font-semibold text-gray-800 font-mono leading-none mt-0.5">
                          {value}
                        </div>
                      </div>
                    );
                  })}
                  {/* Minor ticks every 5mm */}
                  {Array.from({ length: Math.ceil(settings.labelWidth / 5) + 1 }).map((_, i) => {
                    const pos = (i * 5 * previewScale);
                    const value = i * 5;
                    if (value > settings.labelWidth || value % 10 === 0) return null;
                    return (
                      <div
                        key={`top-minor-${i}`}
                        className="absolute border-l border-gray-500"
                        style={{
                          left: `${pos}px`,
                          height: '10px',
                        }}
                      />
                    );
                  })}
                  {/* Small ticks every 1mm */}
                  {Array.from({ length: Math.ceil(settings.labelWidth) + 1 }).map((_, i) => {
                    const pos = (i * previewScale);
                    const value = i;
                    if (value > settings.labelWidth || value % 5 === 0) return null;
                    return (
                      <div
                        key={`top-tiny-${i}`}
                        className="absolute border-l border-gray-400"
                        style={{
                          left: `${pos}px`,
                          height: '6px',
                          top: '18px',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Main Content Row: Left Ruler + Label Preview */}
              <div className="flex">
                {/* Ruler - Left */}
                <div className="mr-1">
                  <div className="relative bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-400 rounded-l shadow-sm" style={{ width: '24px', height: `${previewHeight}px` }}>
                    {/* Major ticks every 10mm */}
                    {Array.from({ length: Math.ceil(settings.labelHeight / 10) + 1 }).map((_, i) => {
                      const pos = (i * 10 * previewScale);
                      const value = i * 10;
                      if (value > settings.labelHeight) return null;
                      return (
                        <div key={`left-major-${i}`} className="absolute" style={{ top: `${pos}px` }}>
                          <div className="border-t-2 border-gray-700" style={{ width: '16px' }}></div>
                          <div
                            className="absolute left-0 top-0 text-[10px] font-semibold text-gray-800 font-mono leading-none ml-0.5 -mt-1"
                            style={{
                              transform: 'rotate(-90deg)',
                              transformOrigin: 'left center',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      );
                    })}
                    {/* Minor ticks every 5mm */}
                    {Array.from({ length: Math.ceil(settings.labelHeight / 5) + 1 }).map((_, i) => {
                      const pos = (i * 5 * previewScale);
                      const value = i * 5;
                      if (value > settings.labelHeight || value % 10 === 0) return null;
                      return (
                        <div
                          key={`left-minor-${i}`}
                          className="absolute border-t border-gray-500"
                          style={{
                            top: `${pos}px`,
                            width: '10px',
                          }}
                        />
                      );
                    })}
                    {/* Small ticks every 1mm */}
                    {Array.from({ length: Math.ceil(settings.labelHeight) + 1 }).map((_, i) => {
                      const pos = (i * previewScale);
                      const value = i;
                      if (value > settings.labelHeight || value % 5 === 0) return null;
                      return (
                        <div
                          key={`left-tiny-${i}`}
                          className="absolute border-t border-gray-400"
                          style={{
                            top: `${pos}px`,
                            width: '6px',
                            left: '18px',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Label Preview */}
                <div
                  className="relative bg-white border-2 border-gray-400 shadow-lg"
                  style={{
                    width: `${previewWidth}px`,
                    height: `${previewHeight}px`,
                  }}
                >
                  {/* Margin Area (shaded) */}
                  <div
                    className="absolute bg-gray-200 opacity-50"
                    style={{
                      top: `${previewMargin}px`,
                      left: `${previewMargin}px`,
                      width: `${previewPrintableWidth}px`,
                      height: `${previewPrintableHeight}px`,
                    }}
                  />

                  {/* Printable Area Border */}
                  <div
                    className="absolute border-2 border-dashed border-blue-500 bg-blue-50 bg-opacity-30"
                    style={{
                      top: `${previewMargin}px`,
                      left: `${previewMargin}px`,
                      width: `${previewPrintableWidth}px`,
                      height: `${previewPrintableHeight}px`,
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-medium text-blue-700 bg-white px-2 py-1 rounded shadow">
                        Printable Area
                      </span>
                    </div>
                  </div>

                  {/* Corner markers for margins */}
                  <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-red-500" style={{ top: `${previewMargin}px`, left: `${previewMargin}px` }} />
                  <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-red-500" style={{ top: `${previewMargin}px`, right: `${previewMargin}px` }} />
                  <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-red-500" style={{ bottom: `${previewMargin}px`, left: `${previewMargin}px` }} />
                  <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-red-500" style={{ bottom: `${previewMargin}px`, right: `${previewMargin}px` }} />

                  {/* Dimension labels */}
                  <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-xs text-gray-600 font-mono whitespace-nowrap">
                    {settings.labelWidth}mm
                  </div>
                  <div className="absolute -right-6 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-600 font-mono whitespace-nowrap">
                    {settings.labelHeight}mm
                  </div>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-white border-2 border-gray-400"></div>
                <span className="text-gray-600">Label Size ({settings.labelWidth}mm × {settings.labelHeight}mm)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-gray-200"></div>
                <span className="text-gray-600">Margin Area ({settings.pageMargin}mm)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-dashed border-blue-500 bg-blue-50"></div>
                <span className="text-gray-600">Printable Area ({printableWidth.toFixed(1)}mm × {printableHeight.toFixed(1)}mm)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
