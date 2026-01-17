import { useState, useEffect } from 'react';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Wrench, User, Phone, Package, DollarSign } from 'lucide-react';

interface RepairModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckout: (repairData: {
    repair_contact_no: string;
    repair_model_name: string;
    repair_booking_amount: string;
  }) => void;
  customerName?: string;
  isLoading?: boolean;
}

export default function RepairModal({
  isOpen,
  onClose,
  onCheckout,
  customerName = '',
  isLoading = false,
}: RepairModalProps) {
  const [contactNo, setContactNo] = useState('');
  const [modelName, setModelName] = useState('');
  const [bookingAmount, setBookingAmount] = useState('');

  // Reset form when modal closes after successful submission (when isLoading goes from true to false)
  useEffect(() => {
    if (!isOpen && !isLoading) {
      // Modal closed and not loading - reset form
      setContactNo('');
      setModelName('');
      setBookingAmount('');
    }
  }, [isOpen, isLoading]);

  const handleClose = () => {
    // Only reset form if not loading (to preserve data on error)
    if (!isLoading) {
      setContactNo('');
      setModelName('');
      setBookingAmount('');
    }
    onClose();
  };

  // Reset form when modal closes after successful submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCheckout({
      repair_contact_no: contactNo,
      repair_model_name: modelName,
      repair_booking_amount: bookingAmount,
    });
    // Don't reset here - let parent handle it after success
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Repair Information" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm text-blue-900">
            <Wrench className="h-4 w-4" />
            <span className="font-semibold">Enter repair details to complete checkout</span>
          </div>
        </div>

        {/* Customer Name (Read-only if provided) */}
        {customerName && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <User className="h-4 w-4 inline mr-1.5" />
              Customer Name
            </label>
            <Input
              type="text"
              value={customerName}
              disabled
              className="w-full bg-gray-50"
            />
          </div>
        )}

        {/* Contact Number */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <Phone className="h-4 w-4 inline mr-1.5" />
            Contact Number <span className="text-red-500">*</span>
          </label>
          <Input
            type="tel"
            placeholder="Enter contact number"
            value={contactNo}
            onChange={(e) => setContactNo(e.target.value)}
            required
            className="w-full"
          />
        </div>

        {/* Model Name */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <Package className="h-4 w-4 inline mr-1.5" />
            Model Name <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            placeholder="Enter device model name"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            required
            className="w-full"
          />
        </div>

        {/* Booking Amount */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <DollarSign className="h-4 w-4 inline mr-1.5" />
            Booking Amount
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={bookingAmount}
            onChange={(e) => setBookingAmount(e.target.value)}
            className="w-full"
          />
          <p className="text-xs text-gray-500 mt-1">Optional: Enter the booking amount received</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={isLoading || !contactNo.trim() || !modelName.trim()}
          >
            {isLoading ? 'Processing...' : 'Complete Checkout'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
