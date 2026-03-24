import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR } from '../../../src/utils/formatting';

export default function PaymentRemindersScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payment-reminders', search],
    queryFn: () => customersApi.paymentReminders.list({ search }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const reminders = data || [];

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search reminders..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />
      <FlatList
        data={reminders}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/(tabs)/more/ledger/${item.customer}`)}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.customer_name}</Text>
                <Text variant="bodySmall" style={styles.muted}>{item.phone || 'No phone'}</Text>
                {item.notes && <Text variant="bodySmall" numberOfLines={1}>{item.notes}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="titleSmall" style={{ color: Colors.error }}>
                  ₹{formatAmountINR(item.amount_due || item.balance || 0)}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>{item.days_overdue || 0}d overdue</Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No reminders'}</Text>}
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
