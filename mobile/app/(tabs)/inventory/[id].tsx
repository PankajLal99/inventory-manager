import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Chip, Button, Divider, List } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay, getStockInfo } from '../../../src/utils/formatting';

const TAG_LABELS: Record<string, string> = {
  new: 'New (Fresh)', returned: 'Returned', 'in-cart': 'In Cart',
  defective: 'Defective', unknown: 'Unknown', sold: 'Sold',
};
const TAG_COLORS: Record<string, string> = {
  new: '#16a34a', returned: '#2563eb', sold: '#6b7280',
  defective: '#dc2626', 'in-cart': '#d97706', unknown: '#9ca3af',
};

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({ new: true, returned: true });

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', Number(id)],
    queryFn: () => productsApi.get(Number(id)),
    select: (res) => res.data,
    enabled: !!id,
  });

  const { data: barcodesFull } = useQuery({
    queryKey: ['product-barcodes-full', Number(id)],
    queryFn: () => productsApi.barcodesFull(Number(id)),
    select: (res) => res.data,
    enabled: !!id && !!product,
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['product-invoices', Number(id)],
    queryFn: () => productsApi.invoices(Number(id)),
    select: (res) => res.data,
    enabled: !!id && !!product,
  });

  if (isLoading || !product) {
    return <View style={styles.container}><Text style={styles.empty}>Loading...</Text></View>;
  }

  const p = product;
  const stock = getStockInfo(p);
  const byTag = barcodesFull?.by_tag || {};
  const invoices = invoicesData?.invoices || [];
  const tagOrder = ['new', 'returned', 'in-cart', 'defective', 'unknown', 'sold'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 8, paddingBottom: 40 }}>
      {/* Header */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.row}>
            <Text variant="titleLarge" style={{ flex: 1 }}>{p.name}</Text>
            <Chip compact style={p.is_active ? styles.active : styles.inactive}>
              {p.is_active ? 'Active' : 'Inactive'}
            </Chip>
          </View>
          <Text variant="bodySmall" style={styles.muted}>SKU: {p.sku || '—'}</Text>
          <Text variant="bodySmall" style={styles.muted}>
            {p.category_name || 'No category'} {p.brand_name ? `· ${p.brand_name}` : ''}
          </Text>
          {p.description ? <Text variant="bodySmall" style={{ marginTop: 4 }}>{p.description}</Text> : null}
        </Card.Content>
      </Card>

      {/* Stock Info */}
      {p.track_inventory && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>Inventory</Text>
            <View style={styles.stockGrid}>
              <View style={styles.stockItem}>
                <Text variant="titleMedium" style={{ color: '#16a34a' }}>{stock.total}</Text>
                <Text variant="bodySmall" style={styles.muted}>Total Stock</Text>
              </View>
              <View style={styles.stockItem}>
                <Text variant="titleMedium" style={{ color: Colors.primary }}>{stock.available}</Text>
                <Text variant="bodySmall" style={styles.muted}>Available</Text>
              </View>
              <View style={styles.stockItem}>
                <Text variant="titleMedium">{p.shop_stock ?? 0}</Text>
                <Text variant="bodySmall" style={styles.muted}>Shop</Text>
              </View>
              <View style={styles.stockItem}>
                <Text variant="titleMedium">{p.warehouse_stock ?? 0}</Text>
                <Text variant="bodySmall" style={styles.muted}>Warehouse</Text>
              </View>
            </View>
            {p.low_stock_threshold > 0 && (
              <Text variant="bodySmall" style={{ color: stock.isLowStock ? Colors.error : Colors.textMuted, marginTop: 4 }}>
                Low stock threshold: {p.low_stock_threshold}
              </Text>
            )}
          </Card.Content>
        </Card>
      )}

      {/* Supplier Breakdown */}
      {p.supplier_breakdown?.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>Inventory by Supplier</Text>
            {p.supplier_breakdown.map((s: any, i: number) => (
              <View key={i} style={[styles.row, { paddingVertical: 4 }]}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">{s.supplier}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{s.purchase_date ?? '—'} · ₹{s.price}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="bodySmall">Shop: {s.shop_barcode_count ?? s.shop_stock}</Text>
                  <Text variant="bodySmall" style={styles.muted}>Whse: {s.warehouse_stock}</Text>
                </View>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Barcodes by Tag */}
      {barcodesFull?.total > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>Barcodes ({barcodesFull.total})</Text>
            {tagOrder.map((tag) => {
              const items = byTag[tag] || [];
              if (items.length === 0) return null;
              const expanded = expandedTags[tag] !== false;
              return (
                <View key={tag} style={{ marginBottom: 4 }}>
                  <List.Accordion
                    title={`${TAG_LABELS[tag] || tag} (${items.length})`}
                    titleStyle={{ fontSize: 13 }}
                    expanded={expanded}
                    onPress={() => setExpandedTags(prev => ({ ...prev, [tag]: !prev[tag] }))}
                    style={{ backgroundColor: Colors.background, padding: 0 }}
                    left={() => <View style={[styles.tagDot, { backgroundColor: TAG_COLORS[tag] || '#999' }]} />}
                  >
                    {items.slice(0, 20).map((b: any) => (
                      <View key={b.id} style={styles.barcodeRow}>
                        <Text variant="bodySmall" style={{ fontFamily: 'monospace' }}>{b.short_code || b.barcode}</Text>
                        <Text variant="bodySmall" style={styles.muted}>{b.location}</Text>
                        <Text variant="bodySmall">{b.sold_price != null ? `₹${b.sold_price}` : b.purchase_price != null ? `₹${b.purchase_price}` : '—'}</Text>
                      </View>
                    ))}
                    {items.length > 20 && <Text variant="bodySmall" style={styles.muted}>+{items.length - 20} more</Text>}
                  </List.Accordion>
                </View>
              );
            })}
          </Card.Content>
        </Card>
      )}

      {/* Related Invoices */}
      {invoices.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>Related Invoices ({invoices.length})</Text>
            {invoices.slice(0, 10).map((inv: any) => (
              <Card key={inv.id} style={{ marginBottom: 4, backgroundColor: Colors.background }}
                onPress={() => router.push(`/(tabs)/invoices/${inv.id}`)}>
                <Card.Content style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: Colors.primary }}>{inv.invoice_number}</Text>
                    <Text variant="bodySmall" style={styles.muted}>
                      {formatDateOnlyDisplay(inv.created_at)} · {inv.customer_name}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="bodySmall">Qty: {inv.product_quantity}</Text>
                    <Text variant="bodyMedium">₹{formatAmountINR(inv.total)}</Text>
                  </View>
                </Card.Content>
              </Card>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, padding: 8 }}>
        <Button mode="contained" icon="pencil" onPress={() => router.push({ pathname: '/(tabs)/inventory/form', params: { productId: id } })} style={{ flex: 1 }}>
          Edit
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  active: { backgroundColor: '#dcfce7' },
  inactive: { backgroundColor: '#f3f4f6' },
  stockGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stockItem: { alignItems: 'center', minWidth: 70 },
  tagDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4, alignSelf: 'center' },
  barcodeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 16 },
});
