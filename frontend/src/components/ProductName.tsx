import type { CSSProperties, ElementType, HTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import {
  buildProductNameSegments,
  loadCustomKeywordColorRules,
  subscribeProductNameColorRules,
  type ProductNameSegment,
} from '../lib/productNameColorRules';

type ProductNameProps = {
  name: string | null | undefined;
  as?: ElementType;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'>;

function renderSegments(segments: ProductNameSegment[]) {
  return segments.map((seg, index) =>
    seg.color ? (
      <span key={index} style={{ color: seg.color }}>
        {seg.text}
      </span>
    ) : (
      <span key={index}>{seg.text}</span>
    ),
  );
}

/** Renders a product name with super rules (whole line) + custom keyword highlighting. */
export default function ProductName({
  name,
  as: Tag = 'span',
  className,
  style,
  title,
  ...rest
}: ProductNameProps) {
  const display = name ?? '';
  const [segments, setSegments] = useState(() =>
    buildProductNameSegments(display, loadCustomKeywordColorRules()),
  );

  useEffect(() => {
    const update = () => setSegments(buildProductNameSegments(display, loadCustomKeywordColorRules()));
    update();
    return subscribeProductNameColorRules(update);
  }, [display]);

  const superOnly = segments.length === 1 && segments[0].color && segments[0].text === display;
  const mergedStyle = superOnly ? { ...style, color: segments[0].color } : style;

  return (
    <Tag
      className={className}
      title={title ?? (display || undefined)}
      style={mergedStyle}
      {...rest}
    >
      {superOnly || segments.length === 1 && !segments[0].color ? display : renderSegments(segments)}
    </Tag>
  );
}
