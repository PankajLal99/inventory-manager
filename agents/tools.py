from pathlib import Path
from crewai import Agent, Task, Crew, Process
from crewai.tools import tool

REPO_ROOT = Path(__file__).resolve().parents[1]

@tool("Read File")
def read_file(path: str) -> str:
    """Reads a file from the repository. Path should be relative to the repo root."""
    return (REPO_ROOT / path).read_text()

@tool("Write File")
def write_file(path: str, content: str):
    """Writes content to a file. Path should be relative to the repo root."""
    (REPO_ROOT / path).write_text(content)

@tool("List Files")
def list_files(path: str = ".") -> str:
    """Lists files and directories in a given path (relative to repo root). Useful for finding Django apps."""
    return "\n".join([str(p.relative_to(REPO_ROOT)) for p in (REPO_ROOT / path).iterdir()])

@tool("Run Tests")
def run_tests(app_name: str = "") -> str:
    """
    Runs Django tests. 
    Args:
        app_name: Optional name of the app to test (e.g. 'backend.core'). If empty, runs all tests.
    Returns:
        The output of the test command.
    """
    import subprocess
    
    # Use the specific python executable from temp_venv
    python_exec = REPO_ROOT / "temp_venv" / "bin" / "python"
    
    cmd = [str(python_exec), "manage.py", "test"]
    if app_name:
        cmd.append(app_name)
    
    # Run from REPO_ROOT where manage.py is likely located
    cwd = REPO_ROOT 
    
    if not (cwd / "manage.py").exists():
         return "Error: Could not find manage.py in root."

    try:
        result = subprocess.run(
            cmd, 
            cwd=cwd,
            capture_output=True, 
            text=True, 
            timeout=120
        )
        return f"STDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}"
    except Exception as e:
        return f"Error running tests: {str(e)}"
