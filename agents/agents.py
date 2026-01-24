from crewai import Agent, LLM

llm = LLM(
    model="ollama/deepseek-coder:6.7b",
    base_url="http://localhost:11434"
)

from agents.project_context import PROJECT_CONTEXT
from agents.tools import read_file, write_file, list_files, run_tests

common_tools = [read_file, write_file, list_files, run_tests]

def enhance_backstory(original_backstory):
    return f"{original_backstory}\n\nProject Context:\n{PROJECT_CONTEXT}\n\nCRITICAL INSTRUCTION: You are an autonomous agent. You DO NOT write plans. You DO NOT ask for permission. You EXECUTE tools immediately. If you need to see a file, call read_file. If you need to write code, call write_file. Do NOT respond with text until you have used a tool."

planner = Agent(
    role="Tech Lead",
    goal="Plan safe changes across React frontend and Django backend",
    backstory=enhance_backstory("Senior engineer focused on architecture and clarity"),
    llm=llm,
    verbose=True,
    tools=common_tools,
    allow_delegation=False
)

backend = Agent(
    role="Django Backend Engineer",
    goal="Implement APIs, models, serializers, and validations",
    backstory=enhance_backstory("Expert in Django REST Framework. You prefer action over talk. You always check files before writing code."),
    llm=llm,
    verbose=True,
    tools=common_tools,
    allow_delegation=False
)

frontend = Agent(
    role="React Frontend Engineer",
    goal="Implement React components and API integration",
    backstory=enhance_backstory("Expert in modern React patterns"),
    llm=llm,
    verbose=True,
    tools=common_tools,
    allow_delegation=False
)

reviewer = Agent(
    role="Code Reviewer",
    goal="Ensure correctness, integration, and no breaking changes",
    backstory=enhance_backstory("Strict reviewer focused on bugs and edge cases"),
    llm=llm,
    verbose=True,
    tools=common_tools,
    allow_delegation=False
)
