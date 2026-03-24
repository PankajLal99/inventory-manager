import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, FAB, Chip } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR } from '../../../../src/utils/formatting';

export default function CustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => customersApi.list({ search, page, limit: 30 }),
    select: (res) => res.data,
  });

  const customers = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search customers..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar}
      />

      <FlatList
        data={customers}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/(tabs)/more/ledger/${item.id}`)}>
            <Card.Content>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{item.name}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{item.phone || item.email || 'No contact'}</Text>
                  {item.group_name && <Chip compact style={styles.groupChip}>{item.group_name}</Chip>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {item.total_balance != null && item.total_balance !== 0 && (
                    <Text variant="bodyMedium" style={{
                      color: item.total_balance > 0 ? Colors.error : '#16a34a',
                      fontWeight: 'bold',
                    }}>
                      ₹{formatAmountINR(Math.abs(item.total_balance))}
                      {item.total_balance > 0 ? ' due' : ' adv'}
                    </Text>
                  )}
                  <Text variant="bodySmall" style={styles.muted}>{item.invoice_count || 0} invoices</Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No customers found'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 80 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 1 },
  groupChip: { marginTop: 2, alignSelf: 'flex-start', height: 24 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
