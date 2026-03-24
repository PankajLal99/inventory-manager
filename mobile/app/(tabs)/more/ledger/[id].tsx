import { useState } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Card, Chip, Button, FAB, Portal, Modal, TextInput, RadioButton } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi, posApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay, canEditLedgerEntry, getDateRangeByPreset } from '../../../../src/utils/formatting';
import { useToast } from '../../../../src/contexts/ToastContext';

export default function CustomerLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const [datePreset, setDatePreset] = useState('all');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');

  const dateRange = datePreset !== 'all' ? getDateRangeByPreset(datePreset as any) : null;

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['ledger-summary', id],
    queryFn: () => customersApi.ledger.summary({ customer: Number(id) }),
    select: (res) => res.data,
    enabled: !!id,
  });

  const { data: entries, isLoading: entriesLoading, refetch } = useQuery({
    queryKey: ['ledger-entries', id, dateRange],
    queryFn: () => customersApi.ledger.customerDetail(Number(id), {
      ...(dateRange ? { start_date: dateRange.startDate, end_date: dateRange.endDate } : {}),
    }),
    select: (res) => {
      const d = res.data;
      if (d?.entries) return d.entries;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
    enabled: !!id,
  });

  const paymentMutation = useMutation({
    mutationFn: (data: any) => posApi.invoices.payments(Number(id), data),
    onSuccess: () => {
      success('Payment recorded');
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentNotes('');
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', id] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries', id] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to record payment'),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (entryId: number) => customersApi.ledger.entries.delete(entryId),
    onSuccess: () => {
      success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', id] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries', id] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to delete'),
  });

  const handleRecordPayment = () => {
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) { showError('Enter valid amount'); return; }
    paymentMutation.mutate({ amount: amt, payment_type: paymentType, notes: paymentNotes });
  };

  const ledgerEntries = entries || [];

  return (
    <View style={styles.container}>
      {/* Summary */}
      {summary && (
        <Card style={styles.summaryCard}>
          <Card.Content>
            <Text variant="titleSmall">{summary.customer_name}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Total Sales</Text>
                <Text variant="titleSmall">₹{formatAmountINR(summary.total_sales || 0)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Paid</Text>
                <Text variant="titleSmall" style={{ color: '#16a34a' }}>₹{formatAmountINR(summary.total_paid || 0)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Balance</Text>
                <Text variant="titleSmall" style={{ color: (summary.balance || 0) > 0 ? Colors.error : '#16a34a' }}>
                  ₹{formatAmountINR(Math.abs(summary.balance || 0))}
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Date filters */}
      <View style={styles.chipRow}>
        {['all', 'today', '7d', '30d', '90d'].map((p) => (
          <Chip key={p} compact selected={datePreset === p} onPress={() => setDatePreset(p)}
            style={datePreset === p ? styles.activeChip : styles.chip}>
            {p === 'all' ? 'All' : p === 'today' ? 'Today' : p}
          </Chip>
        ))}
      </View>

      {/* Entries */}
      <FlatList
        data={ledgerEntries}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={entriesLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.entryCard}>
            <Card.Content>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">{item.description || item.entry_type}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{formatDateOnlyDisplay(item.date || item.created_at)}</Text>
                  {item.invoice_number && (
                    <Text variant="bodySmall" style={{ color: Colors.primary }}
                      onPress={() => item.invoice && router.push(`/(tabs)/invoices/${item.invoice}`)}>
                      {item.invoice_number}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {item.debit > 0 && <Text variant="bodyMedium" style={{ color: Colors.error }}>+₹{formatAmountINR(item.debit)}</Text>}
                  {item.credit > 0 && <Text variant="bodyMedium" style={{ color: '#16a34a' }}>-₹{formatAmountINR(item.credit)}</Text>}
                  <Text variant="bodySmall" style={styles.muted}>Bal: ₹{formatAmountINR(item.running_balance || 0)}</Text>
                </View>
              </View>
              {canEditLedgerEntry(item) && (
                <Button compact mode="text" textColor={Colors.error}
                  onPress={() => Alert.alert('Delete', 'Delete this entry?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteEntryMutation.mutate(item.id) },
                  ])}>
                  Delete
                </Button>
              )}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{entriesLoading ? 'Loading...' : 'No entries'}</Text>}
      />

      <FAB icon="plus" label="Record Payment" style={styles.fab} onPress={() => setShowPaymentModal(true)} />

      <Portal>
        <Modal visible={showPaymentModal} onDismiss={() => setShowPaymentModal(false)} contentContainerStyle={styles.modal}>
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>Record Payment</Text>
          <TextInput label="Amount" mode="outlined" keyboardType="numeric" value={paymentAmount}
            onChangeText={setPaymentAmount} style={styles.input} />
          <Text variant="bodySmall" style={{ marginBottom: 4 }}>Payment Type</Text>
          <RadioButton.Group value={paymentType} onValueChange={setPaymentType}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['cash', 'upi', 'card', 'bank_transfer'].map((t) => (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <RadioButton value={t} />
                  <Text variant="bodySmall">{t.replace('_', ' ')}</Text>
                </View>
              ))}
            </View>
          </RadioButton.Group>
          <TextInput label="Notes (optional)" mode="outlined" value={paymentNotes}
            onChangeText={setPaymentNotes} style={styles.input} />
          <Button mode="contained" onPress={handleRecordPayment} loading={paymentMutation.isPending}
            style={{ marginTop: 8 }}>Save Payment</Button>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryCard: { margin: 8, backgroundColor: Colors.surface },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  summaryItem: { alignItems: 'center' },
  chipRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, flexWrap: 'wrap', marginBottom: 4 },
  chip: { backgroundColor: Colors.surface },
  activeChip: { backgroundColor: Colors.primary + '20' },
  list: { padding: 8, paddingBottom: 80 },
  entryCard: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  muted: { color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: Colors.primary },
  modal: { backgroundColor: Colors.surface, margin: 20, padding: 20, borderRadius: 12 },
  input: { marginBottom: 8, backgroundColor: Colors.surface },
});
