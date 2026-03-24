// Test the Colors constant object directly (theme is tested via Colors since
// MD3LightTheme import requires react-native-paper which needs the RN environment)

// We can't import theme directly in node mode due to react-native-paper dep.
// Instead we test the Colors export by importing it via a dynamic workaround.

describe('Colors object', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let Colors: any;

  beforeAll(() => {
    // Mock react-native-paper to avoid the react-native-web dep
    jest.mock('react-native-paper', () => ({
      MD3LightTheme: {
        colors: {
          primary: '#6750A4',
          background: '#FFFBFE',
          surface: '#FFFBFE',
        },
      },
    }));
    const themeModule = require('../../src/constants/theme');
    Colors = themeModule.Colors;
  });

  it('has primary color', () => {
    expect(Colors.primary).toBe('#1e40af');
  });

  it('has all status colors', () => {
    expect(Colors.success).toBe('#059669');
    expect(Colors.warning).toBe('#d97706');
    expect(Colors.error).toBe('#dc2626');
    expect(Colors.info).toBe('#0284c7');
  });

  it('has text colors', () => {
    expect(Colors.text).toBe('#0f172a');
    expect(Colors.textSecondary).toBe('#475569');
    expect(Colors.textMuted).toBe('#94a3b8');
  });

  it('has product marking colors', () => {
    expect(Colors.pestingGreen).toBe('#418f28');
    expect(Colors.nonPestingRed).toBe('#be1129');
  });

  it('has surfaceVariant', () => {
    expect(Colors.surfaceVariant).toBe('#f1f5f9');
  });

  it('has light variant colors', () => {
    expect(Colors.primaryLight).toBeDefined();
    expect(Colors.successLight).toBeDefined();
    expect(Colors.warningLight).toBeDefined();
    expect(Colors.errorLight).toBeDefined();
    expect(Colors.infoLight).toBeDefined();
  });

  it('theme has custom primary color', () => {
    const themeModule = require('../../src/constants/theme');
    expect(themeModule.theme.colors.primary).toBe('#1e40af');
  });
});
