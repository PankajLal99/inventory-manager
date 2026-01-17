import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const staticRoot = path.join(__dirname, "dist");

// Read API URL from environment variable or .env file
const getApiUrl = () => {
  // Priority: process.env.VITE_API_URL > .env file > default
  if (process.env.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }
  
  // Try to read from .env file
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      const match = envContent.match(/VITE_API_URL=(.+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (error) {
    console.warn("Could not read .env file:", error.message);
  }
  
  // Default fallback
  return "http://localhost:8765/api/v1";
};

const API_URL = getApiUrl();

app.use(express.static(staticRoot));

// Inject API URL into HTML as a script tag
app.get("*", (req, res) => {
  const indexPath = path.join(staticRoot, "index.html");
  
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, "utf8");
    
    // Inject API URL as a script before closing head tag
    const scriptTag = `
    <script>
      window.__ENV__ = {
        VITE_API_URL: "${API_URL}"
      };
    </script>
    `;
    
    // Insert before closing </head> tag, or at the beginning if no head tag
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${scriptTag}</head>`);
    } else {
      html = scriptTag + html;
    }
    
    res.send(html);
  } else {
    res.status(404).send("index.html not found");
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`API URL configured: ${API_URL}`);
});
