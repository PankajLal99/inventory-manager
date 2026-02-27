import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { posApi } from '../../lib/api';
import { Wrench, Clock, CheckCircle, Truck, FileText, AlertTriangle, User, IndianRupee, XCircle } from 'lucide-react';
import { formatNumber } from '../../lib/utils';

interface RepairStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (status: string) => void;
  invoiceNumber: string;
  currentStatus: string;
  invoiceStatus?: 'draft' | 'paid' | 'partial' | 'credit' | 'void';
  isLoading?: boolean;
  customerName?: string | null;
  bookingAmount?: string | null;
  /** Status options from backend (repair status choices). When provided, dropdown and labels use this list. */
  statusOptions?: { value: string; label: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  work_in_progress: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-800',
  not_repaired: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-red-100 text-red-800',
};

const STATUS_ICONS: Record<string, any> = {
  received: Clock,
  work_in_progress: Wrench,
  done: CheckCircle,
  delivered: Truck,
  not_repaired: AlertTriangle,
  cancelled: XCircle,
};

export default function RepairStatusModal({
  isOpen,
  onClose,
  onUpdate,
  invoiceNumber,
  currentStatus,
  invoiceStatus,
  isLoading = false,
  customerName,
  bookingAmount,
  statusOptions = [],
}: RepairStatusModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>(currentStatus);

  // Use parent-provided options, or fetch when modal is open and none provided
  const { data: fetchedChoices } = useQuery({
    queryKey: ['repair-status-choices'],
    queryFn: () => posApi.repair.getStatusChoices(),
    enabled: isOpen && statusOptions.length === 0,
  });
  const options =
    statusOptions.length > 0 ? statusOptions : (fetchedChoices?.data ?? []);

  // Reset selected status when modal opens or current status changes
  useEffect(() => {
    if (isOpen) {
      setSelectedStatus(currentStatus);
    }
  }, [isOpen, currentStatus]);

  const handleClose = () => {
    if (!isLoading) {
      setSelectedStatus(currentStatus);
    }
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStatus && selectedStatus !== currentStatus) {
      onUpdate(selectedStatus);
    }
  };

  const getStatusBadge = (status: string) => {
    const Icon = STATUS_ICONS[status] || Clock;
    const label = options.find((s) => s.value === status)?.label ?? status;
    return (
      <Badge className={STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Update Repair Status" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm text-blue-900">
            <Wrench className="h-4 w-4" />
            <span className="font-semibold">Update the repair status for this invoice</span>
          </div>
        </div>

        {/* Repair / Invoice details */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <FileText className="h-4 w-4 inline mr-1.5" />
              Invoice Number
            </label>
            <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 flex items-center justify-between">
              {invoiceNumber}
              {invoiceStatus && (
                <Badge className={
                  invoiceStatus === 'paid' ? 'bg-green-100 text-green-800' :
                  invoiceStatus === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                  invoiceStatus === 'void' ? 'bg-red-100 text-red-800' :
                  invoiceStatus === 'credit' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }>
                  {invoiceStatus.charAt(0).toUpperCase() + invoiceStatus.slice(1)}
                </Badge>
              )}
            </div>
          </div>
          {(customerName != null || bookingAmount != null) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {customerName != null && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    <User className="h-4 w-4 inline mr-1.5" />
                    Customer
                  </label>
                  <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700">
                    {customerName || 'Walk-in Customer'}
                  </div>
                </div>
              )}
              {bookingAmount != null && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    <IndianRupee className="h-4 w-4 inline mr-1.5" />
                    Booking Amount
                  </label>
                  <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700">
                    {bookingAmount ? `₹${formatNumber(bookingAmount)}` : 'N/A'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Current Status */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Current Status
          </label>
          <div className="mb-4">
            {getStatusBadge(currentStatus)}
          </div>
        </div>

        {/* New Status */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            New Status <span className="text-red-500">*</span>
          </label>
          <Select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            required
            className="w-full"
          >
            <option value="">Select status</option>
            {options.map((status) => (
              <option
                key={status.value}
                value={status.value}
              >
                {status.label}
              </option>
            ))}
          </Select>
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
            variant="primary"
            disabled={
              isLoading || 
              !selectedStatus || 
              selectedStatus === currentStatus
            }
          >
            {isLoading ? 'Updating...' : 'Update Status'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
