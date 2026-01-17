import { useNavigate } from 'react-router-dom';
import Card from '../../components/ui/Card';
import { ArrowRight, RefreshCw, Package, Receipt } from 'lucide-react';

export default function Replacement() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Replacement Module</h1>
        <p className="text-gray-600">Choose a replacement type to proceed</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Replace Product */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/replacement/replace-product')}>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <RefreshCw className="h-6 w-6 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Replace Product</h2>
            </div>
            <p className="text-gray-600 text-sm">
              Replace items with same or different products. Old items are returned to stock, new items are added to invoice. Price difference is adjusted in customer ledger.
            </p>
            <div className="flex items-center gap-2 text-blue-600 font-medium">
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </Card>

        {/* Return to Stock */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/replacement/return-to-stock')}>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Package className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Return to Stock</h2>
            </div>
            <p className="text-gray-600 text-sm">
              Return items to inventory. Items are removed from invoice and added back to stock. Customer receives a refund (credit entry in ledger).
            </p>
            <div className="flex items-center gap-2 text-green-600 font-medium">
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </Card>

        {/* Credit Note */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate('/replacement/credit-note')}>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Receipt className="h-6 w-6 text-purple-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Credit Note</h2>
            </div>
            <p className="text-gray-600 text-sm">
              Generate a credit note for returned items. Items are removed from invoice, added back to stock, and a credit note is created. Customer ledger is updated.
            </p>
            <div className="flex items-center gap-2 text-purple-600 font-medium">
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </Card>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Replacement Types Explained</h3>
        <div className="space-y-3 text-sm text-gray-700">
          <div>
            <strong className="text-blue-600">Replace Product:</strong> Use this when a customer wants to exchange an item for another item (same or different product). The system handles inventory updates and price differences automatically.
          </div>
          <div>
            <strong className="text-green-600">Return to Stock:</strong> Use this for simple returns where items are just being returned to inventory. Customer gets a refund and items are available for sale again.
          </div>
          <div>
            <strong className="text-purple-600">Credit Note:</strong> Use this when you need to issue a formal credit note for returned items. A credit note document is generated and customer account is credited.
          </div>
        </div>
      </div>
    </div>
  );
}
