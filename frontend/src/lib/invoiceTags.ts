export interface InvoiceTag {
  id: number;
  name: string;
  color: string;
  is_active?: boolean;
  created_at?: string;
}

export const INVOICE_TAG_COLOR_PRESETS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#64748B',
] as const;

export function getTagTextColor(hexColor: string): string {
  const hex = (hexColor || '#64748B').replace('#', '');
  if (hex.length !== 6) return '#1F2937';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1F2937' : '#FFFFFF';
}

export function normalizeHexColor(value: string, fallback = '#3B82F6'): string {
  const trimmed = (value || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  return fallback;
}
