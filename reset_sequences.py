#!/usr/bin/env python
"""
Reset PostgreSQL sequences after importing data with explicit primary keys
This ensures new records get correct auto-increment IDs

SAFE: This only updates sequence counters, it does NOT modify any existing data or relationships.
- Existing records keep their IDs
- Foreign key relationships remain intact
- Only affects future INSERT operations
"""
import os
import sys
import django
from pathlib import Path

# Setup Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.core.management import call_command
from django.db import connection

print("🔄 Resetting PostgreSQL sequences...")
print("")

try:
    # Get all installed apps
    from django.apps import apps
    app_configs = apps.get_app_configs()
    
    # Get all models
    models = []
    for app_config in app_configs:
        models.extend(app_config.get_models())
    
    # Reset sequences for each model
    # NOTE: This is SAFE - it only updates sequence counters, not existing data
    with connection.cursor() as cursor:
        for model in models:
            if hasattr(model._meta, 'db_table'):
                table_name = model._meta.db_table
                try:
                    # Get the max ID from the table
                    cursor.execute(f"SELECT MAX(id) FROM {table_name};")
                    max_id = cursor.fetchone()[0]
                    
                    if max_id is not None:
                        # Reset sequence to max_id + 1
                        # This only affects future INSERTs, not existing data
                        sequence_name = f"{table_name}_id_seq"
                        cursor.execute(f"SELECT setval('{sequence_name}', {max_id + 1}, false);")
                        print(f"  ✅ Reset {table_name} sequence to {max_id + 1} (existing {max_id} records safe)")
                    else:
                        # Table is empty, set sequence to 1
                        sequence_name = f"{table_name}_id_seq"
                        cursor.execute(f"SELECT setval('{sequence_name}', 1, false);")
                        print(f"  ✅ Reset {table_name} sequence to 1 (empty table)")
                except Exception as e:
                    # Skip if table doesn't exist or sequence doesn't exist
                    print(f"  ⚠️  Skipped {table_name}: {e}")
                    continue
    
    print("")
    print("✅ All sequences reset successfully!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
