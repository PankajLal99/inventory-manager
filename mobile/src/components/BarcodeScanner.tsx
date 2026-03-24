import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Text, IconButton } from 'react-native-paper';
import { Colors } from '../constants/theme';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text variant="bodyLarge" style={styles.permissionText}>
          Camera permission is required for barcode scanning
        </Text>
        <Button mode="contained" onPress={requestPermission}>
          Grant Permission
        </Button>
        <Button mode="text" onPress={onClose} style={{ marginTop: 12 }}>
          Cancel
        </Button>
      </View>
    );
  }

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScan(data);
    setTimeout(() => setScanned(false), 1500);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: [
            'qr',
            'ean13',
            'ean8',
            'code128',
            'code39',
            'code93',
            'upc_a',
            'upc_e',
            'itf14',
            'codabar',
          ],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.topOverlay}>
          <IconButton
            icon="close"
            iconColor="#fff"
            size={28}
            onPress={onClose}
            style={styles.closeButton}
          />
        </View>
        <View style={styles.scanArea}>
          <View style={styles.scanFrame} />
        </View>
        <View style={styles.bottomOverlay}>
          <Text style={styles.hint}>
            {scanned ? 'Scanned!' : 'Point camera at barcode'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.background,
  },
  permissionText: {
    textAlign: 'center',
    marginBottom: 20,
    color: Colors.textSecondary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topOverlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingTop: 48,
    paddingHorizontal: 8,
    alignItems: 'flex-end',
  },
  closeButton: { backgroundColor: 'rgba(0,0,0,0.3)' },
  scanArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  bottomOverlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 24,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});
