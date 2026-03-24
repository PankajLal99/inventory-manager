import { useState } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Card, Chip, FAB, Portal, Modal, TextInput, RadioButton, Button } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay, canEditLedgerEntry, getDateRangeByPreset } from '../../../../src/utils/formatting';
import { useToast } from '../../../../src/contexts/ToastContext';

export default function InternalLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const [datePreset, setDatePreset] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [entryType, setEntryType] = useState<'gave' | 'received'>('gave');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const dateRange = datePreset !== 'all' ? getDateRangeByPreset(datePreset as any) : null;

  const { data: summary } = useQuery({
    queryKey: ['internal-ledger-summary', id],
    queryFn: () => customersApi.internalLedger.customerDetail(Number(id)),
    select: (res) => res.data,
    enabled: !!id,
  });

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ['internal-ledger-entries', id, dateRange],
    queryFn: () => customersApi.internalLedger.entries.list({
      customer: Number(id),
      ...(dateRange ? { start_date: dateRange.startDate, end_date: dateRange.endDate } : {}),
    }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
    enabled: !!id,
  });

  const addEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.internalLedger.entries.create({ ...data, customer: Number(id) }),
    onSuccess: () => {
      success('Entry added');
      setShowModal(false);
      setAmount('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-summary', id] });
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-entries', id] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed'),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (entryId: number) => customersApi.internalLedger.entries.delete(entryId),
    onSuccess: () => {
      success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-summary', id] });
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-entries', id] });
    },
  });

  return (
    <View style={styles.container}>
      {summary && (
        <Card style={styles.summaryCard}>
          <Card.Content>
            <Text variant="titleSmall">{summary.customer_name || summary.name}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Given</Text>
                <Text variant="titleSmall" style={{ color: Colors.error }}>₹{formatAmountINR(summary.total_given || 0)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Received</Text>
                <Text variant="titleSmall" style={{ color: '#16a34a' }}>₹{formatAmountINR(summary.total_received || 0)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text variant="bodySmall" style={styles.muted}>Balance</Text>
                <Text variant="titleSmall">₹{formatAmountINR(Math.abs(summary.balance || 0))}</Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      )}

      <View style={styles.chipRow}>
        {['all', 'today', '7d', '30d'].map((p) => (
          <Chip key={p} compact selected={datePreset === p} onPress={() => setDatePreset(p)}
            style={datePreset === p ? styles.activeChip : styles.chip}>
            {p === 'all' ? 'All' : p === 'today' ? 'Today' : p}
          </Chip>
        ))}
      </View>

      <FlatList
        data={entries || []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.entryCard}>
            <Card.Content>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">{item.description || item.entry_type}</Text>
                  <Text variant="bodySmall" style={styles.muted}>{formatDateOnlyDisplay(item.date || item.created_at)}</Text>
                </View>
                <Text variant="bodyMedium" style={{ color: item.entry_type === 'gave' ? Colors.error : '#16a34a' }}>
                  {item.entry_type === 'gave' ? '+' : '-'}₹{formatAmountINR(item.amount)}
                </Text>
              </View>
              {canEditLedgerEntry(item) && (
                <Button compact mode="text" textColor={Colors.error}
                  onPress={() => Alert.alert('Delete', 'Delete this entry?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteEntryMutation.mutate(item.id) },
                  ])}>Delete</Button>
              )}
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No entries'}</Text>}
      />

      <FAB icon="plus" style={styles.fab} onPress={() => setShowModal(true)} />

      <Portal>
        <Modal visible={showModal} onDismiss={() => setShowModal(false)} contentContainerStyle={styles.modal}>
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>Add Entry</Text>
          <RadioButton.Group value={entryType} onValueChange={(v) => setEntryType(v as any)}>
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><RadioButton value="gave" /><Text>Gave</Text></View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><RadioButton value="received" /><Text>Received</Text></View>
            </View>
          </RadioButton.Group>
          <TextInput label="Amount" mode="outlined" keyboardType="numeric" value={amount} onChangeText={setAmount} style={styles.input} />
          <TextInput label="Notes" mode="outlined" value={notes} onChangeText={setNotes} style={styles.input} />
          <Button mode="contained" onPress={() => {
            const amt = parseFloat(amount);
            if (!amt || amt <= 0) { showError('Enter valid amount'); return; }
            addEntryMutation.mutate({ entry_type: entryType, amount: amt, notes });
          }} loading={addEntryMutation.isPending}>Save</Button>
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
  chipRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, marginBottom: 4 },
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
