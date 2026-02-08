import os
import json

def explorer_agent(state):
    """Explorer agent discovers project structure and metadata."""
    root = state["repo_root"]

    backend = None
    frontend = None
    project_name = "MT-IMS (Inventory Management System)"
    
    # Read project files for metadata
    requirements_file = os.path.join(root, "requirements.txt")
    package_json = os.path.join(root, "frontend", "package.json")
    
    requirements = []
    if os.path.exists(requirements_file):
        try:
            with open(requirements_file, "r") as f:
                requirements = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        except:
            pass
    
    frontend_deps = []
    if os.path.exists(package_json):
        try:
            with open(package_json, "r") as f:
                data = json.load(f)
                frontend_deps = list(data.get("dependencies", {}).keys())
        except:
            pass

    for d in os.listdir(root):
        if d.lower() == "backend":
            backend = os.path.join(root, d)
        if d.lower() == "frontend":
            frontend = os.path.join(root, d)

    return {
        "backend_path": backend,
        "frontend_path": frontend,
        "project_name": project_name,
        "requirements": requirements,
        "frontend_deps": frontend_deps,
    }
