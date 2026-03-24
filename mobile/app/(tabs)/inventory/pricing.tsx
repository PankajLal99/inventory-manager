import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, FAB } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { pricingApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../src/utils/formatting';

export default function PricingScreen() {
  const [tab, setTab] = useState<'lists' | 'promotions'>('lists');

  const { data: priceLists, isLoading: listsLoading } = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => pricingApi.priceLists.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
    enabled: tab === 'lists',
  });

  const { data: promotions, isLoading: promosLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: () => pricingApi.promotions.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
    enabled: tab === 'promotions',
  });

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <Card style={[styles.tab, tab === 'lists' && styles.activeTab]} onPress={() => setTab('lists')}>
          <Text style={[styles.tabText, tab === 'lists' && styles.activeTabText]}>Price Lists</Text>
        </Card>
        <Card style={[styles.tab, tab === 'promotions' && styles.activeTab]} onPress={() => setTab('promotions')}>
          <Text style={[styles.tabText, tab === 'promotions' && styles.activeTabText]}>Promotions</Text>
        </Card>
      </View>

      {tab === 'lists' ? (
        <FlatList
          data={priceLists || []}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          refreshing={listsLoading}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={styles.muted}>{item.description || 'No description'}</Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {item.is_active ? 'Active' : 'Inactive'} · {item.items_count || 0} items
                </Text>
              </Card.Content>
            </Card>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{listsLoading ? 'Loading...' : 'No price lists'}</Text>}
        />
      ) : (
        <FlatList
          data={promotions || []}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          refreshing={promosLoading}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {item.discount_type === 'percentage' ? `${item.discount_value}% off` : `₹${formatAmountINR(item.discount_value)} off`}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {formatDateOnlyDisplay(item.start_date)} - {formatDateOnlyDisplay(item.end_date)}
                  {' · '}{item.is_active ? 'Active' : 'Inactive'}
                </Text>
              </Card.Content>
            </Card>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{promosLoading ? 'Loading...' : 'No promotions'}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabRow: { flexDirection: 'row', padding: 8, gap: 8 },
  tab: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: Colors.surface },
  activeTab: { backgroundColor: Colors.primary },
  tabText: { fontWeight: '600', color: Colors.text },
  activeTabText: { color: '#fff' },
  list: { padding: 8, paddingBottom: 40 },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  muted: { color: Colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
