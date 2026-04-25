import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

import { emitter, getState } from "./state.js";
import { initBlockchain, refreshAll, setTrackedTraders, setTraderMeta } from "./blockchain.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend as static files at /
app.use(express.static(path.join(ROOT, "frontend")));

// Rate limiter: max 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});
app.use("/status", limiter);
app.use("/products", limiter);
app.use("/pools", limiter);
app.use("/trades", limiter);
app.use("/ranking", limiter);
app.use("/state", limiter);

// ── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastState() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Broadcast whenever state changes
emitter.on("changed", broadcastState);

// ── Routes ───────────────────────────────────────────────────────────────────
function safeJson(res, getter) {
  try {
    res.json(getter());
  } catch (err) {
    console.error("Route error:", err.message);
    res.status(500).json({ error: "Internal error" });
  }
}

app.get("/status",   (req, res) => safeJson(res, () => getState().status));
app.get("/products", (req, res) => safeJson(res, () => getState().products));
app.get("/pools",    (req, res) => safeJson(res, () => getState().pools));
app.get("/trades",   (req, res) => safeJson(res, () => getState().trades));
app.get("/ranking",  (req, res) => safeJson(res, () => getState().ranking));
app.get("/state",    (req, res) => safeJson(res, () => getState()));

// SSE endpoint — real-time push to frontend
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  sseClients.add(res);

  // Remove client when connection closes
  req.on("close", () => {
    sseClients.delete(res);
  });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  const tradersFile = process.env.TRADERS_FILE || "traders.json";
  const tradersPath = path.isAbsolute(tradersFile) ? tradersFile : path.join(ROOT, tradersFile);
  const tradersData = JSON.parse(fs.readFileSync(tradersPath, "utf-8"));

  const traders = tradersData.traders || [];
  const traderAddresses = traders.map((t) => (typeof t === "string" ? t : t.address));

  setTrackedTraders(traderAddresses);
  setTraderMeta(
    traders.map((t) =>
      typeof t === "string" ? { address: t, name: t } : t
    )
  );

  await initBlockchain();
  await refreshAll();

  // Periodic fallback refresh every 5 seconds (events are primary source of truth)
  setInterval(async () => {
    try {
      await refreshAll();
    } catch (error) {
      console.error("Periodic refresh error:", error.message);
    }
  }, 5000);

  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, () => {
    console.log("=================================");
    console.log(`Backend:   http://localhost:${port}`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`SSE:       http://localhost:${port}/events`);
    console.log("=================================");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[ERRO] A porta ${port} já está em uso.`);
      console.error(`       Mata o processo antigo com:`);
      console.error(`       Windows PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
      console.error(`       Git Bash / Unix:    kill $(lsof -ti:${port})\n`);
    } else {
      console.error("Server error:", err.message);
    }
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  console.error("Backend startup error:", error);
  process.exit(1);
});
