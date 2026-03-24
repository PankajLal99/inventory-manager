import { useState, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Card, TextInput, IconButton, Button, FAB } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi, productsApi } from '../../../src/api/client';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, getProductNameColor } from '../../../src/utils/formatting';
import { getPriceValidationError, getEffectivePrice } from '../../../src/utils/priceValidation';
import { looksLikeBarcode } from '../../../src/utils/barcodeHelpers';

export default function InvoiceEditScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const [cartId, setCartId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({});
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create edit cart from invoice
  const { data: editCart } = useQuery({
    queryKey: ['edit-cart', invoiceId],
    queryFn: async () => {
      const res = await posApi.invoices.edit(Number(invoiceId));
      const newCartId = res.data?.cart_id || res.data?.id;
      setCartId(newCartId);
      return res.data;
    },
    enabled: !!invoiceId && !cartId,
  });

  const { data: cartData } = useQuery({
    queryKey: ['cart', cartId],
    queryFn: async () => {
      const res = await posApi.carts.get(cartId!);
      return res.data;
    },
    enabled: !!cartId,
  });

  const items = cartData?.items || [];

  const addItemMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.addItem(cartId!, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart', cartId] }),
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to add item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.carts.deleteItem(cartId!, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart', cartId] }),
  });

  const applyMutation = useMutation({
    mutationFn: () => posApi.invoices.updateFromCart(Number(invoiceId), cartId!),
    onSuccess: () => {
      success('Invoice updated');
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      router.back();
    },
    onError: (err: any) => showError(err.response?.data?.detail || 'Failed to update'),
  });

  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (text.length < 2 || !cartId) return;
      searchTimeout.current = setTimeout(async () => {
        try {
          if (looksLikeBarcode(text)) {
            await addItemMutation.mutateAsync({ barcode: text });
            setSearchQuery('');
            success('Item added');
          }
        } catch { /* handled by mutation */ }
      }, 300);
    }, [cartId],
  );

  const total = items.reduce((sum: number, item: any) => {
    const price = getEffectivePrice(item, editingPrices[item.id]);
    return sum + price * item.quantity;
  }, 0);

  return (
    <View style={styles.container}>
      <TextInput
        mode="outlined"
        dense
        placeholder="Scan barcode to add..."
        value={searchQuery}
        onChangeText={handleSearch}
        left={<TextInput.Icon icon="barcode-scan" />}
        style={styles.searchInput}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <View style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: getProductNameColor(item.product_name) || Colors.text }}>
                  {item.product_name}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>Qty: {item.quantity}</Text>
              </View>
              <Text variant="bodyMedium">₹{formatAmountINR(item.manual_unit_price || item.unit_price || 0)}</Text>
              <IconButton icon="delete-outline" iconColor={Colors.error} size={20} onPress={() => deleteItemMutation.mutate(item.id)} />
            </View>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Loading edit cart...</Text>}
      />

      <View style={styles.bottomBar}>
        <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>₹{formatAmountINR(total)}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button mode="outlined" onPress={() => {
            if (cartId) posApi.carts.delete(cartId);
            router.back();
          }}>Cancel</Button>
          <Button mode="contained" onPress={() => applyMutation.mutate()} loading={applyMutation.isPending}>
            Apply Changes
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchInput: { margin: 8, backgroundColor: Colors.surface },
  list: { padding: 8, paddingBottom: 80 },
  itemCard: { marginBottom: 4, backgroundColor: Colors.surface },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  muted: { color: Colors.textMuted },
  empty: { textAlign: 'center', paddingTop: 40, color: Colors.textMuted },
  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
  },
});
