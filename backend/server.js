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
  setReferenceToken,
  setMarketSignal,
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
  executeSwapFor,
  getBalanceFor,
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

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 150,
});

app.use(apiLimiter);

const sseClients = new Set();

function broadcastState() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;

  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

emitter.on("changed", broadcastState);

let fairnessTimer = null;

emitter.on("changed", () => {
  clearTimeout(fairnessTimer);

  fairnessTimer = setTimeout(() => {
    const s = getState();

    if (!s.ranking?.length) return;

    setFairness(calculateFairness(s.ranking, s.trades));
  }, 1000);
});

function syncOrchestratorState() {
  setOrchestratorState(orchestrator.getStatus());
}

orchestrator.on("log", syncOrchestratorState);
orchestrator.on("stateChange", syncOrchestratorState);
orchestrator.on("botExited", syncOrchestratorState);

function safe(res, fn) {
  try {
    res.json(fn());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/* ===========================
   READ ROUTES
=========================== */

app.get("/status", (req, res) => safe(res, () => getState().status));
app.get("/state", (req, res) => safe(res, () => getState()));
app.get("/tokens", (req, res) => safe(res, () => getState().tokens));
app.get("/products", (req, res) => safe(res, () => getState().tokens));
app.get("/pools", (req, res) => safe(res, () => getState().pools));
app.get("/trades", (req, res) => safe(res, () => getState().trades));
app.get("/ranking", (req, res) => safe(res, () => getState().ranking));
app.get("/fairness", (req, res) => safe(res, () => getState().fairness));

app.get("/health", (req, res) => {
  const s = getState();

  res.json({
    ok: true,
    competition: s.status.competitionStatus,
    pools: Object.keys(s.pools).length,
    trades: s.trades.length,
    traders: s.traders.length,
    time: Date.now(),
  });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  sseClients.add(res);

  req.on("close", () => sseClients.delete(res));
});

/* ===========================
   REFERENCE TOKEN (PROFESSOR)
=========================== */

app.post("/admin/reference-token", (req, res) => {
  const { symbol } = req.body || {};
  const state = getState();

  const token = state.tokens.find((t) => t.symbol === symbol);

  if (!token) {
    return res.status(404).json({ error: "Token not found" });
  }

  setReferenceToken({
    address: token.address,
    symbol: token.symbol,
  });

  setMarketSignal({
    mode: "REFERENCE_CHANGED",
    targetToken: token.address,
    targetSymbol: token.symbol,
    message: `${token.symbol} is now reference asset`,
  });

  res.json({
    ok: true,
    referenceToken: token.symbol,
  });
});

/* ===========================
   EXTERNAL BOTS
=========================== */

const extBots = [];

app.post("/api/bots/register", (req, res) => {
  const name = String(req.body?.name || "").trim();

  if (!name) {
    return res.status(400).json({ error: "name required" });
  }

  const pk = "0x" + crypto.randomBytes(32).toString("hex");
  const address = deriveAddress(pk);
  const apiKey = crypto.randomBytes(24).toString("hex");

  const bot = {
    id: `bot-${Date.now()}`,
    name,
    pk,
    address,
    apiKey,
  };

  extBots.push(bot);

  addTrackedTrader(address, name);

  setExternalBots(
    extBots.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      status: "ACTIVE",
    }))
  );

  res.json({
    botId: bot.id,
    apiKey,
    address,
  });
});

function authBot(req, res, next) {
  const bot = extBots.find(
    (b) =>
      b.id === req.params.botId &&
      b.apiKey === req.headers["x-api-key"]
  );

  if (!bot) {
    return res.status(401).json({ error: "invalid bot" });
  }

  req.bot = bot;
  next();
}

app.post("/api/bots/:botId/swap", authBot, async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.body || {};

    const result = await executeSwapFor(
      req.bot.pk,
      tokenIn,
      tokenOut,
      amountIn
    );

    res.json({
      ok: true,
      txHash: result.txHash,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/api/bots/:botId/balance", authBot, async (req, res) => {
  try {
    const data = await getBalanceFor(req.bot.address);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===========================
   ORCHESTRATOR
=========================== */

app.get("/orchestrate/status", (req, res) =>
  safe(res, () => orchestrator.getStatus())
);

app.post("/orchestrate/full-start", (req, res) => {
  const duration = Number(req.body?.duration || 300);

  res.json({ ok: true });

  (async () => {
    try {
      await orchestrator.startNode();
      await orchestrator.deployContracts();
      await orchestrator.setupMarket();

      await reinitBlockchain();

      await orchestrator.startBots();

      resetCompetitionData();

      await startCompetitionOnChain(duration);
    } catch (e) {
      orchestrator.setState(ORCH_STATE.ERROR);
    }
  })();
});

app.post("/orchestrate/stop-app", (req, res) => {
  res.json({ ok: true });

  (async () => {
    try {
      await endCompetitionOnChain();
    } catch {}

    await orchestrator.stop();
  })();
});

app.post("/orchestrate/restart-app", (req, res) => {
  res.json({ ok: true });

  (async () => {
    try {
      await orchestrator.reset();
      shutdownBlockchain();

      await orchestrator.startNode();
      await orchestrator.deployContracts();
      await orchestrator.setupMarket();

      await reinitBlockchain();
      await orchestrator.startBots();

      resetCompetitionData();

      await startCompetitionOnChain(
        Number(req.body?.duration || 300)
      );
    } catch {
      orchestrator.setState(ORCH_STATE.ERROR);
    }
  })();
});

/* ===========================
   BOOT
=========================== */

async function bootstrap() {
  const tradersFile = process.env.TRADERS_FILE || "traders.json";
  const tradersPath = path.join(ROOT, tradersFile);

  const data = JSON.parse(fs.readFileSync(tradersPath, "utf-8"));
  const traders = data.traders || [];

  setTrackedTraders(traders.map((t) => t.address));
  setTraderMeta(traders);

  loadPersistence();

  try {
    await initBlockchain();
    await refreshAll();
  } catch {}

  setInterval(async () => {
    try {
      await refreshAll();
    } catch {}
  }, 5000);

  setInterval(savePersistence, 15000);

  const port = Number(process.env.PORT || 3001);

  app.listen(port, () => {
    console.log(`Backend running on ${port}`);
  });
}

bootstrap();