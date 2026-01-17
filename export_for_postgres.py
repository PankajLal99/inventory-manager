#!/usr/bin/env python
"""
Export SQLite data to JSON for PostgreSQL migration
- Temporarily switches to SQLite for export
- Cleans auth.group permissions for deleted models
"""
import os
import sys
import django
import json
from pathlib import Path

# Setup Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.core.management import call_command
from django.conf import settings

# Deleted models that should not have permissions
DELETED_MODELS = [
    ('core', 'permission'),
    ('core', 'role'),
    ('purchasing', 'directpurchase'),
    ('purchasing', 'directpurchaseline'),
    ('purchasing', 'grn'),
    ('purchasing', 'grnline'),
    ('purchasing', 'purchaseorder'),
    ('purchasing', 'purchaseorderline'),
]

def clean_auth_groups(data):
    """Remove permissions for deleted models from auth.group entries"""
    fixed_count = 0
    total_removed = 0
    
    for entry in data:
        if entry.get('model') == 'auth.group':
            fields = entry.get('fields', {})
            permissions = fields.get('permissions', [])
            
            if permissions:
                original_count = len(permissions)
                cleaned_permissions = []
                
                for perm in permissions:
                    # Check if it's a list with 3 elements: [codename, app_label, model_name]
                    if isinstance(perm, list) and len(perm) == 3:
                        app_label, model_name = perm[1], perm[2]
                        # Skip if it references a deleted model
                        if (app_label, model_name) in DELETED_MODELS:
                            continue
                    cleaned_permissions.append(perm)
                
                if len(cleaned_permissions) < original_count:
                    fields['permissions'] = cleaned_permissions
                    fixed_count += 1
                    total_removed += (original_count - len(cleaned_permissions))
    
    if fixed_count > 0:
        print(f"  ✅ Cleaned {fixed_count} auth.group entries (removed {total_removed} permissions for deleted models)")
    
    return data

# Temporarily switch to SQLite
original_db = settings.DATABASES['default'].copy()
settings.DATABASES['default'] = {
    'ENGINE': 'django.db.backends.sqlite3',
    'NAME': BASE_DIR / 'db.sqlite3',
}

try:
    print("📤 Exporting from SQLite database...")
    print("   Excluding: contenttypes, auth.permission, sessions, core.auditlog")
    print("")
    
    # Export to temporary file
    temp_file = BASE_DIR / 'sqlite_export_temp.json'
    call_command('dumpdata', 
                exclude=['contenttypes', 'auth.permission', 'sessions', 'core.auditlog'],
                natural_foreign=True,
                natural_primary=True,
                indent=2,
                output=str(temp_file))
    
    print("🔧 Cleaning auth.group permissions for deleted models...")
    
    # Load, clean, and save
    with open(temp_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    data = clean_auth_groups(data)
    
    output_file = BASE_DIR / 'sqlite_export.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Remove temp file
    temp_file.unlink()
    
    print("")
    print("✅ Export completed: sqlite_export.json")
    print("")
    print("Next steps:")
    print("  1. Run migrations on PostgreSQL: python manage.py migrate")
    print("  2. Import data: python manage.py loaddata sqlite_export.json")
    print("  3. Reset sequences: python manage.py sqlsequencereset | python manage.py dbshell")
    print("")
    print("   Or use the reset_sequences.py script for easier sequence reset")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
finally:
    # Restore original database settings
    settings.DATABASES['default'] = original_db
