import Modal from './ui/Modal';

interface ShortcutsHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ShortcutsHelpModal({ isOpen, onClose }: ShortcutsHelpModalProps) {
    const shortcuts = [
        { key: 'F1', description: 'Show this help menu' },
        { key: 'F2', description: 'Focus Search / Barcode Input' },
        { key: 'F3', description: 'New Sale (Create New Cart)' },
        { key: 'F4', description: 'Toggle Payment Mode (Cash -> UPI -> Mixed -> Pending)' },
        { key: 'F8', description: 'Complete Order (No Print)' },
        { key: 'F9', description: 'Checkout & Print (Thermal)' },
        { key: 'Shift + Del', description: 'Delete Current Cart' },
        { key: 'Esc', description: 'Clear Search / Close Scanner / Close Modal' },
        { key: 'Alt + S', description: 'Toggle Strict Barcode Mode' },
    ];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Keyboard Shortcuts"
            size="md"
        >
            <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                    {shortcuts.map((shortcut, index) => (
                        <div
                            key={index}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors"
                        >
                            <span className="text-gray-700 font-medium">{shortcut.description}</span>
                            <kbd className="px-2.5 py-1 bg-white border border-gray-200 rounded-md text-sm font-semibold text-gray-800 shadow-sm min-w-[3rem] text-center">
                                {shortcut.key}
                            </kbd>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500">
                        Press <kbd className="font-semibold">F1</kbd> internally to toggle this menu
                    </p>
                </div>
            </div>
        </Modal>
    );
}
