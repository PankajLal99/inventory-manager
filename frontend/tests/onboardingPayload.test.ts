import { describe, expect, it } from 'vitest';
import { buildOnboardingPayload } from '../src/lib/onboardingPayload';

describe('buildOnboardingPayload', () => {
  const baseArgs = {
    password: 'secret',
    stores: [{ name: 'Main Hub', code: 'hub', shop_type: 'warehouse', is_primary: true }],
    roles: [{ name: 'Cashier', description: 'Can bill', permission_codenames: 'nav.pos, nav.search' }],
    users: [
      {
        username: 'owner',
        password: 'pw',
        email: 'owner@example.com',
        groups: ['Admin'],
        default_store_code: 'HUB',
        assigned_store_codes: ['HUB'],
        role_name: 'Cashier',
        dashboard_only: false,
      },
    ],
  };

  it('builds create retailer payload', () => {
    const payload = buildOnboardingPayload({
      ...baseArgs,
      mode: 'create_retailer',
      retailerCode: 'ret-1',
      retailerName: 'Retailer One',
      selectedRetailer: null,
    });
    expect(payload.mode).toBe('create_retailer');
    expect(payload.retailer?.code).toBe('RET-1');
    expect(payload.roles[0].permission_codenames).toEqual(['nav.pos', 'nav.search']);
  });

  it('builds extend retailer payload', () => {
    const payload = buildOnboardingPayload({
      ...baseArgs,
      mode: 'extend_retailer',
      retailerCode: '',
      retailerName: '',
      selectedRetailer: { id: 5, code: 'R5' },
    });
    expect(payload.mode).toBe('extend_retailer');
    expect(payload.existing_retailer).toEqual({ id: 5, code: 'R5' });
    expect(payload).not.toHaveProperty('retailer');
  });
});
