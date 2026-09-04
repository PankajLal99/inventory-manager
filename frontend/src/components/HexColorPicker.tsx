const DEFAULT_PRESETS = [
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0f766e',
  '#111827',
  '#be1129',
  '#418f28',
  '#ea580c',
  '#c026d3',
];

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(value: string, fallback = '#2563eb'): string {
  const trimmed = value.trim();
  if (HEX_COLOR_RE.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  return fallback;
}

type HexColorPickerProps = {
  value: string;
  onChange: (hex: string) => void;
  presets?: string[];
  label?: string;
  showHexInput?: boolean;
};

/** Preset swatches + native color picker + optional hex text field. */
export default function HexColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  label,
  showHexInput = true,
}: HexColorPickerProps) {
  const displayColor = normalizeHex(value);

  return (
    <div className="space-y-2">
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-medium text-gray-700">{label}</label>
          <span className="text-[11px] font-mono text-gray-400">{displayColor}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((hex) => {
          const active = displayColor.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              title={hex}
              onClick={() => onChange(hex)}
              className={`h-8 w-8 rounded-md ring-offset-1 transition shrink-0 ${
                active ? 'ring-2 ring-blue-600 scale-105' : 'ring-1 ring-black/10 hover:scale-105 hover:ring-gray-400'
              }`}
              style={{ backgroundColor: hex }}
              aria-label={`Color ${hex}`}
            />
          );
        })}

        <label
          className="relative h-8 w-8 rounded-md ring-1 ring-black/10 overflow-hidden cursor-pointer shrink-0 hover:ring-gray-400"
          title="Pick custom color"
        >
          <span
            className="absolute inset-0"
            style={{
              background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
            }}
          />
          <input
            type="color"
            value={displayColor}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
            aria-label={label ? `${label} custom color` : 'Pick custom color'}
          />
        </label>

        <div
          className="h-8 min-w-[5rem] px-2 rounded-md border border-gray-200 flex items-center gap-2 bg-white shrink-0"
          title="Current color"
        >
          <span
            className="h-5 w-5 rounded border border-black/10 shrink-0"
            style={{ backgroundColor: displayColor }}
          />
          <span className="text-xs font-mono text-gray-600 hidden sm:inline">{displayColor}</span>
        </div>
      </div>

      {showHexInput ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(normalizeHex(e.target.value, displayColor))}
          placeholder="#2563eb"
          className="block w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          spellCheck={false}
        />
      ) : null}
    </div>
  );
}

export { DEFAULT_PRESETS, normalizeHex };
