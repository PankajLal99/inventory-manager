import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Chip } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay, getDateRangeByPreset } from '../../../src/utils/formatting';

export default function PaymentsScreen() {
  const [datePreset, setDatePreset] = useState('today');
  const range = getDateRangeByPreset(datePreset as any);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payments', range.startDate, range.endDate],
    queryFn: () => posApi.invoices.list({ start_date: range.startDate, end_date: range.endDate, payments_only: true }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const payments = data || [];
  const total = payments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0);

  return (
    <View style={styles.container}>
      <Card style={styles.summaryCard}>
        <Card.Content style={styles.row}>
          <Text variant="bodyMedium" style={styles.muted}>Total Collected</Text>
          <Text variant="titleMedium" style={{ color: '#16a34a', fontWeight: 'bold' }}>₹{formatAmountINR(total)}</Text>
        </Card.Content>
      </Card>

      <View style={styles.chipRow}>
        {['today', '7d', '30d'].map((p) => (
          <Chip key={p} compact selected={datePreset === p} onPress={() => setDatePreset(p)}
            style={datePreset === p ? styles.activeChip : styles.chip}>
            {p === 'today' ? 'Today' : p}
          </Chip>
        ))}
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{item.invoice_number || `Invoice #${item.invoice}`}</Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {item.customer_name || 'Walk-in'} · {formatDateOnlyDisplay(item.payment_date || item.created_at)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="bodyMedium" style={{ color: '#16a34a' }}>₹{formatAmountINR(item.amount)}</Text>
                <Chip compact style={styles.typeChip}>{item.payment_type}</Chip>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No payments'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryCard: { margin: 8, backgroundColor: Colors.surface },
  chipRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, marginBottom: 4 },
  chip: { backgroundColor: Colors.surface },
  activeChip: { backgroundColor: Colors.primary + '20' },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted },
  typeChip: { height: 22, marginTop: 2 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
