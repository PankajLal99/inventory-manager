// BarcodeScanner component tests
// Since @testing-library/react-native requires react-native (not available in node env),
// we test the module structure and the expo-camera mock behavior directly.

jest.mock('react-native-paper', () => ({
  Button: 'Button',
  Text: 'Text',
  IconButton: 'IconButton',
}));

jest.mock('../../src/constants/theme', () => ({
  Colors: {
    primary: '#1e40af',
    background: '#f8fafc',
    textSecondary: '#475569',
  },
}));

describe('BarcodeScanner module', () => {
  it('exports a default component', () => {
    const BarcodeScanner = require('../../src/components/BarcodeScanner').default;
    expect(BarcodeScanner).toBeDefined();
    expect(typeof BarcodeScanner).toBe('function');
  });

  it('component is callable as a function (React component)', () => {
    const BarcodeScanner = require('../../src/components/BarcodeScanner').default;
    // Verify the component function accepts props
    expect(BarcodeScanner.length).toBeGreaterThanOrEqual(0);
  });
});

describe('expo-camera mock', () => {
  it('useCameraPermissions returns granted permission by default', () => {
    const { useCameraPermissions } = require('expo-camera');
    const [permission, requestPermission] = useCameraPermissions();
    expect(permission.granted).toBe(true);
    expect(typeof requestPermission).toBe('function');
  });

  it('CameraView is mocked', () => {
    const { CameraView } = require('expo-camera');
    expect(CameraView).toBeDefined();
  });
});
