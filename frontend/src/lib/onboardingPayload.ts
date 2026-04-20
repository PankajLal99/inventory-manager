import type { OnboardingPayload } from './api';

type InputStore = { name: string; code: string; shop_type: string; is_primary: boolean };
type InputRole = { name: string; description: string; permission_codenames: string };
type InputUser = {
  username: string;
  password: string;
  email: string;
  groups: string[];
  default_store_code: string;
  assigned_store_codes: string[];
  role_name: string;
  dashboard_only: boolean;
};

export function buildOnboardingPayload(args: {
  password: string;
  mode: 'create_retailer' | 'extend_retailer';
  retailerCode: string;
  retailerName: string;
  selectedRetailer?: { id: number; code: string } | null;
  stores: InputStore[];
  roles: InputRole[];
  users: InputUser[];
}): OnboardingPayload {
  const payload: OnboardingPayload = {
    password: args.password,
    mode: args.mode,
    stores: args.stores.map((s) => ({
      name: s.name.trim(),
      code: s.code.trim().toUpperCase(),
      shop_type: s.shop_type,
      is_primary: s.is_primary,
    })),
    roles: args.roles
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        description: r.description.trim(),
        permission_codenames: r.permission_codenames.split(',').map((x) => x.trim()).filter(Boolean),
      })),
    users: args.users.map((u) => ({
      username: u.username.trim(),
      password: u.password,
      email: u.email.trim() || undefined,
      groups: u.groups,
      default_store_code: u.default_store_code || undefined,
      assigned_store_codes: u.assigned_store_codes,
      role_name: u.role_name || undefined,
      dashboard_only: u.dashboard_only,
    })),
  };
  if (args.mode === 'create_retailer') {
    payload.retailer = {
      code: args.retailerCode.trim().toUpperCase(),
      name: args.retailerName.trim(),
    };
  } else if (args.selectedRetailer) {
    payload.existing_retailer = {
      id: args.selectedRetailer.id,
      code: args.selectedRetailer.code,
    };
  }
  return payload;
}
