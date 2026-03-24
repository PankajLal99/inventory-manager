import { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  FAB,
  Card,
  Chip,
  Menu,
  Divider,
  Portal,
  Modal,
  RadioButton,
} from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi, productsApi, catalogApi, customersApi } from '../../../src/api/client';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useToast } from '../../../src/contexts/ToastContext';
import { Colors } from '../../../src/constants/theme';
import {
  formatNumber,
  formatAmountINR,
  getProductNameColor,
  getStockInfo,
} from '../../../src/utils/formatting';
import {
  getPriceValidationError,
  getEffectivePrice,
  allItemsHavePrices,
} from '../../../src/utils/priceValidation';
import { looksLikeBarcode } from '../../../src/utils/barcodeHelpers';
import type { CartItem, Store, Customer } from '../../../src/types';

export default function POSScreen() {
  const { user } = useAuth();
  const { success, error: showError } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ─── State ─────────────────────────────────────────────
  const [cartId, setCartId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  const [invoiceType, setInvoiceType] = useState<string>('cash');
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({});
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Queries ───────────────────────────────────────────
  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const res = await catalogApi.stores.list();
      const list = res.data?.results || res.data || [];
      if (list.length > 0 && !selectedStoreId) {
        setSelectedStoreId(list[0].id);
      }
      return list as Store[];
    },
  });

  const {
    data: cartData,
    isLoading: cartLoading,
  } = useQuery({
    queryKey: ['cart', cartId],
    queryFn: async () => {
      if (!cartId) return null;
      const res = await posApi.carts.get(cartId);
      return res.data;
    },
    enabled: !!cartId,
  });

  const cartItems: CartItem[] = cartData?.items || [];

  const { data: customerResults = [] } = useQuery({
    queryKey: ['customers-search', customerSearch],
    queryFn: async () => {
      if (!customerSearch.trim()) return [];
      const res = await customersApi.list({ search: customerSearch, page_size: 10 });
      return res.data?.results || res.data || [];
    },
    enabled: customerSearch.length >= 2,
  });

  // ─── Mutations ─────────────────────────────────────────
  const createCartMutation = useMutation({
    mutationFn: () => posApi.carts.create({ store: selectedStoreId }),
    onSuccess: (res) => {
      setCartId(res.data.id);
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: () => showError('Failed to create cart'),
  });

  const addItemMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.addItem(cartId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
    },
    onError: (err: any) => {
      showError(err.response?.data?.detail || err.response?.data?.error || 'Failed to add item');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) =>
      posApi.carts.updateItem(cartId!, itemId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cart', cartId] }),
    onError: () => showError('Failed to update item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.carts.deleteItem(cartId!, itemId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cart', cartId] }),
  });

  const deleteCartMutation = useMutation({
    mutationFn: () => posApi.carts.delete(cartId!),
    onSuccess: () => {
      setCartId(null);
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      success('Cart deleted');
    },
  });

  // ─── Search ────────────────────────────────────────────
  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (text.length < 2) {
        setSearchResults([]);
        setShowSearchResults(false);
        return;
      }

      searchTimeout.current = setTimeout(async () => {
        try {
          if (looksLikeBarcode(text)) {
            const res = await productsApi.byBarcode(text);
            const product = res.data;
            if (product) {
              if (cartId) {
                await addItemMutation.mutateAsync({
                  barcode: text,
                  product_id: product.product_id || product.id,
                });
                setSearchQuery('');
                setShowSearchResults(false);
                success('Item added');
              } else {
                setSearchResults([product]);
                setShowSearchResults(true);
              }
            }
          } else {
            const res = await productsApi.list({ search: text, page_size: 10 });
            const products = res.data?.results || res.data || [];
            setSearchResults(products);
            setShowSearchResults(products.length > 0);
          }
        } catch {
          setSearchResults([]);
          setShowSearchResults(false);
        }
      }, 300);
    },
    [cartId],
  );

  const addProductToCart = async (product: any) => {
    setShowSearchResults(false);
    setSearchQuery('');

    if (!cartId) {
      if (!selectedStoreId) {
        showError('Please select a store first');
        return;
      }
      try {
        const res = await posApi.carts.create({ store: selectedStoreId });
        const newCartId = res.data.id;
        setCartId(newCartId);
        await posApi.carts.addItem(newCartId, {
          product_id: product.id,
          quantity: 1,
        });
        queryClient.invalidateQueries({ queryKey: ['cart', newCartId] });
        success('Item added');
      } catch (err: any) {
        showError(err.response?.data?.detail || 'Failed to add item');
      }
      return;
    }

    addItemMutation.mutate({
      product_id: product.id,
      quantity: 1,
    });
    success('Item added');
  };

  const handleUpdatePrice = (itemId: number, price: string) => {
    setEditingPrices((prev) => ({ ...prev, [itemId]: price }));
  };

  const confirmPrice = (item: CartItem) => {
    const priceStr = editingPrices[item.id];
    if (priceStr === undefined) return;
    const price = parseFloat(priceStr);
    if (isNaN(price) || price < 0) {
      showError('Invalid price');
      return;
    }
    const validationError = getPriceValidationError(price, item, invoiceType);
    if (validationError) {
      showError(validationError);
      return;
    }
    updateItemMutation.mutate({
      itemId: item.id,
      data: { manual_unit_price: price },
    });
    setEditingPrices((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const handleDeleteItem = (itemId: number) => {
    Alert.alert('Remove Item', 'Remove this item from cart?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteItemMutation.mutate(itemId) },
    ]);
  };

  const handleCheckout = () => {
    if (!cartId || cartItems.length === 0) {
      showError('Cart is empty');
      return;
    }
    if (!allItemsHavePrices(cartItems, editingPrices, invoiceType)) {
      showError('All items must have prices');
      return;
    }
    router.push({
      pathname: '/(tabs)/pos/checkout',
      params: {
        cartId: cartId.toString(),
        invoiceType,
        customerId: selectedCustomerId?.toString() || '',
        customerName: selectedCustomerName,
        storeId: selectedStoreId?.toString() || '',
      },
    });
  };

  const handleDeleteCart = () => {
    if (!cartId) return;
    Alert.alert('Delete Cart', 'Are you sure you want to delete this cart?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCartMutation.mutate() },
    ]);
  };

  const cartTotal = cartItems.reduce((sum, item) => {
    const price = getEffectivePrice(item, editingPrices[item.id]);
    return sum + price * item.quantity;
  }, 0);

  // ─── Render ────────────────────────────────────────────
  const renderCartItem = ({ item }: { item: CartItem }) => {
    const nameColor = getProductNameColor(item.product_name);
    const effectivePrice = getEffectivePrice(item, editingPrices[item.id]);
    const validationError = getPriceValidationError(effectivePrice, item, invoiceType);
    const isEditing = editingPrices[item.id] !== undefined;

    return (
      <Card style={styles.itemCard}>
        <View style={styles.itemRow}>
          <View style={styles.itemInfo}>
            <Text
              variant="bodyMedium"
              style={[styles.itemName, nameColor ? { color: nameColor } : null]}
              numberOfLines={2}
            >
              {item.product_name}
            </Text>
            <Text variant="bodySmall" style={styles.itemQty}>
              Qty: {item.quantity}
              {item.barcode_count ? ` (${item.barcode_count} barcodes)` : ''}
            </Text>
          </View>
          <View style={styles.itemPriceSection}>
            <TextInput
              mode="outlined"
              dense
              value={
                isEditing
                  ? editingPrices[item.id]
                  : String(item.manual_unit_price ?? item.unit_price ?? '')
              }
              onChangeText={(t) => handleUpdatePrice(item.id, t)}
              onBlur={() => confirmPrice(item)}
              keyboardType="numeric"
              style={styles.priceInput}
              error={!!validationError}
            />
            <Text variant="bodySmall" style={styles.itemTotal}>
              ₹{formatAmountINR(effectivePrice * item.quantity)}
            </Text>
          </View>
          <IconButton
            icon="delete-outline"
            iconColor={Colors.error}
            size={20}
            onPress={() => handleDeleteItem(item.id)}
          />
        </View>
        {validationError ? (
          <Text style={styles.validationError}>{validationError}</Text>
        ) : null}
      </Card>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Top Bar: Store + Invoice Type */}
      <View style={styles.topBar}>
        <Menu
          visible={showStoreMenu}
          onDismiss={() => setShowStoreMenu(false)}
          anchor={
            <Chip icon="store" onPress={() => setShowStoreMenu(true)} style={styles.chip}>
              {stores.find((s) => s.id === selectedStoreId)?.name || 'Select Store'}
            </Chip>
          }
        >
          {stores.map((store) => (
            <Menu.Item
              key={store.id}
              onPress={() => {
                setSelectedStoreId(store.id);
                setShowStoreMenu(false);
              }}
              title={store.name}
            />
          ))}
        </Menu>

        <Menu
          visible={showTypeMenu}
          onDismiss={() => setShowTypeMenu(false)}
          anchor={
            <Chip icon="cash" onPress={() => setShowTypeMenu(true)} style={styles.chip}>
              {invoiceType.toUpperCase()}
            </Chip>
          }
        >
          {['cash', 'upi', 'pending', 'mixed', 'credit'].map((type) => (
            <Menu.Item
              key={type}
              onPress={() => {
                setInvoiceType(type);
                setShowTypeMenu(false);
              }}
              title={type.toUpperCase()}
            />
          ))}
        </Menu>
      </View>

      {/* Customer Selection */}
      <View style={styles.customerBar}>
        <Chip
          icon="account"
          onPress={() => setShowCustomerModal(true)}
          onClose={selectedCustomerId ? () => {
            setSelectedCustomerId(null);
            setSelectedCustomerName('');
          } : undefined}
          style={styles.customerChip}
        >
          {selectedCustomerName || 'Walk-in Customer'}
        </Chip>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          mode="outlined"
          dense
          placeholder="Search product or scan barcode..."
          value={searchQuery}
          onChangeText={handleSearch}
          left={<TextInput.Icon icon="magnify" />}
          right={
            searchQuery ? (
              <TextInput.Icon
                icon="close"
                onPress={() => {
                  setSearchQuery('');
                  setShowSearchResults(false);
                }}
              />
            ) : undefined
          }
          style={styles.searchInput}
        />
      </View>

      {/* Search Results Dropdown */}
      {showSearchResults && searchResults.length > 0 && (
        <View style={styles.searchDropdown}>
          {searchResults.slice(0, 8).map((product: any) => {
            const stockInfo = getStockInfo(product);
            const nameColor = getProductNameColor(product.name);
            return (
              <Card
                key={product.id}
                style={styles.searchResultCard}
                onPress={() => addProductToCart(product)}
              >
                <View style={styles.searchResultRow}>
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="bodyMedium"
                      style={nameColor ? { color: nameColor } : undefined}
                      numberOfLines={1}
                    >
                      {product.name}
                    </Text>
                    <Text variant="bodySmall" style={styles.muted}>
                      {product.sku || ''} · Stock: {stockInfo.displayAvailable}
                    </Text>
                  </View>
                  <Text variant="bodyMedium" style={styles.productPrice}>
                    ₹{formatNumber(product.selling_price || product.purchase_price || 0)}
                  </Text>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Cart Items */}
      <FlatList
        data={cartItems}
        renderItem={renderCartItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text variant="bodyLarge" style={styles.emptyText}>
              {cartId ? 'Cart is empty' : 'Scan or search to start'}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              Use the scan button or search bar above
            </Text>
          </View>
        }
      />

      {/* Bottom Bar */}
      {cartItems.length > 0 && (
        <View style={styles.bottomBar}>
          <View style={styles.totalSection}>
            <Text variant="bodySmall" style={styles.muted}>
              {cartItems.length} item{cartItems.length !== 1 ? 's' : ''}
            </Text>
            <Text variant="headlineSmall" style={styles.totalText}>
              ₹{formatAmountINR(cartTotal)}
            </Text>
          </View>
          <View style={styles.bottomActions}>
            <IconButton
              icon="delete"
              iconColor={Colors.error}
              size={24}
              onPress={handleDeleteCart}
            />
            <Button
              mode="contained"
              onPress={handleCheckout}
              style={styles.checkoutButton}
              contentStyle={styles.checkoutContent}
            >
              Checkout
            </Button>
          </View>
        </View>
      )}

      {/* Scan FAB */}
      <FAB
        icon="barcode-scan"
        style={[styles.fab, cartItems.length > 0 && { bottom: 90 }]}
        onPress={() => router.push('/(tabs)/pos/scanner')}
        color="#fff"
      />

      {/* Customer Selection Modal */}
      <Portal>
        <Modal
          visible={showCustomerModal}
          onDismiss={() => setShowCustomerModal(false)}
          contentContainerStyle={styles.modal}
        >
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>
            Select Customer
          </Text>
          <TextInput
            mode="outlined"
            dense
            placeholder="Search customers..."
            value={customerSearch}
            onChangeText={setCustomerSearch}
            style={{ marginBottom: 8 }}
          />
          {customerResults.map((c: Customer) => (
            <Card
              key={c.id}
              style={styles.customerCard}
              onPress={() => {
                setSelectedCustomerId(c.id);
                setSelectedCustomerName(c.name);
                setShowCustomerModal(false);
                setCustomerSearch('');
                if (cartId) {
                  posApi.carts.update(cartId, { customer: c.id });
                }
              }}
            >
              <Card.Content>
                <Text variant="bodyMedium">{c.name}</Text>
                {c.phone ? (
                  <Text variant="bodySmall" style={styles.muted}>
                    {c.phone}
                  </Text>
                ) : null}
              </Card.Content>
            </Card>
          ))}
          <Button
            mode="text"
            onPress={() => {
              setSelectedCustomerId(null);
              setSelectedCustomerName('');
              setShowCustomerModal(false);
              setCustomerSearch('');
            }}
            style={{ marginTop: 8 }}
          >
            Walk-in (No Customer)
          </Button>
        </Modal>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  chip: { flex: 1 },
  customerBar: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: Colors.surface,
  },
  customerChip: {},
  searchContainer: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchInput: { backgroundColor: Colors.surface },
  searchDropdown: {
    position: 'absolute',
    top: 140,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: Colors.surface,
    elevation: 8,
    maxHeight: 320,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  searchResultCard: {
    marginHorizontal: 8,
    marginVertical: 2,
    backgroundColor: Colors.surface,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  productPrice: { fontWeight: '600', color: Colors.success },
  listContent: { padding: 8, paddingBottom: 160 },
  itemCard: {
    marginBottom: 6,
    backgroundColor: Colors.surface,
    elevation: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  itemInfo: { flex: 1, marginRight: 8 },
  itemName: { fontWeight: '500' },
  itemQty: { color: Colors.textSecondary, marginTop: 2 },
  itemPriceSection: { alignItems: 'flex-end', minWidth: 100 },
  priceInput: { width: 90, textAlign: 'right', backgroundColor: Colors.surface },
  itemTotal: { color: Colors.textSecondary, marginTop: 2 },
  validationError: {
    color: Colors.error,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { color: Colors.textSecondary },
  muted: { color: Colors.textMuted },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    elevation: 8,
  },
  totalSection: {},
  totalText: { fontWeight: 'bold', color: Colors.text },
  bottomActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  checkoutButton: { borderRadius: 8 },
  checkoutContent: { paddingHorizontal: 16, paddingVertical: 4 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    backgroundColor: Colors.primary,
  },
  modal: {
    backgroundColor: Colors.surface,
    padding: 20,
    margin: 20,
    borderRadius: 12,
    maxHeight: '70%',
  },
  customerCard: {
    marginVertical: 2,
    backgroundColor: Colors.surfaceVariant || '#f1f5f9',
  },
});
