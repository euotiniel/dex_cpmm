import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import XLSX from "xlsx";


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
  setGradingWeightsOnChain,
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


/**
Criar rota para chaves
 */

const workbook = XLSX.readFile("PlanilhaChaves.xlsx");

const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

const dados = XLSX.utils.sheet_to_json(sheet);


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

app.post("/export/xlsx", (req, res) => {
  try {
    const ranking = req.body?.ranking;

    if (!Array.isArray(ranking)) {
      return res.status(400).json({ error: "ranking inválido" });
    }

    // 1. Limpar e normalizar dados
    const cleaned = ranking.map((row) => {
  const botRaw = row.bot || "";

  // 1. Remove tudo depois do \n (wallet)
  const firstLine = botRaw.split("\n")[0] || "";

  // 2. Extrai nome e ID dentro de (...)
  const match = firstLine.match(/^(.*)\((\d+)\)$/);

  const botName = match ? match[1].trim() : firstLine.trim();
  const botId = match ? match[2] : "";

  return {
    Rank: row.rank,
    ID: botId,
    Nome: botName,
    Nota: row.nota,

    TKN1: row.tkn1?.replace(/\n/g, " "),
    TKN2: row.tkn2?.replace(/\n/g, " "),
    TKN3: row.tkn3?.replace(/\n/g, " "),
    TKN4: row.tkn4?.replace(/\n/g, " "),
    TKN5: row.tkn5?.replace(/\n/g, " "),

    Score: row.score,
    PnL: row.pnl,
    Ops: row.ops,
  };
});

    // 2. Criar worksheet
    const worksheet = XLSX.utils.json_to_sheet(cleaned);

    // 3. Criar workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ranking");

    // 4. Converter para buffer
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // 5. Enviar ficheiro
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ranking.xlsx"'
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao gerar XLSX" });
  }
});

app.get("/botkeys/:id", (req, res) => {

    const id = parseInt(req.params.id);

    const resultado = dados.find(item => item.ID === id);

    if (!resultado) {
        return res.status(404).json({
            erro: "ID não encontrado"
        });
    }

    res.json(resultado);
});


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
   GRADING WEIGHTS (ON-CHAIN)
=========================== */

app.get("/admin/grading-weights", (req, res) => {
  const state = getState();

  res.json({
    ok: true,
    weights: state.gradingWeights,
  });
});

app.post("/admin/grading-weights", async (req, res) => {
  try {
    const { weights } = req.body || {};
    const state = getState();

    if (state.status?.competitionStatus === "ENDED") {
      return res.status(403).json({
        error: "Competition ended. Weights can no longer be changed.",
      });
    }

    if (!weights || typeof weights !== "object") {
      return res.status(400).json({
        error: "weights object required",
      });
    }

    const validSymbols = state.tokens.map((token) => token.symbol);
    const normalizedWeights = {};

    for (const symbol of validSymbols) {
      const value = Number(weights[symbol] ?? 0);

      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({
          error: `Invalid weight for ${symbol}`,
        });
      }

      normalizedWeights[symbol] = value;
    }

    const total = Object.values(normalizedWeights).reduce(
      (sum, value) => sum + value,
      0
    );

    if (Math.abs(total - 100) > 0.0001) {
      return res.status(400).json({
        error: `Weights must sum 100. Current sum: ${total}`,
      });
    }

    const onChainWeights = await setGradingWeightsOnChain(normalizedWeights);
    await refreshAll();

    res.json({
      ok: true,
      weights: onChainWeights,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
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