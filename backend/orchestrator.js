/**
 * Orchestrator — manages the full lifecycle of the simulation:
 *   Hardhat node → Contract deployment → Market setup → Bots → Competition
 *
 * Only the Node.js backend process needs to be started manually.
 * Everything else is driven from this module via dashboard API calls.
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
const ENV_PATH  = path.join(ROOT, ".env");
const IS_WIN    = process.platform === "win32";

// ── States ────────────────────────────────────────────────────────────────────

export const ORCH_STATE = Object.freeze({
  IDLE:          "IDLE",
  STARTING_NODE: "STARTING_NODE",
  DEPLOYING:     "DEPLOYING",
  SETTING_UP:    "SETTING_UP",
  STARTING_BOTS: "STARTING_BOTS",
  RUNNING:       "RUNNING",
  STOPPING:      "STOPPING",
  ERROR:         "ERROR",
});

// ── Bot registry — all 8 bots including arbitrageBot (was missing from run_all_bots.py)
const BOT_CONFIGS = [
  { module: "bots.causes.noiseBot",  name: "Bot de Ruído" },
  { module: "bots.causes.shockBot",  name: "Bot de Choque" },
  { module: "bots.causes.trendBot",  name: "Bot de Tendência" },
  { module: "bots.conservativeBot",  name: "Bot Conservador" },
  { module: "bots.momentumBot",      name: "Bot de Momentum" },
  { module: "bots.meanReversionBot", name: "Bot de Reversão à Média" },
  { module: "bots.marketMakerBot",   name: "Bot Market Maker" },
  { module: "bots.arbitrageBot",     name: "Bot de Arbitragem" },
];

// ── Orchestrator class ────────────────────────────────────────────────────────

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.state    = ORCH_STATE.IDLE;
    this.logs     = [];
    this.hhNode   = null;
    this.bots     = [];    // { name, module, process, alive, exitCode, pid }
    this.deployed = false; // have contracts been deployed in this session?
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  log(message, level = "INFO") {
    const entry = { t: Date.now(), level, message: String(message).trim() };
    if (!entry.message) return;

    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs = this.logs.slice(-800);
    this.emit("log", entry);
    console.log(`[Orch:${level}] ${entry.message}`);
  }

  // ── State machine ─────────────────────────────────────────────────────────

  setState(s) {
    this.state = s;
    this.emit("stateChange", s);
    this.log(`State → ${s}`);
  }

  // ── Status snapshot (sent to dashboard) ──────────────────────────────────

  getStatus() {
    return {
      state:       this.state,
      nodeRunning: Boolean(this.hhNode && !this.hhNode.killed),
      bots:        this.bots.map(({ name, module, alive, exitCode, pid }) => ({
        name,
        module,
        alive,
        exitCode: exitCode ?? null,
        pid:      pid ?? null,
      })),
      deployed:  this.deployed,
      recentLogs: this.logs.slice(-150),
    };
  }

  // ── .env reload into process.env ─────────────────────────────────────────
  // Called after deploy.js writes new contract addresses to .env

  reloadEnv() {
    try {
      if (!existsSync(ENV_PATH)) return;
      const content = readFileSync(ENV_PATH, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim();
        process.env[k] = v;
      }
      this.log("Reloaded .env — new contract addresses in process.env");
    } catch (e) {
      this.log(`Failed to reload .env: ${e.message}`, "WARN");
    }
  }

  // ── Detect if the RPC node is already responding ──────────────────────────

  async isNodeRunning() {
    // Lazy import to avoid circular deps — ethers is always available
    const { ethers } = await import("ethers");
    try {
      const p = new ethers.JsonRpcProvider(
        process.env.RPC_URL || "http://127.0.0.1:8545"
      );
      await p.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  // ── Spawn helper (respects Windows shell requirement) ─────────────────────

  _spawn(cmd, args, extraEnv = {}) {
    return spawn(cmd, args, {
      cwd:   ROOT,
      shell: IS_WIN,
      env:   { ...process.env, ...extraEnv },
    });
  }

  // ── Run a hardhat script and stream its output to the log ─────────────────

  _runHardhatScript(scriptRelPath, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      this.log(`Running: npx hardhat run ${scriptRelPath} --network localhost`);

      const proc = this._spawn(
        "npx",
        ["hardhat", "run", scriptRelPath, "--network", "localhost"],
        extraEnv
      );

      let stdout = "";

      proc.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        for (const line of text.split("\n")) {
          const l = line.trim();
          if (l) this.log(l, "SCRIPT");
        }
      });

      proc.stderr.on("data", (d) => {
        const text = d.toString();
        for (const line of text.split("\n")) {
          const l = line.trim();
          // Hardhat emits compilation info on stderr — treat it as INFO not ERROR
          if (l) this.log(l, l.toLowerCase().includes("error") ? "ERROR" : "WARN");
        }
      });

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Script ${scriptRelPath} exited with code ${code}`));
      });

      proc.on("error", reject);
    });
  }

  // ── 1. Start Hardhat Node ─────────────────────────────────────────────────

  async startNode() {
    // If node is already responding, skip startup
    if (await this.isNodeRunning()) {
      this.log("Hardhat node already responding on port 8545 — reusing");
      return;
    }

    this.setState(ORCH_STATE.STARTING_NODE);
    this.log("Starting Hardhat node (npx hardhat node)...");

    return new Promise((resolve, reject) => {
      // Give up after 30 s — Hardhat is usually ready in < 5 s
      const timer = setTimeout(() => {
        this.log("Hardhat node startup timeout — proceeding anyway", "WARN");
        resolve();
      }, 30_000);

      this.hhNode = this._spawn("npx", ["hardhat", "node"]);

      this.hhNode.stdout.on("data", (d) => {
        const text = d.toString();
        for (const line of text.split("\n")) {
          const l = line.trim();
          if (l) this.log(l, "NODE");
        }
        // Hardhat prints this line when the node is ready
        if (
          text.includes("Started HTTP and WebSocket JSON-RPC server") ||
          text.includes("Listening on")
        ) {
          clearTimeout(timer);
          this.log("Hardhat node ready on http://127.0.0.1:8545");
          resolve();
        }
      });

      this.hhNode.stderr.on("data", (d) => {
        const text = d.toString();
        for (const line of text.split("\n")) {
          const l = line.trim();
          if (l) this.log(l, "NODE");
        }
      });

      this.hhNode.on("error", (err) => {
        clearTimeout(timer);
        this.log(`Hardhat node spawn error: ${err.message}`, "ERROR");
        reject(err);
      });

      this.hhNode.on("close", (code) => {
        clearTimeout(timer);
        this.hhNode = null;
        this.log(
          `Hardhat node exited (code=${code})`,
          code === 0 ? "INFO" : "WARN"
        );
      });
    });
  }

  // ── 2. Deploy contracts ───────────────────────────────────────────────────

  async deployContracts() {
    this.setState(ORCH_STATE.DEPLOYING);
    this.log("Deploying smart contracts...");
    await this._runHardhatScript("scripts/deploy.js");
    this.reloadEnv();
    this.deployed = true;
    this.log("Contracts deployed — .env updated with new addresses");
  }

  // ── 3. Setup pools & register traders ────────────────────────────────────

  async setupMarket() {
    this.setState(ORCH_STATE.SETTING_UP);
    this.log("Creating pools and registering traders...");
    await this._runHardhatScript("scripts/setup.js");
    this.log("Market setup complete");
  }

  // ── 4. Launch all 8 Python bots ──────────────────────────────────────────

  async startBots() {
    const alive = this.bots.filter((b) => b.alive);
    if (alive.length > 0) {
      this.log(`${alive.length} bots already running — skipping relaunch`, "WARN");
      return;
    }

    this.setState(ORCH_STATE.STARTING_BOTS);
    this.log(`Launching ${BOT_CONFIGS.length} bots...`);
    this.bots = [];

    for (const cfg of BOT_CONFIGS) {
      const proc = this._spawn("python", ["-m", cfg.module]);

      const entry = {
        name:    cfg.name,
        module:  cfg.module,
        process: proc,
        alive:   true,
        exitCode: null,
        pid:     proc.pid ?? null,
      };

      proc.stdout.on("data", (d) => {
        const text = d.toString().trim();
        if (text) this.log(`[${cfg.name}] ${text}`, "BOT");
      });

      proc.stderr.on("data", (d) => {
        const text = d.toString().trim();
        if (text) this.log(`[${cfg.name}] ${text}`, "WARN");
      });

      proc.on("close", (code) => {
        entry.alive    = false;
        entry.exitCode = code;
        this.emit("botExited", cfg.name, code);
        this.log(
          `[${cfg.name}] process exited (code=${code})`,
          code === 0 ? "INFO" : "WARN"
        );
      });

      proc.on("error", (err) => {
        entry.alive = false;
        this.log(`[${cfg.name}] spawn error: ${err.message}`, "ERROR");
      });

      this.bots.push(entry);
      this.log(`Launched: ${cfg.name}`);

      // Stagger launches by 250 ms to avoid a burst of RPC calls at t=0
      await new Promise((r) => setTimeout(r, 250));
    }

    this.log("All bots launched");
    this.setState(ORCH_STATE.RUNNING);
  }

  // ── Stop bots ─────────────────────────────────────────────────────────────

  stopBots() {
    const running = this.bots.filter((b) => b.alive);
    if (!running.length) {
      this.log("No bots running");
      return;
    }

    this.log(`Sending SIGTERM to ${running.length} bots...`);
    for (const b of running) {
      try { b.process.kill("SIGTERM"); } catch {}
    }

    // Force-kill stragglers after 2 s
    setTimeout(() => {
      for (const b of this.bots) {
        if (b.alive) {
          try { b.process.kill("SIGKILL"); } catch {}
        }
      }
    }, 2000);
  }

  // ── Stop everything (graceful) ────────────────────────────────────────────

  async stop() {
    if (this.state === ORCH_STATE.IDLE) return;
    this.setState(ORCH_STATE.STOPPING);
    this.stopBots();
    await new Promise((r) => setTimeout(r, 500));
    this.setState(ORCH_STATE.IDLE);
    this.log("System stopped");
  }

  // ── Full reset — kill node + bots, clear state ────────────────────────────

  async reset() {
    this.log("Resetting system...");
    this.stopBots();

    if (this.hhNode && !this.hhNode.killed) {
      try { this.hhNode.kill("SIGTERM"); } catch {}
      this.hhNode = null;
    }

    await new Promise((r) => setTimeout(r, 500));

    this.bots     = [];
    this.deployed = false;
    this.logs     = [];
    this.setState(ORCH_STATE.IDLE);
    this.log("System reset complete — ready for a fresh start");
  }

  // ── Cleanup hook — kill children when backend process exits ──────────────

  registerShutdownHook() {
    const cleanup = () => {
      for (const b of this.bots) {
        try { b.process.kill(); } catch {}
      }
      if (this.hhNode) try { this.hhNode.kill(); } catch {}
    };
    process.on("exit",   cleanup);
    process.on("SIGINT",  () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  }
}

export const orchestrator = new Orchestrator();
orchestrator.registerShutdownHook();
