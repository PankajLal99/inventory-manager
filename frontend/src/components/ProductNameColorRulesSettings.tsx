import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import ProductName from './ProductName';
import HexColorPicker from './HexColorPicker';
import {
  ArrowDown,
  ArrowUp,
  Lock,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  buildProductNameSegments,
  createProductNameColorRule,
  loadCustomKeywordColorRules,
  PRODUCT_NAME_SCOPE_HELP,
  PRODUCT_NAME_SCOPE_LABELS,
  PRODUCT_NAME_SUPER_RULES,
  resetCustomKeywordColorRules,
  ruleScope,
  saveCustomKeywordColorRules,
  type ProductNameColorRule,
  type ProductNameColorRuleScope,
} from '../lib/productNameColorRules';

interface ProductNameColorRulesSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProductNameColorRulesSettingsModal({
  isOpen,
  onClose,
}: ProductNameColorRulesSettingsModalProps) {
  const [rules, setRules] = useState<ProductNameColorRule[]>(loadCustomKeywordColorRules());
  const [hasChanges, setHasChanges] = useState(false);
  const [previewName, setPreviewName] = useState('IMPORTED PESTING sample');

  useEffect(() => {
    if (isOpen) {
      setRules(loadCustomKeywordColorRules());
      setHasChanges(false);
    }
  }, [isOpen]);

  const previewSegments = useMemo(
    () => buildProductNameSegments(previewName, rules),
    [previewName, rules],
  );

  const updateRules = (next: ProductNameColorRule[]) => {
    setRules(next);
    setHasChanges(true);
  };

  const handleSave = () => {
    const cleaned = saveCustomKeywordColorRules(rules);
    setRules(cleaned);
    setHasChanges(false);
  };

  const handleApply = () => {
    handleSave();
    onClose();
  };

  const handleReset = () => {
    if (window.confirm('Remove all custom keyword color rules? (PESTING / NON PESTING super rules are always active.)')) {
      const defaults = resetCustomKeywordColorRules();
      setRules(defaults);
      setHasChanges(false);
    }
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    updateRules(next);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Product Name Color Rules"
      size="lg"
    >
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          <strong>Super rules</strong> color the entire product name for PESTING (green) or NON PESTING (red).
          <strong> Custom rules</strong> can color just the keyword or the whole name — saved shop-wide for all users.
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Lock className="h-4 w-4 text-gray-500" />
            Super rules (fixed)
          </div>
          <ul className="space-y-1.5 text-sm">
            {PRODUCT_NAME_SUPER_RULES.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-gray-700">{rule.keyword}</span>
                <span className="font-semibold" style={{ color: rule.color }}>
                  whole line → {rule.color}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-800">Custom keyword rules</h3>
          {rules.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No custom rules yet — add keywords to highlight specific words.</p>
          ) : null}
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(220px,1fr)_auto] gap-3 items-start">
                <div className="space-y-3">
                  <Input
                    label={index === 0 ? 'Keyword' : undefined}
                    value={rule.keyword}
                    onChange={(e) => {
                      const next = [...rules];
                      next[index] = { ...rule, keyword: e.target.value };
                      updateRules(next);
                    }}
                    placeholder='e.g. "IMPORTED"'
                  />
                  <div>
                    {index === 0 ? (
                      <label className="block text-sm font-medium text-gray-700 mb-1">Apply to</label>
                    ) : null}
                    <select
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={ruleScope(rule)}
                      onChange={(e) => {
                        const next = [...rules];
                        next[index] = {
                          ...rule,
                          scope: e.target.value as ProductNameColorRuleScope,
                        };
                        updateRules(next);
                      }}
                    >
                      <option value="keyword">{PRODUCT_NAME_SCOPE_LABELS.keyword}</option>
                      <option value="whole_line">{PRODUCT_NAME_SCOPE_LABELS.whole_line}</option>
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                      {PRODUCT_NAME_SCOPE_HELP[ruleScope(rule)]}
                    </p>
                    {ruleScope(rule) === 'whole_line' ? (
                      <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                        Whole-name rules override PESTING / NON PESTING super rules when this keyword matches —
                        even if the name also contains PESTING or NON PESTING.
                      </p>
                    ) : null}
                  </div>
                </div>
                <HexColorPicker
                  label={index === 0 ? 'Color' : undefined}
                  value={rule.color}
                  onChange={(hex) => {
                    const next = [...rules];
                    next[index] = { ...rule, color: hex };
                    updateRules(next);
                  }}
                />
                <div className="flex items-center gap-1 sm:justify-end sm:pt-6">
                <button
                  type="button"
                  onClick={() => moveRule(index, -1)}
                  disabled={index === 0}
                  className="p-2 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                  title="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveRule(index, 1)}
                  disabled={index === rules.length - 1}
                  className="p-2 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                  title="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => updateRules(rules.filter((r) => r.id !== rule.id))}
                  className="p-2 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                  title="Remove rule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => updateRules([...rules, createProductNameColorRule()])}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add keyword rule
        </Button>

        <div className="rounded-lg border border-gray-200 p-4 bg-white space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Palette className="h-4 w-4" />
            Preview
          </div>
          <Input
            label="Sample product name"
            value={previewName}
            onChange={(e) => setPreviewName(e.target.value)}
          />
          <p className="text-sm text-gray-600">
            Result:{' '}
            <ProductName name={previewName || '—'} className="font-semibold" />
            {previewSegments.length === 1 && !previewSegments[0].color ? (
              <span className="text-gray-400 ml-2">(default text color)</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Clear custom rules
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!hasChanges}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button type="button" onClick={handleApply}>
              Save &amp; close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
