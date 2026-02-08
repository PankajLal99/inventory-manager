import ast
import os
import re
from tools.file_tools import list_files, read_file

def extract_urls_from_text(code):
    """Extract URL patterns from code using regex patterns."""
    urls = []
    
    # Pattern: path('some-route/', some_view, ...)
    pattern = r"path\(['\"]([^'\"]*)['\"]"
    matches = re.findall(pattern, code)
    
    for match in matches:
        urls.append({"route": match, "view": ""})
    
    return urls

def extract_urls(code):
    """Extract URL patterns from Django urls.py files."""
    try:
        tree = ast.parse(code)
    except Exception:
        return []

    paths = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and hasattr(node.func, "id"):
            if node.func.id == "path" and node.args:
                try:
                    route = ast.literal_eval(node.args[0])
                    view_name = ""
                    if len(node.args) > 1:
                        if isinstance(node.args[1], ast.Attribute):
                            view_name = node.args[1].attr
                        elif isinstance(node.args[1], ast.Name):
                            view_name = node.args[1].id
                    paths.append({"route": route, "view": view_name})
                except Exception:
                    pass

    return paths

def api_mapper_agent(state):
    """Map all API endpoints from urls.py files with detailed information."""
    backend = state["backend_path"]
    apis = []
    app_endpoints = {}

    for f in list_files(backend):
        if os.path.basename(f) == "urls.py":
            code = read_file(f, max_chars=20000)
            
            # Try AST first, then regex as fallback
            routes = extract_urls(code)
            if not routes:
                routes = extract_urls_from_text(code)
            
            parts = f.replace(backend, "").split("/")
            app_name = parts[1] if len(parts) > 1 else "unknown"

            if app_name not in app_endpoints:
                app_endpoints[app_name] = []

            for route_info in routes:
                route = route_info.get("route", "")
                view = route_info.get("view", "")
                
                endpoint = {
                    "app": app_name,
                    "path": route,
                    "view": view,
                    "file": f.replace(backend, ""),
                }
                apis.append(endpoint)
                app_endpoints[app_name].append(endpoint)

    return {
        "api_facts": apis,
        "app_endpoints": app_endpoints,
    }
