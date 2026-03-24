import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Card, Button, Chip, Divider } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay } from '../../../../src/utils/formatting';
import { useToast } from '../../../../src/contexts/ToastContext';

export default function CreditNoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const { data: cn, isLoading } = useQuery({
    queryKey: ['credit-note', id],
    queryFn: () => posApi.creditNotes.get(Number(id)),
    select: (res) => res.data,
  });

  const applyMutation = useMutation({
    mutationFn: () => posApi.invoices.markCredit(Number(id)),
    onSuccess: () => {
      success('Credit note applied');
      queryClient.invalidateQueries({ queryKey: ['credit-note', id] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to apply'),
  });

  if (isLoading || !cn) {
    return <View style={styles.container}><Text style={styles.empty}>Loading...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        ListHeaderComponent={
          <>
            <Card style={styles.card}>
              <Card.Content>
                <View style={styles.row}>
                  <Text variant="titleMedium">{cn.credit_note_number || `CN-${cn.id}`}</Text>
                  <Chip compact>{cn.status}</Chip>
                </View>
                <Text variant="bodySmall" style={styles.muted}>Customer: {cn.customer_name}</Text>
                <Text variant="bodySmall" style={styles.muted}>Invoice: {cn.invoice_number}</Text>
                <Text variant="bodySmall" style={styles.muted}>Date: {formatDateOnlyDisplay(cn.created_at)}</Text>
                {cn.reason && <Text variant="bodySmall">Reason: {cn.reason}</Text>}
              </Card.Content>
            </Card>

            <Text variant="titleSmall" style={styles.sectionTitle}>Items</Text>
          </>
        }
        data={cn.items || []}
        keyExtractor={(item: any) => item.id.toString()}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{item.product_name}</Text>
                <Text variant="bodySmall" style={styles.muted}>Qty: {item.quantity}</Text>
              </View>
              <Text variant="bodyMedium">₹{formatAmountINR(item.unit_price * item.quantity)}</Text>
            </Card.Content>
          </Card>
        )}
        ListFooterComponent={
          <>
            <Divider style={{ marginVertical: 8 }} />
            <Card style={styles.card}>
              <Card.Content style={styles.row}>
                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Total</Text>
                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: Colors.primary }}>
                  ₹{formatAmountINR(cn.total_amount)}
                </Text>
              </Card.Content>
            </Card>
            {cn.status !== 'applied' && (
              <Button mode="contained" onPress={() => {
                Alert.alert('Apply Credit Note', 'This will apply the credit to the customer account.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Apply', onPress: () => applyMutation.mutate() },
                ]);
              }} loading={applyMutation.isPending} style={{ margin: 8 }}>
                Apply Credit Note
              </Button>
            )}
          </>
        }
      />
    </View>
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
