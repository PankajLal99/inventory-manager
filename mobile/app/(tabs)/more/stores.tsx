import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';

export default function StoresScreen() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stores'],
    queryFn: () => catalogApi.stores.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => catalogApi.warehouses.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const allLocations = [
    ...(data || []).map((s: any) => ({ ...s, locationType: 'Store' })),
    ...(warehouses || []).map((w: any) => ({ ...w, locationType: 'Warehouse' })),
  ];

  return (
    <View style={styles.container}>
      <FlatList
        data={allLocations}
        keyExtractor={(item) => `${item.locationType}-${item.id}`}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.row}>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={[styles.muted, { fontWeight: '600' }]}>{item.locationType}</Text>
              </View>
              {item.address && <Text variant="bodySmall" style={styles.muted}>{item.address}</Text>}
              {item.phone && <Text variant="bodySmall" style={styles.muted}>Phone: {item.phone}</Text>}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No locations'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 1 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
