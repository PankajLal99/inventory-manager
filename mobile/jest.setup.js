// Define __DEV__ for react-native compat
global.__DEV__ = true;

// Mock React hooks so components can be tested without a rendering context
const React = require('react');
jest.spyOn(React, 'useState').mockImplementation((init) => [typeof init === 'function' ? init() : init, jest.fn()]);
jest.spyOn(React, 'useEffect').mockImplementation(() => {});
jest.spyOn(React, 'useCallback').mockImplementation((fn) => fn);
jest.spyOn(React, 'useMemo').mockImplementation((fn) => fn());
jest.spyOn(React, 'useRef').mockImplementation((init) => ({ current: init }));
jest.spyOn(React, 'useContext').mockImplementation(() => ({}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-camera
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
}));

// Mock expo-print
jest.mock('expo-print', () => ({
  printAsync: jest.fn(),
  printToFileAsync: jest.fn(),
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

// Mock expo-status-bar
jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
}));

// Mock expo-constants
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

// Mock expo-router
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  Stack: {
    Screen: 'Screen',
    __esModule: true,
  },
  Tabs: {
    Screen: 'Screen',
    __esModule: true,
  },
  Redirect: 'Redirect',
  Link: 'Link',
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  Ionicons: 'Ionicons',
}));

// Mock react-native-paper
jest.mock('react-native-paper', () => {
  return {
    __esModule: true,
    MD3LightTheme: {
      colors: {
        primary: '#6750A4',
        background: '#FFFBFE',
        surface: '#FFFBFE',
        surfaceVariant: '#E7E0EC',
        onSurface: '#1C1B1F',
        onSurfaceVariant: '#49454F',
        outline: '#79747E',
      },
    },
    PaperProvider: ({ children }) => children,
    Text: 'Text',
    TextInput: Object.assign(
      function TextInput() { return 'TextInput'; },
      { Icon: 'TextInput.Icon', Affix: 'TextInput.Affix' },
    ),
    Button: 'Button',
    Card: Object.assign(
      function Card() { return 'Card'; },
      { Content: 'Card.Content', Title: 'Card.Title', Actions: 'Card.Actions' },
    ),
    IconButton: 'IconButton',
    FAB: 'FAB',
    Chip: 'Chip',
    Menu: Object.assign(
      function Menu() { return 'Menu'; },
      { Item: 'Menu.Item' },
    ),
    Divider: 'Divider',
    Portal: ({ children }) => children,
    Modal: 'Modal',
    RadioButton: Object.assign(
      function RadioButton() { return 'RadioButton'; },
      { Group: 'RadioButton.Group', Item: 'RadioButton.Item' },
    ),
    List: {
      Item: 'List.Item',
      Icon: 'List.Icon',
      Section: 'List.Section',
      Subheader: 'List.Subheader',
    },
    HelperText: 'HelperText',
    ActivityIndicator: 'ActivityIndicator',
    Surface: 'Surface',
    SegmentedButtons: 'SegmentedButtons',
    Searchbar: 'Searchbar',
    DataTable: Object.assign(
      function DataTable() { return 'DataTable'; },
      {
        Header: 'DataTable.Header',
        Title: 'DataTable.Title',
        Row: 'DataTable.Row',
        Cell: 'DataTable.Cell',
      },
    ),
    Switch: 'Switch',
    ProgressBar: 'ProgressBar',
    Badge: 'Badge',
    Avatar: { Text: 'Avatar.Text', Icon: 'Avatar.Icon' },
  };
});

// Mock @tanstack/react-query
jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn().mockImplementation(() => ({
    defaultOptions: {},
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
  })),
  QueryClientProvider: ({ children }) => children,
  useQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
  })),
  useMutation: jest.fn(() => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
  })),
  useQueryClient: jest.fn(() => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
  })),
  useInfiniteQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
  })),
}));
