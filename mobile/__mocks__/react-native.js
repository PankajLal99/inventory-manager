// Comprehensive react-native mock for node environment testing
const StyleSheet = {
  create: (styles) => styles,
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  flatten: (style) => style,
  hairlineWidth: 1,
  compose: (a, b) => [a, b],
};

const rn = {
  Platform: {
    OS: 'android',
    Version: 33,
    select: (obj) => obj.android || obj.default,
  },
  StyleSheet,
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  TouchableHighlight: 'TouchableHighlight',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: jest.fn() },
  Animated: {
    View: 'Animated.View',
    Text: 'Animated.Text',
    Image: 'Animated.Image',
    ScrollView: 'Animated.ScrollView',
    FlatList: 'Animated.FlatList',
    Value: jest.fn(() => ({
      interpolate: jest.fn(),
      setValue: jest.fn(),
    })),
    timing: jest.fn(() => ({ start: jest.fn() })),
    spring: jest.fn(() => ({ start: jest.fn() })),
    sequence: jest.fn(() => ({ start: jest.fn() })),
    parallel: jest.fn(() => ({ start: jest.fn() })),
    event: jest.fn(),
    createAnimatedComponent: jest.fn((component) => component),
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 375, height: 812 })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  PixelRatio: {
    get: jest.fn(() => 2),
    roundToNearestPixel: jest.fn((v) => v),
    getPixelSizeForLayoutSize: jest.fn((v) => v * 2),
  },
  Linking: { openURL: jest.fn(), canOpenURL: jest.fn().mockResolvedValue(true) },
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  SafeAreaView: 'SafeAreaView',
  StatusBar: 'StatusBar',
  Modal: 'Modal',
  RefreshControl: 'RefreshControl',
  Switch: 'Switch',
  Keyboard: { dismiss: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() },
  Clipboard: { getString: jest.fn(), setString: jest.fn() },
  BackHandler: { addEventListener: jest.fn(), removeEventListener: jest.fn(), exitApp: jest.fn() },
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  I18nManager: { isRTL: false },
  NativeModules: {},
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  })),
  useColorScheme: jest.fn(() => 'light'),
  useWindowDimensions: jest.fn(() => ({ width: 375, height: 812 })),
};

// Support ESM interop
rn.__esModule = true;
rn.default = rn;

module.exports = rn;
