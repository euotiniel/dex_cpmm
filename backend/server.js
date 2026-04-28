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
  setOrchestratorState,
  setFairness,
} from "./state.js";

import {
  initBlockchain,
  refreshAll,
  reinitBlockchain,
  shutdownBlockchain,
  setTrackedTraders,
  setTraderMeta,
  startCompetitionOnChain,
  endCompetitionOnChain,
} from "./blockchain.js";

import { orchestrator, ORCH_STATE } from "./orchestrator.js";
import { calculateFairness } from "./fairness.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(ROOT, "frontend")));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

const orchLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orchestration requests." },
});

app.use("/status", apiLimiter);
app.use("/state",  apiLimiter);
app.use("/events", apiLimiter);
app.use("/orchestrate", orchLimiter);

// ── SSE broadcast ─────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastState() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

let _broadcastTimer = null;
function scheduleBroadcast() {
  clearTimeout(_broadcastTimer);
  _broadcastTimer = setTimeout(broadcastState, 50);
}
emitter.on("changed", scheduleBroadcast);

// ── Fairness recompute (1 s debounce after any state change) ──────────────────
let _fairnessTimer = null;
emitter.on("changed", () => {
  clearTimeout(_fairnessTimer);
  _fairnessTimer = setTimeout(() => {
    const s = getState();
    if (s.ranking.length > 0) setFairness(calculateFairness(s.ranking, s.trades));
  }, 1000);
});

// ── Orchestrator → SSE sync ───────────────────────────────────────────────────
function syncOrchestratorState() {
  setOrchestratorState(orchestrator.getStatus());
}

orchestrator.on("log",       () => syncOrchestratorState());
orchestrator.on("stateChange", () => syncOrchestratorState());
orchestrator.on("botExited", () => syncOrchestratorState());

// ── Routes ────────────────────────────────────────────────────────────────────
function safeJson(res, getter) {
  try { res.json(getter()); }
  catch (err) {
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

app.get("/fairness", (req, res) => {
  const s = getState();
  safeJson(res, () => calculateFairness(s.ranking, s.trades));
});

app.get("/health", (req, res) => {
  const s = getState();
  res.json({
    status:        "ok",
    competition:   s.status.competitionStatus,
    orchState:     s.orchestrator.state,
    traders:       s.traders.length,
    pools:         Object.keys(s.pools).length,
    trades:        s.trades.length,
    sseClients:    sseClients.size,
    uptime:        Math.floor(process.uptime()),
    timestamp:     Date.now(),
  });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(getState())}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ── Orchestrator routes ───────────────────────────────────────────────────────

app.get("/orchestrate/status", (req, res) => {
  safeJson(res, () => orchestrator.getStatus());
});

// Full pipeline: node → deploy → setup → reinit → bots → competition start
app.post("/orchestrate/full-start", (req, res) => {
  if (orchestrator.state !== ORCH_STATE.IDLE) {
    return res.status(409).json({
      error: `System not idle (state: ${orchestrator.state})`,
    });
  }
  const duration = Math.max(30, Math.min(7200,
    Number((req.body || {}).duration || 300)));

  res.json({ ok: true, message: `Starting full pipeline (${duration}s)…` });

  (async () => {
    try {
      await orchestrator.startNode();
      syncOrchestratorState();

      await orchestrator.deployContracts();
      syncOrchestratorState();

      await orchestrator.setupMarket();
      syncOrchestratorState();

      await reinitBlockchain();
      orchestrator.log("Blockchain reinitialized with new contract addresses");
      syncOrchestratorState();

      await orchestrator.startBots();
      syncOrchestratorState();

      await startCompetitionOnChain(duration);
      orchestrator.log(`Competition started — ${duration}s duration`);
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Pipeline error: ${err.message}`, "ERROR");
      orchestrator.setState(ORCH_STATE.ERROR);
      syncOrchestratorState();
    }
  })();
});

// End competition on-chain only (bots keep running)
app.post("/orchestrate/stop-competition", async (req, res) => {
  try {
    await endCompetitionOnChain();
    res.json({ ok: true, message: "Competition ended" });
    syncOrchestratorState();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart bots (kill existing, wait 2.5 s, relaunch)
app.post("/orchestrate/restart-bots", (req, res) => {
  if (orchestrator.state === ORCH_STATE.IDLE) {
    return res.status(400).json({ error: "System is idle — start it first" });
  }
  res.json({ ok: true, message: "Restarting bots…" });

  (async () => {
    try {
      orchestrator.stopBots();
      await new Promise((r) => setTimeout(r, 2500));
      orchestrator.bots = [];
      await orchestrator.startBots();
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Restart bots error: ${err.message}`, "ERROR");
      syncOrchestratorState();
    }
  })();
});

// Full reset — kills node + bots, wipes blockchain connection
app.post("/orchestrate/reset", (req, res) => {
  res.json({ ok: true, message: "Resetting system…" });

  (async () => {
    try {
      await orchestrator.reset();
      shutdownBlockchain();
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Reset error: ${err.message}`, "ERROR");
      syncOrchestratorState();
    }
  })();
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

  loadPersistence();

  // Try to connect to the blockchain; if it fails, the user can start the
  // system via the dashboard Control Panel — no crash on startup.
  try {
    await initBlockchain();
    await refreshAll();
  } catch (err) {
    console.warn("[startup] Blockchain not ready:", err.message);
    console.warn("[startup] Use the dashboard Control Panel to start the system.");
  }

  // Periodic blockchain refresh every 5 s (events are the primary update path)
  setInterval(async () => {
    try { await refreshAll(); } catch {}
  }, 5000);

  setInterval(savePersistence, 15_000);

  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, () => {
    console.log("==============================================");
    console.log(`  Backend  → http://localhost:${port}`);
    console.log(`  Dashboard→ http://localhost:${port}`);
    console.log(`  Health   → http://localhost:${port}/health`);
    console.log("==============================================");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[ERRO] Port ${port} is already in use.`);
      console.error(
        `  PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`
      );
    } else {
      console.error("Server error:", err.message);
    }
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error("Backend startup error:", err);
  process.exit(1);
});
