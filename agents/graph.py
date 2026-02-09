from langgraph.graph import StateGraph
from typing import TypedDict, Optional, List, Any

from explorer import explorer_agent
from backend_analyzer import backend_analyzer_agent
from frontend_analyzer import frontend_analyzer_agent
from api_mapper import api_mapper_agent
from doc_writer import doc_writer_agent

class State(TypedDict, total=False):
    repo_root: str
    backend_path: str
    frontend_path: str
    backend_facts: dict
    api_facts: list
    app_endpoints: dict
    frontend_analysis: dict
    readme_written: bool
    project_name: str
    requirements: list
    frontend_deps: list


graph = StateGraph(State)

graph.add_node("explore", explorer_agent)
graph.add_node("backend", backend_analyzer_agent)
graph.add_node("frontend", frontend_analyzer_agent)
graph.add_node("map", api_mapper_agent)
graph.add_node("doc", doc_writer_agent)

graph.set_entry_point("explore")
graph.add_edge("explore", "backend")
graph.add_edge("backend", "frontend")
graph.add_edge("frontend", "map")
graph.add_edge("map", "doc")

graph.set_finish_point("doc")

app = graph.compile()
