import csv
import os
from datetime import datetime

class InventoryRemediationLogger:
    def __init__(self, filename=None):
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"inventory_remediation_{timestamp}.csv"
        
        self.filename = filename
        self.headers = ['timestamp', 'action', 'model', 'object_id', 'reference_id', 'field', 'old_value', 'new_value', 'reason', 'metadata']
        
        # Initialize file with headers if it doesn't exist
        if not os.path.exists(self.filename):
            with open(self.filename, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=self.headers)
                writer.writeheader()

    def log(self, action, model, object_id, reference_id, field, old_value, new_value, reason, metadata=""):
        with open(self.filename, 'a', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=self.headers)
            writer.writerow({
                'timestamp': datetime.now().isoformat(),
                'action': action,
                'model': model,
                'object_id': str(object_id),
                'reference_id': str(reference_id),
                'field': field,
                'old_value': str(old_value),
                'new_value': str(new_value),
                'reason': reason,
                'metadata': str(metadata)
            })

# Singleton instance for easy import
logger = InventoryRemediationLogger("inventory_healing_log.csv")
