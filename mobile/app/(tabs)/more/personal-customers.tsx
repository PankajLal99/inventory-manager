import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR } from '../../../src/utils/formatting';

export default function PersonalCustomersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['personal-customers', search],
    queryFn: () => customersApi.personalCustomers.list({ search }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const customers = data || [];

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search personal customers..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />
      <FlatList
        data={customers}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/(tabs)/more/personal-ledger/${item.id}`)}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={styles.muted}>{item.phone || item.email || 'No contact'}</Text>
              </View>
              {item.balance != null && item.balance !== 0 && (
                <Text variant="bodyMedium" style={{
                  color: item.balance > 0 ? Colors.error : '#16a34a',
                  fontWeight: 'bold',
                }}>
                  ₹{formatAmountINR(Math.abs(item.balance))}
                </Text>
              )}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No personal customers'}</Text>}
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
  muted: { color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
