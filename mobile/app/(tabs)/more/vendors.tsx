import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { purchasingApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';

export default function VendorsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => purchasingApi.suppliers.list({ search }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const vendors = data || [];

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search vendors..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />
      <FlatList
        data={vendors}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleSmall">{item.name}</Text>
              <Text variant="bodySmall" style={styles.muted}>{item.phone || item.email || 'No contact'}</Text>
              {item.address && <Text variant="bodySmall" style={styles.muted}>{item.address}</Text>}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No vendors found'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  muted: { color: Colors.textMuted, marginTop: 1 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
