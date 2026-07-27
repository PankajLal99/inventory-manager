/** Holds ledger PNG after invoice/return image was copied (browsers = 1 clipboard image). */
let pendingLedgerImage: Blob | null = null;

export function setPendingLedgerClipboardImage(blob: Blob | null) {
  pendingLedgerImage = blob;
}

export function peekPendingLedgerClipboardImage(): Blob | null {
  return pendingLedgerImage;
}

export function takePendingLedgerClipboardImage(): Blob | null {
  const blob = pendingLedgerImage;
  pendingLedgerImage = null;
  return blob;
}
