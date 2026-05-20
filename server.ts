import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";

const PROBLEMS_FILE = path.join(process.cwd(), "src", "data", "problems.json");
const SETTINGS_FILE = path.join(process.cwd(), "src", "data", "settings.json");

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Ensure data directory exists
  try {
    await fs.mkdir(path.dirname(PROBLEMS_FILE), { recursive: true });
  } catch (e) {}

  // API routes
  app.get("/api/settings", async (req, res) => {
    try {
      const data = await fs.readFile(SETTINGS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      res.json({ title: '詰将棋マスター' });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const settings = req.body;
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
      res.json({ success: true });
    } catch (e) {
      console.error("Failed to save settings:", e);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.get("/api/problems", async (req, res) => {
    try {
      const data = await fs.readFile(PROBLEMS_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      // If file doesn't exist, return empty array (client will handle default problems)
      res.json([]);
    }
  });

  app.post("/api/problems", async (req, res) => {
    try {
      const problems = req.body;
      await fs.writeFile(PROBLEMS_FILE, JSON.stringify(problems, null, 2), "utf-8");
      res.json({ success: true });
    } catch (e) {
      console.error("Failed to save problems:", e);
      res.status(500).json({ error: "Failed to save problems" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
