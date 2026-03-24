import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, FlatList } from 'react-native';
import { Text, Card, Chip, Button, Divider, TextInput, Portal, Modal, RadioButton, IconButton } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateDDMMYYYY, getProductNameColor } from '../../../src/utils/formatting';
import { sharePdf, invoicePdfHtml } from '../../../src/utils/pdf';

const statusColors: Record<string, string> = {
  paid: '#059669', partial: '#d97706', credit: '#dc2626', void: '#6b7280', draft: '#0284c7',
};

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const res = await posApi.invoices.get(Number(id));
      return res.data;
    },
    enabled: !!id,
  });

  const paymentMutation = useMutation({
    mutationFn: (data: any) => posApi.invoices.payments(Number(id), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setShowPaymentModal(false);
      success('Payment recorded');
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Payment failed'),
  });

  const voidMutation = useMutation({
    mutationFn: () => posApi.invoices.void(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      success('Invoice voided');
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to void'),
  });

  const markCreditMutation = useMutation({
    mutationFn: () => posApi.invoices.markCredit(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      success('Marked as credit');
    },
  });

  if (isLoading || !invoice) {
    return (
      <View style={styles.center}>
        <Text>Loading...</Text>
      </View>
    );
  }

  const items = invoice.items || [];
  const total = invoice.totals?.total ?? invoice.total ?? 0;

  const handleRecordPayment = () => {
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) { showError('Enter a valid amount'); return; }
    const data: any = { amount, payment_type: paymentType };
    if (paymentType === 'mixed') {
      data.cash_amount = parseFloat(cashAmount) || 0;
      data.upi_amount = parseFloat(upiAmount) || 0;
      if (Math.abs(data.cash_amount + data.upi_amount - amount) > 1) {
        showError('Cash + UPI must equal payment amount');
        return;
      }
    }
    paymentMutation.mutate(data);
  };

  const handleSharePdf = async () => {
    try {
      await sharePdf(invoicePdfHtml(invoice), `Invoice-${invoice.invoice_number}`);
    } catch (err: any) {
      showError('Failed to share PDF');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.headerRow}>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>
              {invoice.invoice_number}
            </Text>
            <Chip
              compact
              textStyle={{ fontSize: 11, color: '#fff' }}
              style={{ backgroundColor: statusColors[invoice.status] || Colors.textMuted }}
            >
              {invoice.status?.toUpperCase()}
            </Chip>
          </View>
          <Divider style={{ marginVertical: 8 }} />
          <Text variant="bodyMedium">Customer: {invoice.customer?.name || 'Walk-in'}</Text>
          <Text variant="bodyMedium">Store: {invoice.store?.name || ''}</Text>
          <Text variant="bodyMedium">Type: {invoice.invoice_type?.toUpperCase()}</Text>
          <Text variant="bodySmall" style={styles.muted}>
            {formatDateDDMMYYYY(invoice.created_at)}
            {invoice.created_by ? ` · by ${invoice.created_by}` : ''}
            {invoice.is_edited ? ' · Edited' : ''}
          </Text>

          {/* Repair info */}
          {invoice.repair && (
            <View style={styles.repairSection}>
              <Divider style={{ marginVertical: 8 }} />
              <Text variant="titleSmall">Repair Info</Text>
              <Text variant="bodySmall">Model: {invoice.repair.model_name}</Text>
              <Text variant="bodySmall">Status: {invoice.repair.status_display || invoice.repair.status}</Text>
              {invoice.repair.contact_no ? <Text variant="bodySmall">Contact: {invoice.repair.contact_no}</Text> : null}
              {invoice.repair.booking_amount ? <Text variant="bodySmall">Booking: ₹{formatAmountINR(invoice.repair.booking_amount)}</Text> : null}
            </View>
          )}
        </Card.Content>
      </Card>

      {/* Items */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Items ({items.length})</Text>
          <Divider style={{ marginVertical: 8 }} />
          {items.map((item: any, idx: number) => {
            const nameColor = getProductNameColor(item.product_name);
            return (
              <View key={item.id || idx} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={nameColor ? { color: nameColor } : undefined}>
                    {item.product_name}
                  </Text>
                  <Text variant="bodySmall" style={styles.muted}>
                    {item.quantity} × ₹{formatAmountINR(item.unit_price || item.manual_unit_price || 0)}
                  </Text>
                </View>
                <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                  ₹{formatAmountINR(item.total || (item.quantity * (item.unit_price || 0)))}
                </Text>
              </View>
            );
          })}
        </Card.Content>
      </Card>

      {/* Totals */}
      <Card style={styles.card}>
        <Card.Content>
          {invoice.totals?.discount ? (
            <View style={styles.totalRow}>
              <Text>Discount</Text>
              <Text>-₹{formatAmountINR(invoice.totals.discount)}</Text>
            </View>
          ) : null}
          {invoice.totals?.tax ? (
            <View style={styles.totalRow}>
              <Text>Tax</Text>
              <Text>₹{formatAmountINR(invoice.totals.tax)}</Text>
            </View>
          ) : null}
          <Divider style={{ marginVertical: 4 }} />
          <View style={styles.totalRow}>
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Total</Text>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: Colors.primary }}>
              ₹{formatAmountINR(total)}
            </Text>
          </View>
        </Card.Content>
      </Card>

      {/* Payments */}
      {invoice.payments && invoice.payments.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">Payments</Text>
            <Divider style={{ marginVertical: 8 }} />
            {invoice.payments.map((p: any, i: number) => (
              <View key={p.id || i} style={styles.totalRow}>
                <Text variant="bodyMedium">
                  {p.payment_type?.toUpperCase()} · {formatDateDDMMYYYY(p.created_at)}
                </Text>
                <Text variant="bodyMedium" style={{ color: Colors.success }}>
                  ₹{formatAmountINR(p.amount)}
                </Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Button mode="contained" icon="cash-plus" onPress={() => setShowPaymentModal(true)} style={styles.actionButton}>
          Record Payment
        </Button>
        <Button mode="outlined" icon="share-variant" onPress={handleSharePdf} style={styles.actionButton}>
          Share PDF
        </Button>
        <Button mode="outlined" icon="pencil" onPress={() => router.push({ pathname: '/(tabs)/invoices/edit', params: { invoiceId: id } })} style={styles.actionButton}>
          Edit Invoice
        </Button>
        {invoice.invoice_type === 'pending' && invoice.status !== 'credit' && (
          <Button mode="outlined" icon="credit-card" onPress={() => {
            Alert.alert('Mark as Credit', 'Move this to customer ledger as credit?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Confirm', onPress: () => markCreditMutation.mutate() },
            ]);
          }} style={styles.actionButton}>
            Mark Credit
          </Button>
        )}
        {invoice.status !== 'void' && (
          <Button mode="outlined" textColor={Colors.error} icon="cancel" onPress={() => {
            Alert.alert('Void Invoice', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Void', style: 'destructive', onPress: () => voidMutation.mutate() },
            ]);
          }} style={styles.actionButton}>
            Void
          </Button>
        )}
      </View>

      {/* Payment Modal */}
      <Portal>
        <Modal visible={showPaymentModal} onDismiss={() => setShowPaymentModal(false)} contentContainerStyle={styles.modal}>
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>Record Payment</Text>
          <TextInput mode="outlined" label="Amount" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="numeric" style={styles.modalInput} />
          <RadioButton.Group onValueChange={setPaymentType} value={paymentType}>
            <RadioButton.Item label="Cash" value="cash" />
            <RadioButton.Item label="UPI" value="upi" />
            <RadioButton.Item label="Mixed" value="mixed" />
          </RadioButton.Group>
          {paymentType === 'mixed' && (
            <>
              <TextInput mode="outlined" label="Cash Amount" value={cashAmount} onChangeText={setCashAmount} keyboardType="numeric" style={styles.modalInput} />
              <TextInput mode="outlined" label="UPI Amount" value={upiAmount} onChangeText={setUpiAmount} keyboardType="numeric" style={styles.modalInput} />
            </>
          )}
          <Button mode="contained" onPress={handleRecordPayment} loading={paymentMutation.isPending} style={{ marginTop: 12 }}>
            Save Payment
          </Button>
        </Modal>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { marginBottom: 10, backgroundColor: Colors.surface },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 2 },
  repairSection: { marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  actions: { gap: 8, marginTop: 8 },
  actionButton: { borderRadius: 8 },
  modal: { backgroundColor: Colors.surface, padding: 20, margin: 20, borderRadius: 12 },
  modalInput: { marginBottom: 8, backgroundColor: Colors.surface },
});
