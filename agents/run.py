from crewai import Crew
from agents import planner, backend, reviewer, backend_test_task

# Assign the agent to the task
backend_test_task.agent = backend

crew = Crew(
    agents=[planner, backend, reviewer], # Frontend agent might not be needed for this purely backend task
    tasks=[backend_test_task],
    verbose=True
)

crew.kickoff()
