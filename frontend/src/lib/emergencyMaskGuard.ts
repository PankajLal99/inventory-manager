/**
 * Block file exports (PDF / Excel / CSV) while emergency data mask is active.
 * Installed once from main.tsx so individual pages do not need per-button wiring.
 */
import { auth } from './auth';

export const EXPORTS_DISABLED_MESSAGE =
  'Exports are disabled while emergency data mask is active.';

export function isEmergencyMaskActive(): boolean {
  return Boolean(
    auth.getUser('main')?.emergency_mask_active ||
      auth.getUser('credit')?.emergency_mask_active ||
      auth.getUser('salary_book')?.emergency_mask_active
  );
}

export function assertExportsAllowed(): void {
  if (!isEmergencyMaskActive()) return;
  if (typeof window !== 'undefined') {
    window.alert(EXPORTS_DISABLED_MESSAGE);
  }
  throw new Error(EXPORTS_DISABLED_MESSAGE);
}

/** Patch common download entry points used across the app. */
export async function installEmergencyMaskExportGuards(): Promise<void> {
  try {
    const XLSX = await import('xlsx');
    const originalWriteFile = XLSX.writeFile.bind(XLSX);
    (XLSX as any).writeFile = (...args: unknown[]) => {
      assertExportsAllowed();
      return originalWriteFile(...(args as [any, string]));
    };
  } catch {
    // xlsx may be code-split; pages that import it still share the module instance after first load
  }

  try {
    const { jsPDF } = await import('jspdf');
    const proto = (jsPDF as unknown as { prototype: { save: (...a: unknown[]) => unknown } }).prototype;
    if (proto && !(proto.save as any).__emergencyMaskGuarded) {
      const originalSave = proto.save;
      proto.save = function guardedSave(this: unknown, ...args: unknown[]) {
        assertExportsAllowed();
        return originalSave.apply(this, args as []);
      };
      (proto.save as any).__emergencyMaskGuarded = true;
    }
  } catch {
    // ignore
  }
}
