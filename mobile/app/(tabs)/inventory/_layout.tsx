import { Stack } from 'expo-router';
import { Colors } from '../../../src/constants/theme';

export default function InventoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Products' }} />
      <Stack.Screen name="[id]" options={{ title: 'Product Detail' }} />
      <Stack.Screen name="form" options={{ title: 'Product Form' }} />
      <Stack.Screen name="stock" options={{ title: 'Stock Overview' }} />
      <Stack.Screen name="purchases/index" options={{ title: 'Purchases' }} />
      <Stack.Screen name="purchases/[id]" options={{ title: 'Purchase Detail' }} />
      <Stack.Screen name="pricing" options={{ title: 'Pricing' }} />
    </Stack>
  );
}
