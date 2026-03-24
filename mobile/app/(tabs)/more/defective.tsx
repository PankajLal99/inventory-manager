import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, Chip } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatDateOnlyDisplay } from '../../../src/utils/formatting';

export default function DefectiveScreen() {
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['defective-moveouts', search],
    queryFn: () => catalogApi.defectiveProducts.moveOuts.list({ search }),
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
                <Text variant="titleSmall">{item.move_out_number || `MO-${item.id}`}</Text>
                <Chip compact>{item.status}</Chip>
              </View>
              <Text variant="bodySmall" style={styles.muted}>{formatDateOnlyDisplay(item.created_at)}</Text>
              <Text variant="bodySmall" style={styles.muted}>
                {item.product_count || 0} product(s) · {item.reason}
              </Text>
              {item.notes && <Text variant="bodySmall" numberOfLines={2}>{item.notes}</Text>}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No defective move-outs'}</Text>}
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
