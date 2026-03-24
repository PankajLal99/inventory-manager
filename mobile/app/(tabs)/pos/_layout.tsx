import { Stack } from 'expo-router';
import { Colors } from '../../../src/constants/theme';

export default function PosLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Point of Sale' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="repair-booking" options={{ title: 'Book Repair' }} />
      <Stack.Screen name="active-carts" options={{ title: 'Active Carts' }} />
      <Stack.Screen name="scanner" options={{ title: 'Scan Barcode', presentation: 'modal' }} />
    </Stack>
  );
}
