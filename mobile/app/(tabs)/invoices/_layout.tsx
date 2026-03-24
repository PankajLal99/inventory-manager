import { Stack } from 'expo-router';
import { Colors } from '../../../src/constants/theme';

export default function InvoicesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Invoices' }} />
      <Stack.Screen name="[id]" options={{ title: 'Invoice Detail' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit Invoice' }} />
      <Stack.Screen name="credit-notes/index" options={{ title: 'Credit Notes' }} />
      <Stack.Screen name="credit-notes/[id]" options={{ title: 'Credit Note Detail' }} />
    </Stack>
  );
}
