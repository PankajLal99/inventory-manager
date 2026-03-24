import { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Card, Searchbar, Chip, FAB, Portal, Modal, TextInput, Button, RadioButton } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateOnlyDisplay, getDateRangeByPreset } from '../../../src/utils/formatting';
import { useToast } from '../../../src/contexts/ToastContext';

export default function ExpensesScreen() {
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState('30d');
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [paymentType, setPaymentType] = useState('cash');

  const range = getDateRangeByPreset(datePreset as any);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['expenses', search, range.startDate, range.endDate],
    queryFn: () => posApi.expenses.list({ search, start_date: range.startDate, end_date: range.endDate }),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => posApi.expenses.create(data),
    onSuccess: () => {
      success('Expense added');
      setShowModal(false);
      setAmount('');
      setCategory('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed'),
  });

  const totalExpenses = (data || []).reduce((s: number, e: any) => s + (parseFloat(e.amount) || 0), 0);

  return (
    <View style={styles.container}>
      <Card style={styles.summaryCard}>
        <Card.Content style={styles.row}>
          <Text variant="bodyMedium" style={styles.muted}>Total Expenses</Text>
          <Text variant="titleMedium" style={{ color: Colors.error, fontWeight: 'bold' }}>₹{formatAmountINR(totalExpenses)}</Text>
        </Card.Content>
      </Card>

      <View style={styles.chipRow}>
        {['today', '7d', '30d', '90d'].map((p) => (
          <Chip key={p} compact selected={datePreset === p} onPress={() => setDatePreset(p)}
            style={datePreset === p ? styles.activeChip : styles.chip}>
            {p === 'today' ? 'Today' : p}
          </Chip>
        ))}
      </View>

      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={() => refetch()}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{item.category || item.description || 'Expense'}</Text>
                <Text variant="bodySmall" style={styles.muted}>{formatDateOnlyDisplay(item.date || item.created_at)}</Text>
                {item.description && item.category && <Text variant="bodySmall" numberOfLines={1}>{item.description}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="bodyMedium" style={{ color: Colors.error }}>₹{formatAmountINR(item.amount)}</Text>
                <Text variant="bodySmall" style={styles.muted}>{item.payment_type || 'cash'}</Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No expenses'}</Text>}
      />

      <FAB icon="plus" style={styles.fab} onPress={() => setShowModal(true)} />

      <Portal>
        <Modal visible={showModal} onDismiss={() => setShowModal(false)} contentContainerStyle={styles.modal}>
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>Add Expense</Text>
          <TextInput label="Amount *" mode="outlined" keyboardType="numeric" value={amount} onChangeText={setAmount} style={styles.input} />
          <TextInput label="Category" mode="outlined" value={category} onChangeText={setCategory} style={styles.input} />
          <TextInput label="Description" mode="outlined" value={description} onChangeText={setDescription} multiline style={styles.input} />
          <Text variant="bodySmall" style={{ marginBottom: 4 }}>Payment Type</Text>
          <RadioButton.Group value={paymentType} onValueChange={setPaymentType}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {['cash', 'upi', 'card'].map((t) => (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <RadioButton value={t} /><Text>{t}</Text>
                </View>
              ))}
            </View>
          </RadioButton.Group>
          <Button mode="contained" onPress={() => {
            const amt = parseFloat(amount);
            if (!amt || amt <= 0) { showError('Enter valid amount'); return; }
            addMutation.mutate({ amount: amt, category, description, payment_type: paymentType });
          }} loading={addMutation.isPending}>Save</Button>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryCard: { margin: 8, backgroundColor: Colors.surface },
  chipRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, marginBottom: 4 },
  chip: { backgroundColor: Colors.surface },
  activeChip: { backgroundColor: Colors.primary + '20' },
  list: { padding: 8, paddingBottom: 80 },
  card: { marginBottom: 4, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: Colors.primary },
  modal: { backgroundColor: Colors.surface, margin: 20, padding: 20, borderRadius: 12 },
  input: { marginBottom: 8, backgroundColor: Colors.surface },
});
