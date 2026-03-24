import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Chip, Searchbar } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatDateOnlyDisplay } from '../../../../src/utils/formatting';

export default function ReplacementRequestsScreen() {
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['replacement-requests', search],
    queryFn: () => posApi.replacement.searchInvoices(search || ''),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  return (
    <View style={styles.container}>
      <Searchbar placeholder="Search..." value={search} onChangeText={setSearch} style={styles.searchbar} />
      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.row}>
                <Text variant="titleSmall">{item.replacement_number || `REP-${item.id}`}</Text>
                <Chip compact style={{ backgroundColor: '#fef9c3' }}>{item.status}</Chip>
              </View>
              <Text variant="bodySmall" style={styles.muted}>{item.product_name || 'Unknown product'}</Text>
              <Text variant="bodySmall" style={styles.muted}>
                {item.customer_name || 'Walk-in'} · {formatDateOnlyDisplay(item.created_at)}
              </Text>
              {item.reason && <Text variant="bodySmall">Reason: {item.reason}</Text>}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No pending requests'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginVertical: 1 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
