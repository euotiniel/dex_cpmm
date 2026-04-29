import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

import {
  emitter,
  getState,
  loadPersistence,
  savePersistence,
  setOrchestratorState,
  setFairness,
  setExternalBots,
  resetCompetitionData,
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
  deriveAddress,
  addTrackedTrader,
  executeBuyFor,
  executeSellFor,
  getBalanceFor,
} from "./blockchain.js";

import { orchestrator, ORCH_STATE } from "./orchestrator.js";
import { calculateFairness } from "./fairness.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── External bot registry ─────────────────────────────────────────────────────
// Slots are loaded from EXT_BOT_0_PK … EXT_BOT_N_PK in .env.
// Students call POST /api/bots/register to claim a free slot and receive an
// API key. The server then executes on-chain transactions on their behalf.
// Internal bots are completely unaffected — they run as separate Python processes
// spawned by the orchestrator. This API layer is purely additive.

const _extBotSlots = [];

function _initExtBotSlots() {
  for (let i = 0; i < 20; i++) {
    const pk = process.env[`EXT_BOT_${i}_PK`];
    if (!pk) break;
    _extBotSlots.push({
      id:           `ext-bot-${i}`,
      pk,
      address:      deriveAddress(pk),
      name:         null,
      apiKey:       null,
      registered:   false,
      registeredAt: null,
    });
  }
  console.log(`[ExtBots] ${_extBotSlots.length} slot(s) available`);
}

function _syncExternalBots() {
  setExternalBots(
    _extBotSlots
      .filter((s) => s.registered)
      .map(({ id, address, name, registeredAt }) => ({
        id,
        type: "EXTERNAL",
        name,
        address,
        registeredAt,
        status: "ACTIVE",
      }))
  );
}

function _authExtBot(req, res, next) {
  const slot = _extBotSlots.find(
    (s) => s.id === req.params.botId && s.registered && s.apiKey === req.headers["x-api-key"]
  );
  if (!slot) return res.status(401).json({ error: "Invalid bot ID or API key" });
  req.extBot = slot;
  next();
}

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

app.get("/system", (req, res) => {
  res.sendFile(path.join(ROOT, "frontend", "system.html"));
});

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

// ── External bot API ──────────────────────────────────────────────────────────
// This layer handles HTTP trade requests from external bots (students).
// It is COMPLETELY SEPARATE from internal bots, which run as Python child
// processes spawned by the orchestrator. Adding or removing external bots
// has zero effect on the internal bot execution loop.

const extBotLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many external bot requests." },
});
app.use("/api", extBotLimiter);

// GET /api/bots — unified registry (internal + external)
app.get("/api/bots", (req, res) => {
  const s = getState();
  const internal = (s.orchestrator.bots || []).map((b) => ({
    type:   "INTERNAL",
    name:   b.name,
    module: b.module,
    status: b.alive ? "ALIVE" : "DEAD",
    pid:    b.pid   ?? null,
  }));
  const external = s.externalBots || [];
  res.json({ internal, external, total: internal.length + external.length });
});

// POST /api/bots/register — claim a free slot
// Body: { name: "MyBot" }
// Response: { botId, apiKey, address, message }
app.post("/api/bots/register", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  if (name.length > 64) return res.status(400).json({ error: "name too long (max 64)" });

  const slot = _extBotSlots.find((s) => !s.registered);
  if (!slot) return res.status(503).json({ error: "No free slots — all external bot slots are taken" });

  slot.name         = name;
  slot.apiKey       = crypto.randomBytes(24).toString("hex");
  slot.registered   = true;
  slot.registeredAt = Date.now();

  _syncExternalBots();
  addTrackedTrader(slot.address, name);

  console.log(`[ExtBots] Registered "${name}" → ${slot.id} (${slot.address})`);
  res.json({
    botId:   slot.id,
    apiKey:  slot.apiKey,
    address: slot.address,
    message: `Slot ${slot.id} assigned. Include X-API-Key: <apiKey> in all trade requests.`,
  });
});

// POST /api/bots/:botId/buy — execute a buy on-chain
// Headers: X-API-Key
// Body: { productAddress, amountCash }
app.post("/api/bots/:botId/buy", _authExtBot, async (req, res) => {
  const { productAddress, amountCash } = req.body || {};
  if (!productAddress) return res.status(400).json({ error: "productAddress required" });

  const amount = Number(amountCash);
  if (!amountCash || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "amountCash must be a positive number" });
  }

  try {
    console.log(`[ExtBots] BUY request | bot=${req.extBot.name} | product=${productAddress} | cash=${amount}`);
    const result = await executeBuyFor(req.extBot.pk, productAddress, amount);
    res.json({ success: true, txHash: result.txHash });
  } catch (err) {
    console.error(`[ExtBots] BUY error | bot=${req.extBot.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bots/:botId/sell — execute a sell on-chain
// Headers: X-API-Key
// Body: { productAddress, amountProduct }
app.post("/api/bots/:botId/sell", _authExtBot, async (req, res) => {
  const { productAddress, amountProduct } = req.body || {};
  if (!productAddress) return res.status(400).json({ error: "productAddress required" });

  const amount = Number(amountProduct);
  if (!amountProduct || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "amountProduct must be a positive number" });
  }

  try {
    console.log(`[ExtBots] SELL request | bot=${req.extBot.name} | product=${productAddress} | amount=${amount}`);
    const result = await executeSellFor(req.extBot.pk, productAddress, amount);
    res.json({ success: true, txHash: result.txHash });
  } catch (err) {
    console.error(`[ExtBots] SELL error | bot=${req.extBot.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bots/:botId/balance — cash + product balances
// Headers: X-API-Key
app.get("/api/bots/:botId/balance", _authExtBot, async (req, res) => {
  try {
    const balance = await getBalanceFor(req.extBot.address);
    res.json(balance);
  } catch (err) {
    console.error(`[ExtBots] balance error | bot=${req.extBot.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pools — list active pools (convenience alias; no auth needed)
app.get("/api/pools", (req, res) => safeJson(res, () => getState().pools));

// GET /api/products — list products (convenience alias; no auth needed)
app.get("/api/products", (req, res) => safeJson(res, () => getState().products));

// GET /api/status — competition status (convenience alias)
app.get("/api/status", (req, res) => safeJson(res, () => getState().status));

// ── Orchestrator routes ───────────────────────────────────────────────────────

app.get("/orchestrate/status", (req, res) => {
  safeJson(res, () => orchestrator.getStatus());
});

// Full pipeline: node → deploy → setup → reinit → bots → competition start
app.post("/orchestrate/full-start", (req, res) => {
  const validStates = [ORCH_STATE.IDLE, ORCH_STATE.STOPPED];
  if (!validStates.includes(orchestrator.state)) {
    return res.status(409).json({
      error: `System must be IDLE or STOPPED (current: ${orchestrator.state})`,
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

      resetCompetitionData();

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

// Stop application: end competition + stop bots → STOPPED
app.post("/orchestrate/stop-app", (req, res) => {
  const validStates = [ORCH_STATE.RUNNING, ORCH_STATE.ERROR];
  if (!validStates.includes(orchestrator.state)) {
    return res.status(409).json({ error: `Cannot stop from state: ${orchestrator.state}` });
  }
  res.json({ ok: true, message: "Stopping application…" });

  (async () => {
    try {
      orchestrator.setState(ORCH_STATE.STOPPING);

      const compStatus = getState().status.competitionStatus;
      if (compStatus === "ACTIVE") {
        try {
          await endCompetitionOnChain();
          orchestrator.log("Competition ended on-chain");
        } catch (e) {
          orchestrator.log(`End competition: ${e.message}`, "WARN");
        }
      }

      orchestrator.stopBots();
      await new Promise((r) => setTimeout(r, 1500));
      orchestrator.setState(ORCH_STATE.STOPPED);
      orchestrator.log("Application stopped — click Start Application to resume");
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Stop error: ${err.message}`, "ERROR");
      orchestrator.setState(ORCH_STATE.ERROR);
      syncOrchestratorState();
    }
  })();
});

// Restart bots only — starts a new competition (contract now allows restart from ENDED)
app.post("/orchestrate/restart-bots", (req, res) => {
  const validStates = [ORCH_STATE.RUNNING, ORCH_STATE.ERROR, ORCH_STATE.STOPPED];
  if (!validStates.includes(orchestrator.state)) {
    return res.status(400).json({ error: `Cannot restart bots from state: ${orchestrator.state}` });
  }
  const duration = Math.max(30, Math.min(7200,
    Number((req.body || {}).duration || 300)));
  res.json({ ok: true, message: "Restarting bots…" });

  (async () => {
    try {
      orchestrator.stopBots();
      await new Promise((r) => setTimeout(r, 2500));
      orchestrator.bots = [];

      // End any running competition so we can start a fresh one
      try {
  await endCompetitionOnChain();
  orchestrator.log("Previous competition ended");
} catch (e) {
  orchestrator.log(`End competition skipped: ${e.message}`, "WARN");
}

      // Start fresh competition (contract now allows this from ENDED state too)
      try {
          resetCompetitionData();

        await startCompetitionOnChain(duration);
        orchestrator.log(`New competition started (${duration}s)`);
      } catch (e) {
        orchestrator.log(`Competition start: ${e.message}`, "WARN");
      }

      await orchestrator.startBots();
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Restart bots error: ${err.message}`, "ERROR");
      orchestrator.setState(ORCH_STATE.ERROR);
      syncOrchestratorState();
    }
  })();
});

// Restart application: full redeploy → fresh pools → reinit → bots → competition
// This is a hard reset — traders get fresh 1000 CASH, pools start clean.
app.post("/orchestrate/restart-app", (req, res) => {
  const validStates = [ORCH_STATE.RUNNING, ORCH_STATE.STOPPED, ORCH_STATE.ERROR];
  if (!validStates.includes(orchestrator.state)) {
    return res.status(409).json({ error: `Cannot restart from state: ${orchestrator.state}` });
  }
  const duration = Math.max(30, Math.min(7200,
    Number((req.body || {}).duration || 300)));
  res.json({ ok: true, message: "Restarting application (full redeploy)…" });

  (async () => {
    try {
      // Stop phase — kill bots first, then end competition if needed
      orchestrator.setState(ORCH_STATE.STOPPING);
      orchestrator.stopBots();
      await new Promise((r) => setTimeout(r, 2000));

      const compStatus = getState().status.competitionStatus;
      if (compStatus === "ACTIVE") {
        try {
          await endCompetitionOnChain();
          orchestrator.log("Competition ended");
        } catch (e) {
          orchestrator.log(`End competition: ${e.message}`, "WARN");
        }
      }
      orchestrator.log("Bots stopped — redeploying contracts for clean state…");

      // Full redeploy gives fresh token addresses, clean pools, reset balances
      await orchestrator.deployContracts();
      syncOrchestratorState();

      await orchestrator.setupMarket();
      syncOrchestratorState();

      await reinitBlockchain();
      orchestrator.log("Blockchain reinitialized with new contract addresses");
      syncOrchestratorState();

      // Clear dead bot records and relaunch
      orchestrator.bots = [];
      await orchestrator.startBots();
      syncOrchestratorState();

      resetCompetitionData();

      await startCompetitionOnChain(duration);
      orchestrator.log(`New competition started (${duration}s)`);
      syncOrchestratorState();
    } catch (err) {
      orchestrator.log(`Restart error: ${err.message}`, "ERROR");
      orchestrator.setState(ORCH_STATE.ERROR);
      syncOrchestratorState();
    }
  })();
});

// Full reset — kills node + bots, wipes all state → IDLE
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
  // Must run before any route handler is invoked so slots are ready.
  _initExtBotSlots();

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
