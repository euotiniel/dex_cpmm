import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";

import { getState } from "./state.js";
import { initBlockchain, refreshAll, setTrackedTraders, setTraderMeta } from "./blockchain.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

async function bootstrap() {
  const tradersFile = process.env.TRADERS_FILE || "traders.json";
  const tradersData = JSON.parse(fs.readFileSync(tradersFile, "utf-8"));

  const traders = tradersData.traders || [];
  const traderAddresses = traders.map((t) => t.address);

  setTrackedTraders(traderAddresses);
  setTraderMeta(traders);

  await initBlockchain();
  await refreshAll();

  setInterval(async () => {
    try {
      await refreshAll();
    } catch (error) {
      console.error("Periodic refresh error:", error.message);
    }
  }, 5000);

  app.get("/state", (req, res) => {
    res.json(getState());
  });

  app.get("/ranking", (req, res) => {
    const state = getState();
    res.json(state.ranking);
  });

  const port = Number(process.env.PORT || 3001);

  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Backend startup error:", error);
  process.exit(1);
});