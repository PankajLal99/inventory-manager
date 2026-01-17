import { useState, useEffect } from 'react';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Wrench, Clock, CheckCircle, Truck, FileText, AlertTriangle } from 'lucide-react';

interface RepairStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (status: string) => void;
  invoiceNumber: string;
  currentStatus: 'received' | 'work_in_progress' | 'done' | 'delivered';
  invoiceStatus?: 'draft' | 'paid' | 'partial' | 'credit' | 'void';
  isLoading?: boolean;
}

const STATUS_OPTIONS = [
  { value: 'received', label: 'Received' },
  { value: 'work_in_progress', label: 'In Progress' },
  { value: 'done', label: 'Completed' },
  { value: 'delivered', label: 'Delivered' },
];

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  work_in_progress: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-800',
};

const STATUS_ICONS: Record<string, any> = {
  received: Clock,
  work_in_progress: Wrench,
  done: CheckCircle,
  delivered: Truck,
};

export default function RepairStatusModal({
  isOpen,
  onClose,
  onUpdate,
  invoiceNumber,
  currentStatus,
  invoiceStatus,
  isLoading = false,
}: RepairStatusModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>(currentStatus);

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
    return (
      <Badge className={STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}>
        <Icon className="h-3 w-3 mr-1" />
        {STATUS_OPTIONS.find(s => s.value === status)?.label || status}
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

        {/* Invoice Number (Read-only) */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <FileText className="h-4 w-4 inline mr-1.5" />
            Invoice Number
          </label>
          <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700">
            {invoiceNumber}
          </div>
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
            {STATUS_OPTIONS.map((status) => {
              // Disable "Completed" (done) if invoice is not paid or credit
              const isCompleted = status.value === 'done';
              const canComplete = invoiceStatus === 'paid' || invoiceStatus === 'credit' || invoiceStatus === 'partial';
              const isDisabled = isCompleted && !canComplete;
              
              return (
                <option 
                  key={status.value} 
                  value={status.value}
                  disabled={isDisabled}
                >
                  {status.label} {isDisabled ? '(Invoice must be paid/credit)' : ''}
                </option>
              );
            })}
          </Select>
          {selectedStatus === 'done' && invoiceStatus && invoiceStatus !== 'paid' && invoiceStatus !== 'credit' && invoiceStatus !== 'partial' && (
            <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              <span>Cannot mark as Completed. Invoice must be marked as Paid, Credit, or Partially Paid first.</span>
            </div>
          )}
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
              selectedStatus === currentStatus ||
              (selectedStatus === 'done' && invoiceStatus && invoiceStatus !== 'paid' && invoiceStatus !== 'credit' && invoiceStatus !== 'partial')
            }
          >
            {isLoading ? 'Updating...' : 'Update Status'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
