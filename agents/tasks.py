from crewai import Task

backend_test_task = Task(
    description="""
    GOAL: You need to discover the backend apps.
    
    ACTION REQUIRED NOW:
    1. Call the tool `List Files` with arguments `{"path": "backend"}`.
    2. Read the output.
    3. Then STOP.
    
    Do NOT plan. Do NOT explain. Do NOT ask.
    JUST CALL THE TOOL.
    
    After you have successfully listed the files, we will worry about tests.
    For now, PROVE you can use the tool.
    """,
    expected_output="A list of files in the backend directory."
)
