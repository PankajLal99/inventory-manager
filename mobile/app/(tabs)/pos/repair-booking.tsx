import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Button, Card, Divider } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { posApi, catalogApi, customersApi } from '../../../src/api/client';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';

export default function RepairBookingScreen() {
  const { user } = useAuth();
  const { success, error: showError } = useToast();
  const router = useRouter();

  const [contactNo, setContactNo] = useState('');
  const [modelName, setModelName] = useState('');
  const [description, setDescription] = useState('');
  const [bookingAmount, setBookingAmount] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  const [storeId, setStoreId] = useState<number | null>(null);
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const res = await catalogApi.stores.list();
      const list = res.data?.results || res.data || [];
      if (list.length > 0 && !storeId) setStoreId(list[0].id);
      return list;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['repair-customers', customerSearch],
    queryFn: async () => {
      if (!customerSearch.trim()) return [];
      const res = await customersApi.list({ search: customerSearch, page_size: 10 });
      return res.data?.results || res.data || [];
    },
    enabled: customerSearch.length >= 2,
  });

  const handleModelSearch = async (text: string) => {
    setModelName(text);
    if (text.length >= 2) {
      try {
        const res = await posApi.repair.getDeviceModels(text);
        setModelSuggestions(res.data?.models || []);
      } catch {
        setModelSuggestions([]);
      }
    } else {
      setModelSuggestions([]);
    }
  };

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!modelName.trim()) throw new Error('Device model is required');
      if (!storeId) throw new Error('Store is required');

      const cartRes = await posApi.carts.create({
        store: storeId,
        customer: selectedCustomerId,
        invoice_type: 'pending',
      });
      const cartId = cartRes.data.id;

      const checkoutRes = await posApi.carts.checkout(cartId, {
        invoice_type: 'pending',
        customer: selectedCustomerId,
        repair: {
          contact_no: contactNo,
          model_name: modelName,
          description,
          booking_amount: bookingAmount || null,
        },
      });

      const invoiceId = checkoutRes.data?.id || checkoutRes.data?.invoice_id;
      if (invoiceId) {
        try {
          await posApi.repair.generateLabel(invoiceId);
        } catch {
          // label generation is non-critical
        }
      }
      return checkoutRes.data;
    },
    onSuccess: (data) => {
      success('Repair booked!');
      const invoiceId = data?.id || data?.invoice_id;
      if (invoiceId) {
        router.replace({
          pathname: '/(tabs)/invoices/[id]',
          params: { id: invoiceId.toString() },
        });
      } else {
        router.back();
      }
    },
    onError: (err: any) => {
      showError(err.message || err.response?.data?.detail || 'Failed to book repair');
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Customer</Text>
          <TextInput
            mode="outlined"
            dense
            placeholder="Search customer..."
            value={customerSearch}
            onChangeText={setCustomerSearch}
            style={styles.input}
          />
          {customers.length > 0 && (
            <View style={styles.suggestions}>
              {customers.slice(0, 5).map((c: any) => (
                <Button
                  key={c.id}
                  mode="text"
                  compact
                  onPress={() => {
                    setSelectedCustomerId(c.id);
                    setSelectedCustomerName(c.name);
                    setCustomerSearch(c.name);
                  }}
                >
                  {c.name}
                </Button>
              ))}
            </View>
          )}
          {selectedCustomerName ? (
            <Text variant="bodySmall" style={styles.selected}>
              Selected: {selectedCustomerName}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Device Details</Text>
          <Divider style={{ marginVertical: 8 }} />
          <TextInput
            mode="outlined"
            label="Device Model *"
            value={modelName}
            onChangeText={handleModelSearch}
            style={styles.input}
          />
          {modelSuggestions.length > 0 && (
            <View style={styles.suggestions}>
              {modelSuggestions.slice(0, 5).map((m) => (
                <Button
                  key={m}
                  mode="text"
                  compact
                  onPress={() => {
                    setModelName(m);
                    setModelSuggestions([]);
                  }}
                >
                  {m}
                </Button>
              ))}
            </View>
          )}
          <TextInput
            mode="outlined"
            label="Contact Number"
            value={contactNo}
            onChangeText={setContactNo}
            keyboardType="phone-pad"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Issue Description"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Booking Amount"
            value={bookingAmount}
            onChangeText={setBookingAmount}
            keyboardType="numeric"
            style={styles.input}
          />
        </Card.Content>
      </Card>

      <Button
        mode="contained"
        onPress={() => bookMutation.mutate()}
        loading={bookMutation.isPending}
        disabled={bookMutation.isPending || !modelName.trim()}
        style={styles.bookButton}
        contentStyle={{ paddingVertical: 6 }}
      >
        Book Repair
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  card: { marginBottom: 12, backgroundColor: Colors.surface },
  input: { marginBottom: 8, backgroundColor: Colors.surface },
  suggestions: {
    backgroundColor: Colors.surfaceVariant || '#f1f5f9',
    borderRadius: 8,
    marginBottom: 8,
  },
  selected: { color: Colors.success, marginTop: 4 },
  bookButton: { borderRadius: 8, marginBottom: 24 },
});
