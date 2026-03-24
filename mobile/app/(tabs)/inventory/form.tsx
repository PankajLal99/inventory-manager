import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import { Text, TextInput, Button, Switch, Card } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../../src/api/client';
import { Colors } from '../../../src/constants/theme';
import { useToast } from '../../../src/contexts/ToastContext';

export default function ProductFormScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();
  const isEdit = !!productId;

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [description, setDescription] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('0');
  const [trackInventory, setTrackInventory] = useState(true);
  const [canGoBelowPurchasePrice, setCanGoBelowPurchasePrice] = useState(false);

  const [categorySearch, setCategorySearch] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  const { data: product } = useQuery({
    queryKey: ['product', Number(productId)],
    queryFn: () => productsApi.get(Number(productId)),
    select: (res) => res.data,
    enabled: isEdit,
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => catalogApi.categories.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: () => catalogApi.brands.list(),
    select: (res) => {
      const d = res.data;
      if (Array.isArray(d)) return d;
      return d?.results || d?.data || [];
    },
  });

  useEffect(() => {
    if (product && isEdit) {
      setName(product.name || '');
      const catId = typeof product.category === 'object' ? product.category?.id : product.category;
      const brId = typeof product.brand === 'object' ? product.brand?.id : product.brand;
      setCategoryId(catId ? catId.toString() : '');
      setBrandId(brId ? brId.toString() : '');
      setDescription(product.description || '');
      setLowStockThreshold(product.low_stock_threshold?.toString() || '0');
      setTrackInventory(product.track_inventory !== undefined ? product.track_inventory : true);
      setCanGoBelowPurchasePrice(product.can_go_below_purchase_price || false);
    }
  }, [product, isEdit]);

  useEffect(() => {
    if (categoryId && categories) {
      const cat = categories.find((c: any) => c.id.toString() === categoryId);
      if (cat) setCategorySearch(cat.name);
    }
  }, [categoryId, categories]);

  useEffect(() => {
    if (brandId && brands) {
      const br = brands.find((b: any) => b.id.toString() === brandId);
      if (br) setBrandSearch(br.name);
    }
  }, [brandId, brands]);

  const createCatMutation = useMutation({
    mutationFn: (n: string) => catalogApi.categories.create({ name: n }),
    onSuccess: (res) => {
      const cat = res.data;
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setCategoryId(cat.id.toString());
      setCategorySearch(cat.name);
      setShowCatDropdown(false);
    },
  });

  const createBrandMutation = useMutation({
    mutationFn: (n: string) => catalogApi.brands.create({ name: n }),
    onSuccess: (res) => {
      const br = res.data;
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setBrandId(br.id.toString());
      setBrandSearch(br.name);
      setShowBrandDropdown(false);
    },
  });

  const mutation = useMutation({
    mutationFn: (data: any) => isEdit ? productsApi.update(Number(productId), data) : productsApi.create(data),
    onSuccess: () => {
      success(isEdit ? 'Product updated' : 'Product created');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['product', Number(productId)] });
      router.back();
    },
    onError: (err: any) => {
      const data = err.response?.data;
      if (typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        showError(msgs.join('\n'));
      } else {
        showError(data?.detail || 'Failed to save product');
      }
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) { showError('Product name is required'); return; }
    const payload: any = {
      name: name.trim(),
      description: description.trim(),
      low_stock_threshold: parseInt(lowStockThreshold) || 0,
      track_inventory: trackInventory,
      can_go_below_purchase_price: canGoBelowPurchasePrice,
      category_id: categoryId ? parseInt(categoryId) : null,
      brand_id: brandId ? parseInt(brandId) : null,
    };
    mutation.mutate(payload);
  };

  const filteredCats = (categories || []).filter((c: any) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );
  const filteredBrands = (brands || []).filter((b: any) =>
    b.name.toLowerCase().includes(brandSearch.toLowerCase())
  );
  const catExists = (categories || []).some((c: any) => c.name.toLowerCase() === categorySearch.toLowerCase());
  const brandExists = (brands || []).some((b: any) => b.name.toLowerCase() === brandSearch.toLowerCase());

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <TextInput
        label="Product Name *"
        mode="outlined"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />

      {/* Category */}
      <View style={{ zIndex: 2 }}>
        <TextInput
          label="Category"
          mode="outlined"
          value={categorySearch}
          onChangeText={(t) => { setCategorySearch(t); setShowCatDropdown(true); }}
          onFocus={() => setShowCatDropdown(true)}
          style={styles.input}
        />
        {showCatDropdown && (
          <Card style={styles.dropdown}>
            {filteredCats.slice(0, 10).map((cat: any) => (
              <TouchableOpacity key={cat.id} style={styles.dropdownItem}
                onPress={() => { setCategoryId(cat.id.toString()); setCategorySearch(cat.name); setShowCatDropdown(false); }}>
                <Text>{cat.name}</Text>
              </TouchableOpacity>
            ))}
            {categorySearch.trim() && !catExists && (
              <TouchableOpacity style={[styles.dropdownItem, { backgroundColor: '#eff6ff' }]}
                onPress={() => createCatMutation.mutate(categorySearch.trim())}>
                <Text style={{ color: Colors.primary }}>+ Add "{categorySearch.trim()}"</Text>
              </TouchableOpacity>
            )}
          </Card>
        )}
      </View>

      {/* Brand */}
      <View style={{ zIndex: 1 }}>
        <TextInput
          label="Brand"
          mode="outlined"
          value={brandSearch}
          onChangeText={(t) => { setBrandSearch(t); setShowBrandDropdown(true); }}
          onFocus={() => setShowBrandDropdown(true)}
          style={styles.input}
        />
        {showBrandDropdown && (
          <Card style={styles.dropdown}>
            {filteredBrands.slice(0, 10).map((br: any) => (
              <TouchableOpacity key={br.id} style={styles.dropdownItem}
                onPress={() => { setBrandId(br.id.toString()); setBrandSearch(br.name); setShowBrandDropdown(false); }}>
                <Text>{br.name}</Text>
              </TouchableOpacity>
            ))}
            {brandSearch.trim() && !brandExists && (
              <TouchableOpacity style={[styles.dropdownItem, { backgroundColor: '#eff6ff' }]}
                onPress={() => createBrandMutation.mutate(brandSearch.trim())}>
                <Text style={{ color: Colors.primary }}>+ Add "{brandSearch.trim()}"</Text>
              </TouchableOpacity>
            )}
          </Card>
        )}
      </View>

      <TextInput
        label="Description"
        mode="outlined"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        style={styles.input}
      />

      <TextInput
        label="Low Stock Threshold"
        mode="outlined"
        value={lowStockThreshold}
        onChangeText={setLowStockThreshold}
        keyboardType="number-pad"
        style={styles.input}
      />

      <View style={styles.switchRow}>
        <Text>Track Inventory</Text>
        <Switch value={trackInventory} onValueChange={setTrackInventory} />
      </View>

      <View style={styles.switchRow}>
        <Text>Can Go Below Purchase Price</Text>
        <Switch value={canGoBelowPurchasePrice} onValueChange={setCanGoBelowPurchasePrice} />
      </View>

      <Button mode="contained" onPress={handleSubmit} loading={mutation.isPending} style={{ marginTop: 16 }}>
        {isEdit ? 'Update Product' : 'Create Product'}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  input: { marginBottom: 12, backgroundColor: Colors.surface },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: Colors.surface, borderRadius: 8, marginBottom: 8 },
  dropdown: { position: 'absolute', top: 56, left: 0, right: 0, zIndex: 100, maxHeight: 200, backgroundColor: Colors.surface, elevation: 4 },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
});
