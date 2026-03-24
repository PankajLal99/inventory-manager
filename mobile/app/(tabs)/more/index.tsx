import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, List, Divider } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Colors } from '../../../src/constants/theme';

const menuSections = [
  {
    title: 'Analytics',
    items: [
      { title: 'Dashboard', icon: 'view-dashboard', route: '/(tabs)/more/dashboard' },
      { title: 'Reports', icon: 'chart-bar', route: '/(tabs)/more/reports' },
      { title: 'Global Search', icon: 'magnify', route: '/(tabs)/more/search' },
    ],
  },
  {
    title: 'People',
    items: [
      { title: 'Customers', icon: 'account-group', route: '/(tabs)/more/customers' },
      { title: 'Personal Customers', icon: 'account', route: '/(tabs)/more/personal-customers' },
      { title: 'Vendors', icon: 'truck', route: '/(tabs)/more/vendors' },
      { title: 'Payment Reminders', icon: 'bell-ring', route: '/(tabs)/more/payment-reminders' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { title: 'Repairs', icon: 'wrench', route: '/(tabs)/more/repairs' },
      { title: 'Replacements', icon: 'swap-horizontal', route: '/(tabs)/more/replacements' },
      { title: 'Credit Notes', icon: 'credit-card-refund', route: '/(tabs)/invoices/credit-notes' },
      { title: 'Defective Move-outs', icon: 'alert-circle', route: '/(tabs)/more/defective' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { title: 'Expenses', icon: 'cash-minus', route: '/(tabs)/more/expenses' },
      { title: 'Payments', icon: 'cash-check', route: '/(tabs)/more/payments' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Stores & Warehouses', icon: 'store', route: '/(tabs)/more/stores' },
      { title: 'Activity History', icon: 'history', route: '/(tabs)/more/history' },
      { title: 'Settings', icon: 'cog', route: '/(tabs)/more/settings' },
    ],
  },
];

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {menuSections.map((section) => (
        <View key={section.title}>
          <Text variant="titleSmall" style={styles.sectionTitle}>{section.title}</Text>
          <Card style={styles.card}>
            {section.items.map((item, i) => (
              <View key={item.route}>
                <List.Item
                  title={item.title}
                  left={(props) => <List.Icon {...props} icon={item.icon} />}
                  right={(props) => <List.Icon {...props} icon="chevron-right" />}
                  onPress={() => router.push(item.route as any)}
                />
                {i < section.items.length - 1 && <Divider />}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionTitle: { marginLeft: 16, marginTop: 16, marginBottom: 4, color: Colors.textMuted },
  card: { marginHorizontal: 8, backgroundColor: Colors.surface },
});
