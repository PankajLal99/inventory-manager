import { useRouter } from 'expo-router';
import BarcodeScanner from '../../../src/components/BarcodeScanner';

export default function ScannerScreen() {
  const router = useRouter();

  const handleScan = (barcode: string) => {
    // Go back to POS with scanned barcode as a param
    router.back();
    // Use a short delay so navigation settles, then trigger search
    // The POS screen listens via params
    router.setParams({ scannedBarcode: barcode });
  };

  return <BarcodeScanner onScan={handleScan} onClose={() => router.back()} />;
}
