import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Searchbar, Card, Chip, FAB } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../../src/utils/formatting';

export default function CreditNotesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['credit-notes', search, page],
    queryFn: () => posApi.creditNotes.list({ search, page }),
    select: (res) => res.data,
  });

  const items = data?.results || [];

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search credit notes..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
        style={styles.searchbar}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => setPage(1)}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/(tabs)/invoices/credit-notes/${item.id}`)}>
            <Card.Content>
              <View style={styles.row}>
                <Text variant="titleSmall">{item.credit_note_number || `CN-${item.id}`}</Text>
                <Chip compact style={item.status === 'applied' ? styles.applied : styles.pending}>
                  {item.status}
                </Chip>
              </View>
              <Text variant="bodySmall" style={styles.muted}>{item.customer_name}</Text>
              <View style={styles.row}>
                <Text variant="bodySmall">{formatDateOnlyDisplay(item.created_at)}</Text>
                <Text variant="titleSmall" style={{ color: Colors.primary }}>₹{formatAmountINR(item.total_amount)}</Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No credit notes found'}</Text>}
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
  applied: { backgroundColor: '#dcfce7' },
  pending: { backgroundColor: '#fef9c3' },
});
