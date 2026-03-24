import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Card, IconButton, Chip } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '../../../src/api/client';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';
import { formatAmountINR, formatDateDDMMYYYY } from '../../../src/utils/formatting';

export default function ActiveCartsScreen() {
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const { data: carts = [], isLoading } = useQuery({
    queryKey: ['active-carts'],
    queryFn: async () => {
      const res = await posApi.carts.getOverview();
      return res.data?.results || res.data || [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => posApi.carts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-carts'] });
      success('Cart discarded');
    },
    onError: () => showError('Failed to discard cart'),
  });

  const handleDiscard = (id: number) => {
    Alert.alert('Discard Cart', 'Delete this cart and return items to stock?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const renderCart = ({ item }: { item: any }) => (
    <Card style={styles.card}>
      <Card.Content>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall">Cart #{item.cart_number || item.id}</Text>
            <Text variant="bodySmall" style={styles.muted}>
              {item.store_name || 'Unknown Store'} · {item.user || 'Unknown'}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              {item.item_count || 0} items · {formatDateDDMMYYYY(item.created_at)}
            </Text>
          </View>
          <View style={styles.actions}>
            <Chip compact>{(item.invoice_type || 'cash').toUpperCase()}</Chip>
            <IconButton
              icon="delete-outline"
              iconColor={Colors.error}
              size={20}
              onPress={() => handleDiscard(item.id)}
            />
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={carts}
        renderItem={renderCart}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodyLarge" style={styles.muted}>
              {isLoading ? 'Loading...' : 'No active carts'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  empty: { paddingTop: 60, alignItems: 'center' },
  muted: { color: Colors.textMuted, marginTop: 2 },
});
