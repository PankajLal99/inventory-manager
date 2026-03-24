import { useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, getTodayDateString, getShiftedLocalDateString } from '../../../src/utils/formatting';

export default function DashboardScreen() {
  const today = getTodayDateString();
  const weekAgo = getShiftedLocalDateString(-7);

  const { data: todaySales, isLoading: todayLoading, refetch: refetchToday } = useQuery({
    queryKey: ['dashboard-today', today],
    queryFn: () => reportsApi.salesSummary({ start_date: today, end_date: today }),
    select: (res) => res.data,
  });

  const { data: weekSales, isLoading: weekLoading, refetch: refetchWeek } = useQuery({
    queryKey: ['dashboard-week', weekAgo, today],
    queryFn: () => reportsApi.salesSummary({ start_date: weekAgo, end_date: today }),
    select: (res) => res.data,
  });

  const { data: topProducts } = useQuery({
    queryKey: ['top-products', today],
    queryFn: () => reportsApi.topProducts({ start_date: weekAgo, end_date: today, limit: 5 }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchToday(), refetchWeek()]);
    setRefreshing(false);
  };

  const kpi = (label: string, value: string | number, color?: string) => (
    <View style={styles.kpiItem}>
      <Text variant="titleLarge" style={{ color: color || Colors.text, fontWeight: 'bold' }}>{value}</Text>
      <Text variant="bodySmall" style={styles.muted}>{label}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 8, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

      <Text variant="titleLarge" style={{ padding: 8 }}>Dashboard</Text>

      {/* Today */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8, color: Colors.textMuted }}>Today</Text>
          <View style={styles.kpiRow}>
            {kpi('Sales', `₹${formatAmountINR(todaySales?.total_sales || 0)}`, Colors.primary)}
            {kpi('Invoices', todaySales?.invoice_count || 0)}
            {kpi('Cash', `₹${formatAmountINR(todaySales?.cash_total || 0)}`, '#16a34a')}
            {kpi('UPI', `₹${formatAmountINR(todaySales?.upi_total || 0)}`, '#7c3aed')}
          </View>
          {todaySales?.credit_total > 0 && (
            <View style={[styles.kpiRow, { marginTop: 8 }]}>
              {kpi('Credit', `₹${formatAmountINR(todaySales.credit_total)}`, Colors.error)}
              {kpi('Repairs', todaySales.repair_count || 0)}
            </View>
          )}
        </Card.Content>
      </Card>

      {/* This Week */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8, color: Colors.textMuted }}>This Week</Text>
          <View style={styles.kpiRow}>
            {kpi('Total Sales', `₹${formatAmountINR(weekSales?.total_sales || 0)}`, Colors.primary)}
            {kpi('Invoices', weekSales?.invoice_count || 0)}
            {kpi('Avg/Day', `₹${formatAmountINR((weekSales?.total_sales || 0) / 7)}`, '#0891b2')}
          </View>
        </Card.Content>
      </Card>

      {/* Top Products */}
      {topProducts && topProducts.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleSmall" style={{ marginBottom: 8, color: Colors.textMuted }}>Top Products (This Week)</Text>
            {topProducts.map((p: any, i: number) => (
              <View key={p.id || i} style={[styles.row, { paddingVertical: 4 }]}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">{i + 1}. {p.product_name || p.name}</Text>
                </View>
                <Text variant="bodySmall" style={styles.muted}>Qty: {p.total_quantity || p.quantity}</Text>
                <Text variant="bodyMedium" style={{ marginLeft: 8 }}>₹{formatAmountINR(p.total_revenue || p.revenue || 0)}</Text>
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
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  kpiRow: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap' },
  kpiItem: { alignItems: 'center', minWidth: 70, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted },
});
