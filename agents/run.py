from graph import app
import os

result = app.invoke({
    "repo_root": os.path.abspath("..")
})

print("README generated:", result.get("readme_written"))
