import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, Chip, SegmentedButtons } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../src/utils/formatting';

export default function RepairsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['repairs', search, status, page],
    queryFn: () => posApi.repair.invoices.list({ search, status: status !== 'all' ? status : undefined, page }),
    select: (res) => res.data,
  });

  const repairs = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  const statusColor = (s: string) => {
    switch (s) {
      case 'booked': return '#fef9c3';
      case 'in_progress': return '#dbeafe';
      case 'completed': return '#dcfce7';
      case 'delivered': return '#e0e7ff';
      default: return '#f3f4f6';
    }
  };

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search repairs..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar}
      />

      <SegmentedButtons
        value={status}
        onValueChange={(v) => { setStatus(v); setPage(1); }}
        buttons={[
          { value: 'all', label: 'All' },
          { value: 'booked', label: 'Booked' },
          { value: 'in_progress', label: 'In Progress' },
          { value: 'completed', label: 'Done' },
        ]}
        style={styles.segments}
      />

      <FlatList
        data={repairs}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => item.invoice && router.push(`/(tabs)/invoices/${item.invoice}`)}>
            <Card.Content>
              <View style={styles.row}>
                <Text variant="titleSmall">{item.device_model || `Repair #${item.id}`}</Text>
                <Chip compact style={{ backgroundColor: statusColor(item.status) }}>
                  {item.status?.replace('_', ' ')}
                </Chip>
              </View>
              <Text variant="bodySmall" style={styles.muted}>
                Customer: {item.customer_name || 'Walk-in'} · {formatDateOnlyDisplay(item.created_at)}
              </Text>
              {item.contact_number && <Text variant="bodySmall" style={styles.muted}>Phone: {item.contact_number}</Text>}
              {item.description && <Text variant="bodySmall" numberOfLines={2}>{item.description}</Text>}
              <View style={styles.row}>
                <Text variant="bodySmall" style={styles.muted}>Invoice: {item.invoice_number || '—'}</Text>
                <Text variant="bodyMedium" style={{ color: Colors.primary }}>
                  ₹{formatAmountINR(item.booking_amount || 0)}
                </Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No repairs found'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  segments: { marginHorizontal: 8, marginBottom: 4 },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginVertical: 1 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
