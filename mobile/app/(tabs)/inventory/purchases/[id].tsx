import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Chip, Divider } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { purchasingApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../../src/utils/formatting';

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: purchase, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => purchasingApi.purchases.get(Number(id)),
    select: (res) => res.data,
    enabled: !!id,
  });

  if (isLoading || !purchase) {
    return <View style={styles.container}><Text style={styles.empty}>Loading...</Text></View>;
  }

  const items = purchase.items || [];
  const total = purchase.total_amount || purchase.total || items.reduce((s: number, i: any) => s + (i.total_cost || i.quantity * i.unit_cost || 0), 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 8, paddingBottom: 40 }}>
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.row}>
            <Text variant="titleMedium">{purchase.purchase_number || `PO-${purchase.id}`}</Text>
            <Chip compact>{purchase.status}</Chip>
          </View>
          <Text variant="bodySmall" style={styles.muted}>Supplier: {purchase.supplier_name}</Text>
          <Text variant="bodySmall" style={styles.muted}>Date: {formatDateOnlyDisplay(purchase.purchase_date || purchase.created_at)}</Text>
          {purchase.notes && <Text variant="bodySmall" style={{ marginTop: 4 }}>{purchase.notes}</Text>}
        </Card.Content>
      </Card>

      <Text variant="titleSmall" style={styles.sectionTitle}>Items ({items.length})</Text>
      {items.map((item: any, i: number) => (
        <Card key={item.id || i} style={styles.itemCard}>
          <Card.Content style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">{item.product_name || `Product #${item.product}`}</Text>
              <Text variant="bodySmall" style={styles.muted}>
                Qty: {item.quantity} × ₹{formatAmountINR(item.unit_cost || 0)}
              </Text>
              {item.barcodes_count > 0 && (
                <Text variant="bodySmall" style={styles.muted}>{item.barcodes_count} barcodes generated</Text>
              )}
            </View>
            <Text variant="bodyMedium">₹{formatAmountINR(item.total_cost || item.quantity * (item.unit_cost || 0))}</Text>
          </Card.Content>
        </Card>
      ))}

      <Divider style={{ marginVertical: 8 }} />
      <Card style={styles.card}>
        <Card.Content style={styles.row}>
          <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Total</Text>
          <Text variant="titleMedium" style={{ fontWeight: 'bold', color: Colors.primary }}>₹{formatAmountINR(total)}</Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  itemCard: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginVertical: 1 },
  sectionTitle: { marginLeft: 8, marginTop: 8, marginBottom: 4, color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
});
