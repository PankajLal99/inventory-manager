import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, Chip, FAB } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { purchasingApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../../src/utils/formatting';

export default function PurchasesListScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['purchases', search, page],
    queryFn: () => purchasingApi.purchases.list({ search, page, limit: 30 }),
    select: (res) => res.data,
  });

  const purchases = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search purchases..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar}
      />

      <FlatList
        data={purchases}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/(tabs)/inventory/purchases/${item.id}`)}>
            <Card.Content>
              <View style={styles.row}>
                <Text variant="titleSmall">{item.purchase_number || `PO-${item.id}`}</Text>
                <Chip compact style={item.status === 'received' ? styles.received : styles.pending}>
                  {item.status}
                </Chip>
              </View>
              <Text variant="bodySmall" style={styles.muted}>
                {item.supplier_name || 'No supplier'} · {formatDateOnlyDisplay(item.purchase_date || item.created_at)}
              </Text>
              <View style={styles.row}>
                <Text variant="bodySmall" style={styles.muted}>{item.items?.length || item.item_count || 0} items</Text>
                <Text variant="titleSmall" style={{ color: Colors.primary }}>₹{formatAmountINR(item.total_amount || item.total || 0)}</Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No purchases found'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 80 },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginVertical: 2 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  received: { backgroundColor: '#dcfce7' },
  pending: { backgroundColor: '#fef9c3' },
});
