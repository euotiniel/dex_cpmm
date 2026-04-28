import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

import {
  emitter,
  getState,
  loadPersistence,
  savePersistence,
} from "./state.js";
import {
  initBlockchain,
  refreshAll,
  setTrackedTraders,
  setTraderMeta,
} from "./blockchain.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(ROOT, "frontend")));

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

// ── SSE clients ───────────────────────────────────────────────────────────────
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

// Debounce: batch rapid state changes (e.g. addTrade + upsertPool firing together)
// into a single broadcast 50 ms later.
let _broadcastTimer = null;
function scheduleBroadcast() {
  clearTimeout(_broadcastTimer);
  _broadcastTimer = setTimeout(broadcastState, 50);
}

emitter.on("changed", scheduleBroadcast);

// ── Routes ────────────────────────────────────────────────────────────────────
function safeJson(res, getter) {
  try {
    res.json(getter());
  } catch (err) {
    console.error("Route error:", err.message);
    res.status(500).json({ error: "Internal error" });
  }
}

app.get("/status", (req, res) => safeJson(res, () => getState().status));
app.get("/products", (req, res) => safeJson(res, () => getState().products));
app.get("/pools", (req, res) => safeJson(res, () => getState().pools));
app.get("/trades", (req, res) => safeJson(res, () => getState().trades));
app.get("/ranking", (req, res) => safeJson(res, () => getState().ranking));
app.get("/state", (req, res) => safeJson(res, () => getState()));

app.get("/health", (req, res) => {
  const s = getState();
  res.json({
    status: "ok",
    competition: s.status.competitionStatus,
    traders: s.traders.length,
    pools: Object.keys(s.pools).length,
    trades: s.trades.length,
    sseClients: sseClients.size,
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
  });
});

// SSE — real-time push to frontend
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  const tradersFile = process.env.TRADERS_FILE || "traders.json";
  const tradersPath = path.isAbsolute(tradersFile)
    ? tradersFile
    : path.join(ROOT, tradersFile);
  const tradersData = JSON.parse(fs.readFileSync(tradersPath, "utf-8"));

  const traders = tradersData.traders || [];
  const traderAddresses = traders.map((t) =>
    typeof t === "string" ? t : t.address
  );

  setTrackedTraders(traderAddresses);
  setTraderMeta(
    traders.map((t) =>
      typeof t === "string" ? { address: t, name: t } : t
    )
  );

  // Restore persisted trade history before connecting to blockchain
  loadPersistence();

  await initBlockchain();
  await refreshAll();

  // Periodic blockchain refresh every 5 seconds (events are primary source)
  setInterval(async () => {
    try {
      await refreshAll();
    } catch (error) {
      console.error("Periodic refresh error:", error.message);
    }
  }, 5000);

  // Periodic persistence save every 15 seconds
  setInterval(savePersistence, 15_000);

  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, () => {
    console.log("=================================");
    console.log(`Backend:   http://localhost:${port}`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`SSE:       http://localhost:${port}/events`);
    console.log(`Health:    http://localhost:${port}/health`);
    console.log("=================================");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[ERRO] A porta ${port} já está em uso.`);
      console.error(
        `       Windows PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`
      );
      console.error(
        `       Git Bash / Unix:    kill $(lsof -ti:${port})\n`
      );
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
