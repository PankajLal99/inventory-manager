import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Chip, Searchbar } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { historyApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatDateOnlyDisplay } from '../../../src/utils/formatting';

export default function HistoryScreen() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', search, page],
    queryFn: () => historyApi.list({ search, page, limit: 50 }),
    select: (res) => res.data,
  });

  const logs = (() => {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  })();

  const actionColor = (action: string) => {
    if (action.includes('create') || action.includes('add')) return '#dcfce7';
    if (action.includes('delete') || action.includes('void')) return '#fecaca';
    if (action.includes('update') || action.includes('edit')) return '#dbeafe';
    return '#f3f4f6';
  };

  return (
    <View style={styles.container}>
      <Searchbar placeholder="Search history..." value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar} />
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.row}>
                <Chip compact style={{ backgroundColor: actionColor(item.action || '') }}>
                  {item.action}
                </Chip>
                <Text variant="bodySmall" style={styles.muted}>{formatDateOnlyDisplay(item.timestamp || item.created_at)}</Text>
              </View>
              <Text variant="bodyMedium" style={{ marginTop: 4 }}>{item.description || item.details || `${item.model_name} #${item.object_id}`}</Text>
              <Text variant="bodySmall" style={styles.muted}>By: {item.user_name || item.user || 'System'}</Text>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No history'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginVertical: 1 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
