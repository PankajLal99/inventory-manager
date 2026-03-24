import { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Searchbar, Card, Chip, FAB, Menu, Badge, Button, SegmentedButtons } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, getProductNameColor, getStockInfo } from '../../../src/utils/formatting';

export default function ProductListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState('new');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showBrandMenu, setShowBrandMenu] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => catalogApi.categories.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: () => catalogApi.brands.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const buildParams = () => {
    const params: any = { page, limit: 30, tag: tagFilter || 'new', exclude_other_custom: 'true' };
    if (search) { params.search = search; params.search_mode = 'name_only'; }
    if (categoryFilter) params.category = categoryFilter;
    if (brandFilter) params.brand = brandFilter;
    return params;
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['products', search, tagFilter, categoryFilter, brandFilter, page],
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

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setPage(1), 300);
  }, []);

  const tagOptions = [
    { value: 'new', label: 'Fresh' },
    { value: 'sold', label: 'Sold' },
    { value: 'defective', label: 'Defective' },
    { value: 'returned', label: 'Returned' },
  ];

  const categories = categoriesData || [];
  const brands = brandsData || [];

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search products..."
        value={search}
        onChangeText={handleSearch}
        style={styles.searchbar}
      />

      <SegmentedButtons
        value={tagFilter}
        onValueChange={(v) => { setTagFilter(v); setPage(1); }}
        buttons={tagOptions}
        style={styles.segments}
      />

      <View style={styles.filterRow}>
        <Menu
          visible={showCategoryMenu}
          onDismiss={() => setShowCategoryMenu(false)}
          anchor={
            <Chip icon="tag" onPress={() => setShowCategoryMenu(true)} selected={!!categoryFilter}>
              {categoryFilter ? categories.find((c: any) => c.id.toString() === categoryFilter)?.name || 'Category' : 'Category'}
            </Chip>
          }
        >
          <Menu.Item title="All Categories" onPress={() => { setCategoryFilter(''); setShowCategoryMenu(false); setPage(1); }} />
          {categories.map((cat: any) => (
            <Menu.Item key={cat.id} title={cat.name} onPress={() => { setCategoryFilter(cat.id.toString()); setShowCategoryMenu(false); setPage(1); }} />
          ))}
        </Menu>
        <Menu
          visible={showBrandMenu}
          onDismiss={() => setShowBrandMenu(false)}
          anchor={
            <Chip icon="label" onPress={() => setShowBrandMenu(true)} selected={!!brandFilter}>
              {brandFilter ? brands.find((b: any) => b.id.toString() === brandFilter)?.name || 'Brand' : 'Brand'}
            </Chip>
          }
        >
          <Menu.Item title="All Brands" onPress={() => { setBrandFilter(''); setShowBrandMenu(false); setPage(1); }} />
          {brands.map((b: any) => (
            <Menu.Item key={b.id} title={b.name} onPress={() => { setBrandFilter(b.id.toString()); setShowBrandMenu(false); setPage(1); }} />
          ))}
        </Menu>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        onEndReached={() => {
          if (data?.total_pages && page < data.total_pages) setPage(p => p + 1);
        }}
        onEndReachedThreshold={0.3}
        renderItem={({ item }) => {
          const stock = getStockInfo(item);
          const nameColor = getProductNameColor(item.name);
          return (
            <Card style={styles.card} onPress={() => router.push(`/(tabs)/inventory/${item.id}`)}>
              <Card.Content>
                <View style={styles.row}>
                  <Text variant="titleSmall" style={nameColor ? { color: nameColor } : undefined} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Badge style={stock.isOutOfStock ? styles.outOfStock : stock.isLowStock ? styles.lowStock : styles.inStock}>
                    {tagFilter === 'new' ? stock.available : stock.total}
                  </Badge>
                </View>
                <View style={styles.row}>
                  <Text variant="bodySmall" style={styles.muted}>
                    {item.category_name || 'No category'} {item.brand_name ? `· ${item.brand_name}` : ''}
                  </Text>
                  <Text variant="bodySmall" style={styles.muted}>
                    {item.barcodes?.length || 0} barcodes
                  </Text>
                </View>
              </Card.Content>
            </Card>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>{isLoading ? 'Loading...' : 'No products found'}</Text>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => router.push('/(tabs)/inventory/form')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  segments: { marginHorizontal: 8, marginBottom: 4 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, marginBottom: 4 },
  list: { padding: 8, paddingBottom: 80 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: Colors.primary },
  inStock: { backgroundColor: '#dcfce7', color: '#166534' },
  lowStock: { backgroundColor: '#fef9c3', color: '#854d0e' },
  outOfStock: { backgroundColor: '#fecaca', color: '#991b1b' },
});
