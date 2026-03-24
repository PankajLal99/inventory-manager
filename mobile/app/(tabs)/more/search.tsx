import { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, SectionList } from 'react-native';
import { Text, Searchbar, Card, Chip, List } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR } from '../../../src/utils/formatting';
import { getProductNameColor } from '../../../src/utils/formatting';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedQuery(text), 300);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () => searchApi.search(debouncedQuery),
    select: (res) => res.data,
    enabled: debouncedQuery.length >= 2,
  });

  const sections = [];
  if (data?.products?.length) sections.push({ title: 'Products', data: data.products.slice(0, 10), type: 'product' });
  if (data?.invoices?.length) sections.push({ title: 'Invoices', data: data.invoices.slice(0, 10), type: 'invoice' });
  if (data?.customers?.length) sections.push({ title: 'Customers', data: data.customers.slice(0, 10), type: 'customer' });
  if (data?.barcodes?.length) sections.push({ title: 'Barcodes', data: data.barcodes.slice(0, 10), type: 'barcode' });

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search products, invoices, customers, barcodes..."
        value={query}
        onChangeText={handleSearch}
        style={styles.searchbar}
        autoFocus
      />

      {debouncedQuery.length < 2 && !isLoading && (
        <Text style={styles.hint}>Type at least 2 characters to search</Text>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.id || index}`}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text variant="titleSmall" style={styles.sectionHeader}>{section.title} ({section.data.length})</Text>
        )}
        renderItem={({ item, section }) => {
          if (section.type === 'product') {
            const color = getProductNameColor(item.name);
            return (
              <Card style={styles.card} onPress={() => router.push(`/(tabs)/inventory/${item.id}`)}>
                <Card.Content style={styles.row}>
                  <Text variant="bodyMedium" style={color ? { color } : undefined}>{item.name}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{item.category_name || ''}</Text>
                </Card.Content>
              </Card>
            );
          }
          if (section.type === 'invoice') {
            return (
              <Card style={styles.card} onPress={() => router.push(`/(tabs)/invoices/${item.id}`)}>
                <Card.Content style={styles.row}>
                  <View>
                    <Text variant="bodyMedium">{item.invoice_number}</Text>
                    <Text variant="bodySmall" style={styles.muted}>{item.customer_name || 'Walk-in'}</Text>
                  </View>
                  <Text variant="bodyMedium">₹{formatAmountINR(item.total || 0)}</Text>
                </Card.Content>
              </Card>
            );
          }
          if (section.type === 'customer') {
            return (
              <Card style={styles.card} onPress={() => router.push(`/(tabs)/more/ledger/${item.id}`)}>
                <Card.Content style={styles.row}>
                  <Text variant="bodyMedium">{item.name}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{item.phone || ''}</Text>
                </Card.Content>
              </Card>
            );
          }
          // barcode
          return (
            <Card style={styles.card} onPress={() => item.product && router.push(`/(tabs)/inventory/${item.product}`)}>
              <Card.Content style={styles.row}>
                <Text variant="bodyMedium" style={{ fontFamily: 'monospace' }}>{item.barcode || item.short_code}</Text>
                <Text variant="bodySmall" style={styles.muted}>{item.product_name || ''}</Text>
              </Card.Content>
            </Card>
          );
        }}
        ListEmptyComponent={
          isLoading ? <Text style={styles.hint}>Searching...</Text> :
          debouncedQuery.length >= 2 ? <Text style={styles.hint}>No results found</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { paddingHorizontal: 8, paddingBottom: 40 },
  sectionHeader: { paddingVertical: 4, marginTop: 8, color: Colors.textMuted },
  card: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted },
  hint: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
