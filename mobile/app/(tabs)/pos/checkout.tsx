import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, Button, RadioButton, TextInput, Divider, Card } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR } from '../../../src/utils/formatting';

export default function CheckoutScreen() {
  const { cartId, invoiceType: initialType, customerId, customerName, storeId } =
    useLocalSearchParams<{
      cartId: string;
      invoiceType: string;
      customerId: string;
      customerName: string;
      storeId: string;
    }>();

  const router = useRouter();
  const { success, error: showError } = useToast();

  const [paymentType, setPaymentType] = useState(initialType || 'cash');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [notes, setNotes] = useState('');

  const { data: cart } = useQuery({
    queryKey: ['cart', Number(cartId)],
    queryFn: async () => {
      const res = await posApi.carts.get(Number(cartId));
      return res.data;
    },
    enabled: !!cartId,
  });

  const items = cart?.items || [];
  const total = items.reduce(
    (sum: number, item: any) =>
      sum + (Number(item.manual_unit_price || item.unit_price || 0)) * item.quantity,
    0,
  );

  const checkoutMutation = useMutation({
    mutationFn: () => {
      const data: any = {
        invoice_type: paymentType,
        notes,
      };
      if (customerId) data.customer = Number(customerId);

      if (paymentType === 'mixed') {
        const cash = parseFloat(cashAmount) || 0;
        const upi = parseFloat(upiAmount) || 0;
        if (Math.abs(cash + upi - total) > 1) {
          throw new Error('Cash + UPI must equal total');
        }
        data.cash_amount = cash;
        data.upi_amount = upi;
      }

      return posApi.carts.checkout(Number(cartId), data);
    },
    onSuccess: (res) => {
      success('Invoice created!');
      const invoiceId = res.data?.id || res.data?.invoice_id;
      if (invoiceId) {
        router.replace({
          pathname: '/(tabs)/invoices/[id]',
          params: { id: invoiceId.toString() },
        });
      } else {
        router.replace('/(tabs)/pos');
      }
    },
    onError: (err: any) => {
      showError(
        err.message || err.response?.data?.detail || err.response?.data?.error || 'Checkout failed',
      );
    },
  });

  const handleCheckout = () => {
    if (paymentType === 'mixed') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      if (Math.abs(cash + upi - total) > 1) {
        showError(`Cash (₹${cash}) + UPI (₹${upi}) must equal total (₹${formatAmountINR(total)})`);
        return;
      }
    }

    Alert.alert('Confirm Checkout', `Create ${paymentType.toUpperCase()} invoice for ₹${formatAmountINR(total)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => checkoutMutation.mutate() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Order Summary</Text>
          <Divider style={{ marginVertical: 8 }} />
          <Text variant="bodyMedium">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </Text>
          <Text variant="bodyMedium">
            Customer: {customerName || 'Walk-in'}
          </Text>
          <Text variant="headlineMedium" style={styles.total}>
            ₹{formatAmountINR(total)}
          </Text>
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={{ marginBottom: 8 }}>
            Payment Type
          </Text>
          <RadioButton.Group onValueChange={setPaymentType} value={paymentType}>
            {['cash', 'upi', 'pending', 'mixed', 'credit'].map((type) => (
              <RadioButton.Item
                key={type}
                label={type.toUpperCase()}
                value={type}
                style={styles.radioItem}
              />
            ))}
          </RadioButton.Group>
        </Card.Content>
      </Card>

      {paymentType === 'mixed' && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={{ marginBottom: 8 }}>
              Split Payment
            </Text>
            <TextInput
              mode="outlined"
              label="Cash Amount"
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType="numeric"
              style={styles.splitInput}
            />
            <TextInput
              mode="outlined"
              label="UPI Amount"
              value={upiAmount}
              onChangeText={setUpiAmount}
              keyboardType="numeric"
              style={styles.splitInput}
            />
            <Text variant="bodySmall" style={styles.splitInfo}>
              Total: ₹{formatAmountINR(total)} | Entered: ₹
              {formatAmountINR((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0))}
            </Text>
          </Card.Content>
        </Card>
      )}

      <TextInput
        mode="outlined"
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={2}
        style={styles.notesInput}
      />

      <Button
        mode="contained"
        onPress={handleCheckout}
        loading={checkoutMutation.isPending}
        disabled={checkoutMutation.isPending}
        style={styles.checkoutButton}
        contentStyle={styles.checkoutContent}
      >
        Complete Checkout
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  card: { marginBottom: 12, backgroundColor: Colors.surface },
  total: { fontWeight: 'bold', color: Colors.primary, marginTop: 8 },
  radioItem: { paddingVertical: 2 },
  splitInput: { marginBottom: 8, backgroundColor: Colors.surface },
  splitInfo: { color: Colors.textSecondary, marginTop: 4 },
  notesInput: { marginBottom: 16, backgroundColor: Colors.surface },
  checkoutButton: { borderRadius: 8, marginBottom: 24 },
  checkoutContent: { paddingVertical: 6 },
});
