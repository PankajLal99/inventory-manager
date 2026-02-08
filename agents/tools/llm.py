from langchain_ollama import OllamaLLM

# Global, shared LLM instance
# Keep temperature = 0 to reduce hallucinations
llm = OllamaLLM(
    model="deepseek-coder:6.7b",
    base_url="http://localhost:11434",
    temperature=0,
)

def explain(prompt: str) -> str:
    """
    Wrapper to call Ollama safely.
    The LLM is ONLY used for explanation, never for discovery.
    """
    return llm.invoke(prompt)
