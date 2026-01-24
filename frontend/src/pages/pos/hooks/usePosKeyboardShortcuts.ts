import { useEffect } from 'react';

interface UsePosKeyboardShortcutsProps {
    onShowHelp: () => void;
    onFocusSearch: () => void;
    onNewSale: () => void;
    onTogglePaymentMode: () => void;
    onCheckout: () => void;
    onCompleteSale: () => void;
    onDeleteCart: () => void;
    onCancel: () => void;
    onToggleStrictBarcode: () => void;
    isEnabled?: boolean;
}

export default function usePosKeyboardShortcuts({
    onShowHelp,
    onFocusSearch,
    onNewSale,
    onTogglePaymentMode,
    onCheckout,
    onCompleteSale,
    onDeleteCart,
    onCancel,
    onToggleStrictBarcode,
    isEnabled = true,
}: UsePosKeyboardShortcutsProps) {
    useEffect(() => {
        if (!isEnabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // F1: Show Help
            if (e.key === 'F1') {
                e.preventDefault();
                onShowHelp();
                return;
            }

            // F2: Focus Search
            if (e.key === 'F2') {
                e.preventDefault();
                onFocusSearch();
                return;
            }

            // F3: New Sale
            if (e.key === 'F3') {
                e.preventDefault();
                onNewSale();
                return;
            }

            // F4: Toggle Payment Mode
            if (e.key === 'F4') {
                e.preventDefault();
                onTogglePaymentMode();
                return;
            }

            // F8: Complete Order (No Print)
            if (e.key === 'F8') {
                e.preventDefault();
                onCompleteSale();
                return;
            }

            // F9: Checkout & Print (Thermal)
            if (e.key === 'F9') {
                e.preventDefault();
                onCheckout();
                return;
            }

            // Shift + Delete: Delete Cart
            if (e.key === 'Delete' && e.shiftKey) {
                e.preventDefault();
                onDeleteCart();
                return;
            }

            // Esc: Cancel / Close
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
                return;
            }

            // Alt + S: Toggle Strict Barcode
            if (e.key.toLowerCase() === 's' && e.altKey) {
                e.preventDefault();
                onToggleStrictBarcode();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [
        isEnabled,
        onShowHelp,
        onFocusSearch,
        onNewSale,
        onTogglePaymentMode,
        onCheckout,
        onDeleteCart,
        onCancel,
        onToggleStrictBarcode
    ]);
}
