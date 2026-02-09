import os

def list_files(base_path):
    collected = []
    for root, _, files in os.walk(base_path):
        for f in files:
            if f.endswith((".py", ".js", ".ts", ".tsx", ".json")):
                collected.append(os.path.join(root, f))
    return collected

def read_file(path, max_chars=4000):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()[:max_chars]
    except Exception:
        return ""
