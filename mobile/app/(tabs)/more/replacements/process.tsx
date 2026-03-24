import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Button, Card, RadioButton } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '../../../../src/api/client';
import { Colors } from '../../../../src/constants/theme';
import { useToast } from '../../../../src/contexts/ToastContext';
import BarcodeScanner from '../../../../src/components/BarcodeScanner';

export default function ProcessReplacementScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const [step, setStep] = useState<'scan' | 'details' | 'done'>('scan');
  const [barcode, setBarcode] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [reason, setReason] = useState('defective');
  const [notes, setNotes] = useState('');
  const [replacementType, setReplacementType] = useState<'same' | 'different'>('same');
  const [result, setResult] = useState<any>(null);

  const processMutation = useMutation({
    mutationFn: (data: any) => posApi.replacement.create(data),
    onSuccess: (res: any) => {
      success('Replacement processed');
      setResult(res.data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: any) => showError(err.response?.data?.detail || err.response?.data?.error || 'Failed to process'),
  });

  const handleScan = (code: string) => {
    setBarcode(code);
    setShowScanner(false);
    setStep('details');
  };

  const handleSubmit = () => {
    if (!barcode) { showError('Scan or enter a barcode first'); return; }
    Alert.alert('Confirm Replacement', `Process replacement for barcode: ${barcode}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Process',
        onPress: () => processMutation.mutate({
          barcode,
          reason,
          notes,
          replacement_type: replacementType,
        }),
      },
    ]);
  };

  if (showScanner) {
    return (
      <View style={styles.container}>
        <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      </View>
    );
  }

  if (step === 'done' && result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={{ color: '#16a34a', marginBottom: 8 }}>Replacement Processed!</Text>
            {result.replacement_number && <Text variant="bodyMedium">Replacement #: {result.replacement_number}</Text>}
            {result.invoice_number && <Text variant="bodyMedium">Invoice: {result.invoice_number}</Text>}
            <Text variant="bodySmall" style={styles.muted}>{JSON.stringify(result, null, 2)}</Text>
          </Card.Content>
        </Card>
        <Button mode="contained" onPress={() => router.back()} style={{ marginTop: 12 }}>Done</Button>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
      {step === 'scan' && (
        <>
          <Text variant="titleMedium" style={{ marginBottom: 12 }}>Step 1: Scan Product</Text>
          <TextInput
            label="Enter barcode"
            mode="outlined"
            value={barcodeInput}
            onChangeText={setBarcodeInput}
            onSubmitEditing={() => { if (barcodeInput.trim()) handleScan(barcodeInput.trim()); }}
            right={<TextInput.Icon icon="barcode-scan" onPress={() => setShowScanner(true)} />}
            style={styles.input}
          />
          <Button mode="outlined" icon="camera" onPress={() => setShowScanner(true)} style={{ marginTop: 8 }}>
            Open Scanner
          </Button>
        </>
      )}

      {step === 'details' && (
        <>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="bodySmall" style={styles.muted}>Scanned Barcode</Text>
              <Text variant="titleSmall" style={{ fontFamily: 'monospace' }}>{barcode}</Text>
            </Card.Content>
          </Card>

          <Text variant="titleMedium" style={{ marginTop: 12, marginBottom: 8 }}>Step 2: Details</Text>

          <Text variant="bodySmall" style={{ marginBottom: 4 }}>Reason</Text>
          <RadioButton.Group value={reason} onValueChange={setReason}>
            {['defective', 'damaged', 'wrong_item', 'customer_return'].map((r) => (
              <View key={r} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RadioButton value={r} />
                <Text>{r.replace('_', ' ')}</Text>
              </View>
            ))}
          </RadioButton.Group>

          <Text variant="bodySmall" style={{ marginTop: 8, marginBottom: 4 }}>Replacement Type</Text>
          <RadioButton.Group value={replacementType} onValueChange={(v) => setReplacementType(v as any)}>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><RadioButton value="same" /><Text>Same Product</Text></View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><RadioButton value="different" /><Text>Different</Text></View>
            </View>
          </RadioButton.Group>

          <TextInput label="Notes" mode="outlined" value={notes} onChangeText={setNotes}
            multiline numberOfLines={3} style={styles.input} />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button mode="outlined" onPress={() => { setStep('scan'); setBarcode(''); }} style={{ flex: 1 }}>Back</Button>
            <Button mode="contained" onPress={handleSubmit} loading={processMutation.isPending} style={{ flex: 1 }}>Process</Button>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { marginBottom: 8, backgroundColor: Colors.surface },
  input: { marginTop: 8, backgroundColor: Colors.surface },
  muted: { color: Colors.textMuted },
});
