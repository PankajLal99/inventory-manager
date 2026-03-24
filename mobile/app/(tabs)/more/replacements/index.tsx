import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Button, List } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../src/constants/theme';

export default function ReplacementHubScreen() {
  const router = useRouter();

  const options = [
    {
      title: 'Process Replacement',
      description: 'Scan a product to start the replacement flow',
      icon: 'swap-horizontal',
      route: '/(tabs)/more/replacements/process' as const,
    },
    {
      title: 'Replacement Requests',
      description: 'View and manage pending replacement requests',
      icon: 'clipboard-list',
      route: '/(tabs)/more/replacements/requests' as const,
    },
    {
      title: 'Replacement History',
      description: 'View completed replacements',
      icon: 'history',
      route: '/(tabs)/more/replacements/history' as const,
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
      <Text variant="titleLarge" style={{ marginBottom: 16 }}>Replacements</Text>
      {options.map((opt) => (
        <Card key={opt.route} style={styles.card} onPress={() => router.push(opt.route)}>
          <Card.Content>
            <List.Item
              title={opt.title}
              description={opt.description}
              left={(props) => <List.Icon {...props} icon={opt.icon} />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Card.Content>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
});
