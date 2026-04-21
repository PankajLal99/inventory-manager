import os
import django
from django.conf import settings
from django.db import models

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

def analyze_models():
    print(f"{'App':<15} | {'Model':<30} | {'Tenant-Aware':<12}")
    print("-" * 65)
    
    tenant_apps = [
        'catalog', 'config', 'core', 'inventory', 'locations', 
        'parties', 'pos', 'pricing', 'purchasing', 'reports'
    ]
    
    aware_count = 0
    unaware_count = 0
    
    for model in django.apps.apps.get_models():
        app_label = model._meta.app_label
        if app_label not in tenant_apps:
            continue
            
        model_name = model.__name__
        # Check for 'retailer' field
        is_aware = any(field.name == 'retailer' for field in model._meta.fields)
        
        status = "✅ YES" if is_aware else "❌ NO"
        if is_aware:
            aware_count += 1
        else:
            # Some models might not need it (e.g. Setting, AuditLog if global)
            unaware_count += 1
            
        print(f"{app_label:<15} | {model_name:<30} | {status:<12}")

    print("-" * 65)
    print(f"Total Tenant-Aware Models: {aware_count}")
    print(f"Total Tenant-Unaware Models: {unaware_count}")

if __name__ == "__main__":
    analyze_models()
