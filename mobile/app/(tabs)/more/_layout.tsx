import { Stack } from 'expo-router';
import { Colors } from '../../../src/constants/theme';

export default function MoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'More' }} />
      <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
      <Stack.Screen name="search" options={{ title: 'Search' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
      <Stack.Screen name="payments" options={{ title: 'Payments' }} />
      <Stack.Screen name="payment-reminders" options={{ title: 'Payment Reminders' }} />
      <Stack.Screen name="defective" options={{ title: 'Defective Move-Outs' }} />
      <Stack.Screen name="history" options={{ title: 'Activity History' }} />
      <Stack.Screen name="stores" options={{ title: 'Stores & Warehouses' }} />
      <Stack.Screen name="customers/index" options={{ title: 'Customers' }} />
      <Stack.Screen name="personal-customers" options={{ title: 'Personal Customers' }} />
      <Stack.Screen name="vendors" options={{ title: 'Vendors' }} />
      <Stack.Screen name="ledger/[id]" options={{ title: 'Customer Ledger' }} />
      <Stack.Screen name="personal-ledger/[id]" options={{ title: 'Personal Ledger' }} />
      <Stack.Screen name="internal-ledger/[id]" options={{ title: 'Internal Ledger' }} />
      <Stack.Screen name="repairs" options={{ title: 'Repairs' }} />
      <Stack.Screen name="replacements/index" options={{ title: 'Replacements' }} />
      <Stack.Screen name="replacements/process" options={{ title: 'Process Replacement' }} />
      <Stack.Screen name="replacements/requests" options={{ title: 'Replacement Requests' }} />
      <Stack.Screen name="replacements/history" options={{ title: 'Replacement History' }} />
    </Stack>
  );
}
