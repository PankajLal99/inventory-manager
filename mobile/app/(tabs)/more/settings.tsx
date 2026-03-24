import { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, Card, TextInput, Button, Divider, List, Switch } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../../src/contexts/AuthContext';
import { Colors } from '../../../src/constants/theme';
import { useToast } from '../../../src/contexts/ToastContext';

const DEFAULT_BASE_URL = 'http://10.0.2.2:8765/api/v1';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { success } = useToast();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('api_base_url').then((url) => {
      if (url) setBaseUrl(url);
    });
  }, []);

  const saveBaseUrl = async () => {
    await AsyncStorage.setItem('api_base_url', baseUrl);
    setEditing(false);
    success('Server URL saved. Restart the app for changes to take effect.');
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* User Info */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8 }}>Account</Text>
          <Text variant="bodyMedium">{user?.username || 'Unknown'}</Text>
          {user?.email && <Text variant="bodySmall" style={styles.muted}>{user.email}</Text>}
          {user?.groups && user.groups.length > 0 && (
            <Text variant="bodySmall" style={styles.muted}>Groups: {user.groups.join(', ')}</Text>
          )}
        </Card.Content>
      </Card>

      {/* Server Config */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8 }}>Server</Text>
          {editing ? (
            <>
              <TextInput
                label="API Base URL"
                mode="outlined"
                value={baseUrl}
                onChangeText={setBaseUrl}
                style={{ marginBottom: 8, backgroundColor: Colors.surface }}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button mode="outlined" onPress={() => setEditing(false)} style={{ flex: 1 }}>Cancel</Button>
                <Button mode="contained" onPress={saveBaseUrl} style={{ flex: 1 }}>Save</Button>
              </View>
            </>
          ) : (
            <>
              <Text variant="bodySmall" style={styles.muted}>API URL</Text>
              <Text variant="bodyMedium" selectable>{baseUrl}</Text>
              <Button mode="text" onPress={() => setEditing(true)} compact style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                Edit
              </Button>
            </>
          )}
        </Card.Content>
      </Card>

      {/* About */}
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleSmall" style={{ marginBottom: 8 }}>About</Text>
          <Text variant="bodySmall" style={styles.muted}>Inventory Manager Mobile</Text>
          <Text variant="bodySmall" style={styles.muted}>Version 1.0.0</Text>
        </Card.Content>
      </Card>

      <Button mode="contained" buttonColor={Colors.error} textColor="#fff" onPress={handleLogout}
        style={{ marginTop: 16 }} icon="logout">
        Logout
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  muted: { color: Colors.textMuted, marginVertical: 1 },
});
