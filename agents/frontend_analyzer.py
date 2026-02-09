import re
from tools.file_tools import list_files, read_file

def frontend_analyzer_agent(state):
    """Analyze frontend structure, components, and API integrations."""
    frontend = state["frontend_path"]
    if not frontend:
        return {"frontend_analysis": {"components": [], "api_usage": [], "frameworks": []}}
    
    analysis = {
        "components": [],
        "api_usage": [],
        "frameworks": [],
        "files_analyzed": 0
    }
    
    typescript_files = []
    for f in list_files(frontend):
        if f.endswith((".ts", ".tsx")):
            typescript_files.append(f)
            analysis["files_analyzed"] += 1
    
    # Detect frameworks from package.json deps passed in state
    if state.get("frontend_deps"):
        deps = state.get("frontend_deps", [])
        if "react" in deps:
            analysis["frameworks"].append("React")
        if "redux" in deps:
            analysis["frameworks"].append("Redux")
        if "vite" in deps:
            analysis["frameworks"].append("Vite")
        if "tailwindcss" in deps:
            analysis["frameworks"].append("Tailwind CSS")

    return {"frontend_analysis": analysis}
