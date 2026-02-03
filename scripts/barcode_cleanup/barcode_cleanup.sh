#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."

echo "========================================"
echo "   Barcode Cleanup CLI"
echo "========================================"

# 1. Run Basic Audit
echo -e "\n[1/3] Running Basic Barcode Audit..."
python3 "$SCRIPT_DIR/audit_barcodes.py"

# 2. Run Deep Investigation (History & Anomalies)
echo -e "\n[2/3] Running Deep Audit Investigation..."
python3 "$SCRIPT_DIR/deep_audit_investigator.py"

# 3. Enhanced Healing (Scanned vs. Sold Analysis)
if [[ "$1" == "--real" ]]; then
    echo -e "\n[3/3] Running REAL Healing & Repairs..."
    # python3 "$SCRIPT_DIR/barcode_status_healer.py" --apply
    # python3 "$SCRIPT_DIR/repair_barcodes.py" --real
else
    echo -e "\n[3/3] Running DRY RUN Healing & Repairs..."
    python3 "$SCRIPT_DIR/barcode_status_healer.py"
    python3 "$SCRIPT_DIR/repair_barcodes.py"
fi

echo -e "\n========================================"
echo "   Cleanup Process Finished"
echo "========================================"
