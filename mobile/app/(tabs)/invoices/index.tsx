import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Chip, Searchbar, SegmentedButtons, FAB } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { posApi, catalogApi } from '../../../src/api/client';
import { useAuth } from '../../../src/contexts/AuthContext';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateDDMMYYYY, getTodayDateString, getDateRangeByPreset } from '../../../src/utils/formatting';
import type { Invoice, DateRangePreset } from '../../../src/types';

const typeColors: Record<string, string> = {
  cash: '#059669', upi: '#7c3aed', pending: '#d97706', mixed: '#0284c7', credit: '#dc2626', defective: '#6b7280',
};

export default function InvoiceListScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('one_day');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const dateRange = datePreset !== 'custom' ? getDateRangeByPreset(datePreset) : { startDate: '', endDate: '' };

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, datePreset, typeFilter, page],
    queryFn: async () => {
      const params: any = { page, page_size: 30, ordering: '-created_at' };
      if (search) params.search = search;
      if (dateRange.startDate) params.date_from = dateRange.startDate;
      if (dateRange.endDate) params.date_to = dateRange.endDate;
      if (typeFilter) params.invoice_type = typeFilter;
      const res = await posApi.invoices.list(params);
      return res.data;
    },
  });

  const invoices: Invoice[] = data?.results || data || [];
  const totalCount = data?.count || invoices.length;

  const renderInvoice = ({ item }: { item: Invoice }) => (
    <Card
      style={styles.card}
      onPress={() => router.push({ pathname: '/(tabs)/invoices/[id]', params: { id: item.id.toString() } })}
    >
      <Card.Content>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall">{item.invoice_number}</Text>
            <Text variant="bodySmall" style={styles.muted}>
              {item.customer?.name || 'Walk-in'} · {item.store?.name || ''}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              {formatDateDDMMYYYY(item.created_at)}
              {item.created_by ? ` · ${item.created_by}` : ''}
            </Text>
          </View>
          <View style={styles.rightCol}>
            <Chip
              compact
              textStyle={{ fontSize: 10, color: '#fff' }}
              style={{ backgroundColor: typeColors[item.invoice_type] || Colors.primary }}
            >
              {item.invoice_type.toUpperCase()}
            </Chip>
            <Text variant="titleSmall" style={styles.amount}>
              ₹{formatAmountINR(item.totals?.total ?? item.total ?? 0)}
            </Text>
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search invoices..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />
      <View style={styles.filterRow}>
        {(['one_day', 'last_7_days', 'last_30_days'] as DateRangePreset[]).map((preset) => (
          <Chip
            key={preset}
            selected={datePreset === preset}
            onPress={() => { setDatePreset(preset); setPage(1); }}
            compact
            style={styles.filterChip}
          >
            {preset === 'one_day' ? 'Today' : preset === 'last_7_days' ? '7 Days' : '30 Days'}
          </Chip>
        ))}
      </View>
      <View style={styles.filterRow}>
        <Chip compact selected={!typeFilter} onPress={() => { setTypeFilter(''); setPage(1); }} style={styles.filterChip}>All</Chip>
        {['cash', 'upi', 'pending', 'mixed', 'credit'].map((t) => (
          <Chip
            key={t}
            compact
            selected={typeFilter === t}
            onPress={() => { setTypeFilter(typeFilter === t ? '' : t); setPage(1); }}
            style={styles.filterChip}
          >
            {t.toUpperCase()}
          </Chip>
        ))}
      </View>

      <FlatList
        data={invoices}
        renderItem={renderInvoice}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodyLarge" style={styles.muted}>
              {isLoading ? 'Loading...' : 'No invoices found'}
            </Text>
          </View>
        }
        onEndReached={() => {
          if (invoices.length < totalCount) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchbar: { margin: 8, elevation: 1 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, gap: 4, marginBottom: 4 },
  filterChip: {},
  list: { padding: 8, paddingBottom: 20 },
  card: { marginBottom: 6, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', alignItems: 'center' },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  amount: { fontWeight: '600', color: Colors.primary },
  empty: { paddingTop: 60, alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 2 },
});
