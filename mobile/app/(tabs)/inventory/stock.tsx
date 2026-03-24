import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Chip, Searchbar, SegmentedButtons } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { getStockInfo, getProductNameColor } from '../../../src/utils/formatting';

export default function StockOverviewScreen() {
  const [tab, setTab] = useState('low');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const buildParams = () => {
    const params: any = { page, limit: 50, tag: 'new', exclude_other_custom: 'true' };
    if (search) { params.search = search; params.search_mode = 'name_only'; }
    if (tab === 'low') params.low_stock = 'true';
    if (tab === 'out') params.out_of_stock = 'true';
    if (tab === 'in') params.in_stock = 'true';
    return params;
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stock', tab, search, page],
    queryFn: () => productsApi.list(buildParams()),
    select: (res) => res.data,
  });

  const products = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  return (
    <View style={styles.container}>
      <SegmentedButtons
        value={tab}
        onValueChange={(v) => { setTab(v); setPage(1); }}
        buttons={[
          { value: 'low', label: 'Low Stock' },
          { value: 'out', label: 'Out of Stock' },
          { value: 'in', label: 'In Stock' },
        ]}
        style={styles.segments}
      />
      <Searchbar
        placeholder="Search..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar}
      />

      <FlatList
        data={products}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => {
          const stock = getStockInfo(item);
          const color = getProductNameColor(item.name);
          return (
            <Card style={styles.card}>
              <Card.Content>
                <View style={styles.row}>
                  <Text variant="bodyMedium" style={color ? { color, flex: 1 } : { flex: 1 }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Chip compact style={stock.isOutOfStock ? styles.out : stock.isLowStock ? styles.low : styles.ok}>
                    {stock.available}
                  </Chip>
                </View>
                <Text variant="bodySmall" style={styles.muted}>
                  Total: {stock.total} · Shop: {item.shop_stock ?? 0} · Whse: {item.warehouse_stock ?? 0}
                  {item.low_stock_threshold > 0 ? ` · Threshold: ${item.low_stock_threshold}` : ''}
                </Text>
              </Card.Content>
            </Card>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No products'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  segments: { margin: 8 },
  searchbar: { marginHorizontal: 8, marginBottom: 4, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  ok: { backgroundColor: '#dcfce7' },
  low: { backgroundColor: '#fef9c3' },
  out: { backgroundColor: '#fecaca' },
});
