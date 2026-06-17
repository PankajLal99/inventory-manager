import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Tag, X } from 'lucide-react';
import { posApi } from '../../lib/api';
import {
  INVOICE_TAG_COLOR_PRESETS,
  getTagTextColor,
  normalizeHexColor,
  type InvoiceTag,
} from '../../lib/invoiceTags';
import Input from '../ui/Input';
import Button from '../ui/Button';

interface InvoiceTagChipProps {
  tag: InvoiceTag;
  size?: 'xs' | 'sm';
}

export function InvoiceTagChip({ tag, size = 'xs' }: InvoiceTagChipProps) {
  const textColor = getTagTextColor(tag.color);
  const sizeClass = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5';

  return (
    <span
      className={`inline-flex items-center rounded border font-semibold tracking-wide shrink-0 ${sizeClass}`}
      style={{
        backgroundColor: tag.color,
        borderColor: tag.color,
        color: textColor,
      }}
      title={tag.name}
    >
      {tag.name}
    </span>
  );
}

interface InvoiceTagEditorProps {
  invoiceId: number;
  tags: InvoiceTag[];
  onUpdated?: (tags: InvoiceTag[]) => void;
  compact?: boolean;
}

function resolveTagsFromResponse(
  data: any,
  selectedIds: number[],
  allTags: InvoiceTag[],
): InvoiceTag[] {
  if (Array.isArray(data?.tags)) {
    return data.tags as InvoiceTag[];
  }
  if (selectedIds.length === 0) return [];
  const byId = new Map(allTags.map((tag) => [tag.id, tag]));
  return selectedIds.map((id) => byId.get(id)).filter((tag): tag is InvoiceTag => Boolean(tag));
}

export default function InvoiceTagEditor({ invoiceId, tags, onUpdated, compact = false }: InvoiceTagEditorProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>(tags.map((t) => t.id));
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<string>(INVOICE_TAG_COLOR_PRESETS[0]);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    setSelectedIds(tags.map((t) => t.id));
  }, [tags]);

  const updatePopoverPosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 288; // w-72
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPopoverStyle({
      top: rect.bottom + 4,
      left,
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const handleReposition = () => updatePopoverPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const { data: allTags = [], isLoading: isLoadingTags } = useQuery({
    queryKey: ['invoice-tags'],
    queryFn: async () => {
      const response = await posApi.invoiceTags.list();
      const payload = response.data;
      return Array.isArray(payload) ? payload as InvoiceTag[] : [];
    },
    enabled: open,
    staleTime: 30_000,
  });

  const assignTagsMutation = useMutation({
    mutationFn: async ({ tagIds, closeOnSuccess }: { tagIds: number[]; closeOnSuccess?: boolean }) => {
      const response = await posApi.invoices.update(invoiceId, { tag_ids: tagIds });
      return { data: response.data, tagIds, closeOnSuccess: closeOnSuccess ?? false };
    },
    onSuccess: ({ data, tagIds, closeOnSuccess }) => {
      const catalogTags =
        queryClient.getQueryData<InvoiceTag[]>(['invoice-tags'])
        ?? allTags;
      const updatedTags = resolveTagsFromResponse(data, tagIds, catalogTags);
      onUpdated?.(updatedTags);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || '').startsWith('repair-invoices-section'),
      });
      queryClient.invalidateQueries({ queryKey: ['find-repair-invoice'] });
      if (closeOnSuccess) setOpen(false);
      setError(null);
    },
    onError: (err: any) => {
      const message = err?.response?.data?.error
        || err?.response?.data?.tag_ids?.[0]
        || err?.response?.data?.name?.[0]
        || 'Failed to update tags';
      setError(String(message));
    },
  });

  const createTagMutation = useMutation({
    mutationFn: async () => {
      const name = newTagName.trim();
      if (!name) throw new Error('Tag name is required');
      const response = await posApi.invoiceTags.create({
        name,
        color: normalizeHexColor(newTagColor),
      });
      return response.data as InvoiceTag;
    },
    onSuccess: (createdTag) => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags'] });
      const nextIds = Array.from(new Set([...selectedIds, createdTag.id]));
      setSelectedIds(nextIds);
      setNewTagName('');
      setNewTagColor(INVOICE_TAG_COLOR_PRESETS[0]);
      assignTagsMutation.mutate({ tagIds: nextIds, closeOnSuccess: false });
    },
    onError: (err: any) => {
      const message = err?.response?.data?.name?.[0]
        || err?.response?.data?.color?.[0]
        || err?.message
        || 'Failed to create tag';
      setError(String(message));
    },
  });

  const toggleTag = (tagId: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId];
      assignTagsMutation.mutate({ tagIds: next, closeOnSuccess: false });
      return next;
    });
  };

  const handleSave = () => {
    assignTagsMutation.mutate({ tagIds: selectedIds, closeOnSuccess: true });
  };

  const isSaving = assignTagsMutation.isPending || createTagMutation.isPending;
  const selectedCount = selectedIds.length;

  const popover = open ? (
    <div
      ref={popoverRef}
      className="fixed z-[9999] w-72 rounded-lg border border-gray-200 bg-white shadow-lg"
      style={{ top: popoverStyle.top, left: popoverStyle.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div>
          <span className="text-sm font-semibold text-gray-900">Invoice tags</span>
          <p className="text-[11px] text-gray-500 mt-0.5">Select multiple tags for this invoice</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              {selectedCount} selected
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close tag editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-1">
        {isLoadingTags ? (
          <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tags...
          </div>
        ) : allTags.length === 0 ? (
          <p className="text-xs text-gray-500 py-2">No tags yet. Create one below.</p>
        ) : (
          allTags.map((tag) => {
            const checked = selectedIds.includes(tag.id);
            return (
              <label
                key={tag.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-gray-50 ${
                  checked ? 'bg-blue-50/60' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTag(tag.id)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <InvoiceTagChip tag={tag} size="sm" />
              </label>
            );
          })
        )}
      </div>

      <div className="border-t border-gray-100 px-3 py-3 space-y-2">
        <p className="text-xs font-medium text-gray-700">Create new tag</p>
        <Input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="Tag name"
          className="h-9 text-sm"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {INVOICE_TAG_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setNewTagColor(color)}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                newTagColor === color ? 'border-gray-900 scale-110' : 'border-white shadow-sm'
              }`}
              style={{ backgroundColor: color }}
              title={color}
              aria-label={`Select color ${color}`}
            />
          ))}
          <input
            type="color"
            value={normalizeHexColor(newTagColor)}
            onChange={(e) => setNewTagColor(normalizeHexColor(e.target.value))}
            className="h-7 w-9 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            title="Custom color"
            aria-label="Custom tag color"
          />
          <span
            className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border"
            style={{
              backgroundColor: normalizeHexColor(newTagColor),
              borderColor: normalizeHexColor(newTagColor),
              color: getTagTextColor(normalizeHexColor(newTagColor)),
            }}
          >
            {newTagName.trim() || 'Preview'}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          disabled={!newTagName.trim() || isSaving}
          onClick={() => createTagMutation.mutate()}
        >
          {createTagMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create & assign
        </Button>
      </div>

      {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}

      <div className="flex gap-2 border-t border-gray-100 px-3 py-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={isSaving}
          onClick={handleSave}
        >
          {assignTagsMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            'Save tags'
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors ${
          compact ? 'h-5 w-5' : 'h-6 w-6'
        }`}
        title={tags.length > 0 ? `${tags.length} tag(s) assigned` : 'Manage tags'}
        aria-label="Manage invoice tags"
        aria-expanded={open}
      >
        <Tag className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
      {compact && tags.length > 0 && (
        <span className="ml-0.5 text-[10px] font-semibold text-gray-500 tabular-nums">{tags.length}</span>
      )}

      {popover && createPortal(popover, document.body)}
    </div>
  );
}

interface InvoiceCustomerWithTagsProps {
  invoiceId: number;
  customerName?: string | null;
  tags?: InvoiceTag[];
  fallbackName?: string;
  showUserIcon?: boolean;
  compact?: boolean;
  extraBelow?: React.ReactNode;
  badge?: React.ReactNode;
}

export function InvoiceCustomerWithTags({
  invoiceId,
  customerName,
  tags = [],
  fallbackName = 'Walk-in Customer',
  showUserIcon = true,
  compact = false,
  extraBelow,
  badge,
}: InvoiceCustomerWithTagsProps) {
  const tagIdsKey = tags.map((tag) => tag.id).join(',');
  const [localTags, setLocalTags] = useState<InvoiceTag[]>(tags);

  useEffect(() => {
    setLocalTags(tags);
  }, [tagIdsKey, tags]);

  return (
    <div className="min-w-0">
      <div className={`flex items-start gap-1.5 ${compact ? '' : 'gap-2'}`}>
        {showUserIcon && (
          <UserIconPlaceholder className={`text-gray-400 shrink-0 mt-0.5 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
            <span className={`font-medium text-gray-900 whitespace-normal break-words ${compact ? '' : ''}`}>
              {customerName || fallbackName}
            </span>
            {badge}
            {localTags.map((tag) => (
              <InvoiceTagChip key={tag.id} tag={tag} size={compact ? 'xs' : 'sm'} />
            ))}
            <InvoiceTagEditor
              invoiceId={invoiceId}
              tags={localTags}
              onUpdated={setLocalTags}
              compact={compact}
            />
          </div>
          {extraBelow}
        </div>
      </div>
    </div>
  );
}

function UserIconPlaceholder({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
