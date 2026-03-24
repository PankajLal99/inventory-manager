// Test ToastContext module exports and logic
// We can't use @testing-library/react-native in node mode,
// so we test the module's exports and standalone function behavior.

describe('ToastContext module', () => {
  it('exports ToastProvider', () => {
    const mod = require('../../src/contexts/ToastContext');
    expect(mod.ToastProvider).toBeDefined();
    expect(typeof mod.ToastProvider).toBe('function');
  });

  it('exports useToast hook', () => {
    const mod = require('../../src/contexts/ToastContext');
    expect(mod.useToast).toBeDefined();
    expect(typeof mod.useToast).toBe('function');
  });

  it('exports standalone toast function', () => {
    const mod = require('../../src/contexts/ToastContext');
    expect(mod.toast).toBeDefined();
    expect(typeof mod.toast).toBe('function');
  });

  it('standalone toast does not throw when no provider', () => {
    const mod = require('../../src/contexts/ToastContext');
    expect(() => mod.toast('test message')).not.toThrow();
  });

  it('standalone toast accepts type parameter', () => {
    const mod = require('../../src/contexts/ToastContext');
    expect(() => mod.toast('error msg', 'error')).not.toThrow();
    expect(() => mod.toast('success msg', 'success')).not.toThrow();
    expect(() => mod.toast('info msg', 'info')).not.toThrow();
  });
});
