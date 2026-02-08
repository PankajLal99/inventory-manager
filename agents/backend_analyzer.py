import os
import ast
from tools.file_tools import list_files, read_file

def extract_classes(code):
    try:
        tree = ast.parse(code)
    except Exception:
        return []

    return [
        node.name
        for node in tree.body
        if isinstance(node, ast.ClassDef)
    ]

def extract_functions(code):
    try:
        tree = ast.parse(code)
    except Exception:
        return []

    return [
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
    ]

def backend_analyzer_agent(state):
    """Analyze backend structure, apps, models, views, and serializers."""
    backend = state["backend_path"]
    apps = {}
    description = {
        "core": "Authentication, user management, system settings, and audit logging",
        "catalog": "Product catalog, categories, brands, barcodes, and barcode label generation",
        "inventory": "Stock management, inventory tracking, adjustments, and transfers",
        "locations": "Store and warehouse location management",
        "parties": "Customer and supplier relationship management with ledgers",
        "purchasing": "Purchase order management and vendor tracking",
        "pricing": "Price list management and promotional pricing",
        "pos": "Point-of-sale operations, invoices, returns, and replacements",
        "reports": "Business analytics and reporting",
    }

    for file_path in list_files(backend):
        rel_path = file_path.replace(backend, "").lstrip("/")
        parts = rel_path.split("/")

        if len(parts) < 2:
            continue

        app_name = parts[0]
        filename = os.path.basename(file_path)

        if app_name.startswith("__") or "migration" in file_path:
            continue

        code = read_file(file_path, max_chars=8000)

        apps.setdefault(app_name, {
            "models": [],
            "serializers": [],
            "views": [],
            "admin": [],
            "description": description.get(app_name, "Business logic and operations"),
            "files": []
        })

        if filename == "models.py":
            apps[app_name]["models"] = extract_classes(code)
            apps[app_name]["files"].append("models.py")

        elif "serializer" in filename:
            apps[app_name]["serializers"] = extract_classes(code)
            apps[app_name]["files"].append(filename)

        elif "views" in filename:
            apps[app_name]["views"] = extract_classes(code) + extract_functions(code)
            apps[app_name]["files"].append(filename)

        elif filename == "admin.py":
            apps[app_name]["admin"] = extract_classes(code)
            apps[app_name]["files"].append("admin.py")

    return {"backend_facts": apps}
