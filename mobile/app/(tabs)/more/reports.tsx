import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Chip, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, getDateRangeByPreset, getTodayDateString, getShiftedLocalDateString } from '../../../src/utils/formatting';

export default function ReportsScreen() {
  const [preset, setPreset] = useState('today');
  const range = getDateRangeByPreset(preset as any);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['report-summary', range.startDate, range.endDate],
    queryFn: () => reportsApi.salesSummary({ start_date: range.startDate, end_date: range.endDate }),
    select: (res) => res.data,
  });

  const { data: byType } = useQuery({
    queryKey: ['report-by-type', range.startDate, range.endDate],
    queryFn: () => reportsApi.salesSummary({ start_date: range.startDate, end_date: range.endDate, group_by: 'type' }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const { data: byPayment } = useQuery({
    queryKey: ['report-by-payment', range.startDate, range.endDate],
    queryFn: () => reportsApi.salesSummary({ start_date: range.startDate, end_date: range.endDate, group_by: 'payment_type' }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 8, paddingBottom: 40 }}>
      <View style={styles.chipRow}>
        {['today', '7d', '30d', '90d', 'year'].map((p) => (
          <Chip key={p} compact selected={preset === p} onPress={() => setPreset(p)}
            style={preset === p ? styles.activeChip : styles.chip}>
            {p === 'today' ? 'Today' : p === 'year' ? 'Year' : p}
          </Chip>
        ))}
      </View>

      {/* Summary */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8 }}>Sales Summary</Text>
          {isLoading ? (
            <Text>Loading...</Text>
          ) : summary ? (
            <View>
              <View style={styles.row}>
                <Text variant="bodyMedium">Total Sales</Text>
                <Text variant="titleMedium" style={{ color: Colors.primary }}>₹{formatAmountINR(summary.total_sales || 0)}</Text>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium">Invoices</Text>
                <Text variant="bodyMedium">{summary.invoice_count || 0}</Text>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium">Cash</Text>
                <Text variant="bodyMedium">₹{formatAmountINR(summary.cash_total || 0)}</Text>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium">UPI</Text>
                <Text variant="bodyMedium">₹{formatAmountINR(summary.upi_total || 0)}</Text>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium">Card</Text>
                <Text variant="bodyMedium">₹{formatAmountINR(summary.card_total || 0)}</Text>
              </View>
              {(summary.credit_total || 0) > 0 && (
                <View style={styles.row}>
                  <Text variant="bodyMedium">Credit</Text>
                  <Text variant="bodyMedium" style={{ color: Colors.error }}>₹{formatAmountINR(summary.credit_total)}</Text>
                </View>
              )}
            </View>
          ) : null}
        </Card.Content>
      </Card>

      {/* By Invoice Type */}
      {byType && byType.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>By Invoice Type</Text>
            {byType.map((item: any, i: number) => (
              <View key={i} style={styles.row}>
                <Text variant="bodyMedium">{item.invoice_type || item.type}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="bodyMedium">₹{formatAmountINR(item.total || item.total_sales || 0)}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{item.count || 0} invoices</Text>
                </View>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* By Payment Type */}
      {byPayment && byPayment.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8 }}>By Payment Type</Text>
            {byPayment.map((item: any, i: number) => (
              <View key={i} style={styles.row}>
                <Text variant="bodyMedium">{item.payment_type || item.type}</Text>
                <Text variant="bodyMedium">₹{formatAmountINR(item.total || item.amount || 0)}</Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  chipRow: { flexDirection: 'row', gap: 4, padding: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: Colors.surface },
  activeChip: { backgroundColor: Colors.primary + '20' },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  muted: { color: Colors.textMuted },
});
