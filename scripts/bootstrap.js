import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { promisify } from "util";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const TRADERS_PATH = path.join(ROOT, "traders.json");

// ─── Bots estáticos (mantidos como antes) ────────────────────────────────────
const STATIC_BOT_KEYS = [
  "BOT_NOISE_PK",
  "BOT_SHOCK_PK",
  "BOT_TREND_PK",
  "BOT_MEAN_REVERSION_PK",
  // "BOT_OTONIEL_33039_PK",
  //adiciona o nome aqui com underline
];

const STATIC_BOT_NAMES = [
  "Bot de Ruído",
  "Bot de Choque",
  "Bot de Tendência",
  "Bot de Reversão à Média",
  // "Otoniel Emanuel (33039)",
  //adiciona o nome aqui com espaço
];

// ─── Carrega bots dinâmicos do Excel ─────────────────────────────────────────
// Formato esperado: colunas ID | Nome | CHAVE_PK
async function loadBotsFromExcel(xlsxPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const sheet = workbook.worksheets[0];
  const dynamicBots = [];

  // Linha 1 é cabeçalho, começa da linha 2
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // pula cabeçalho

    const id   = String(row.getCell(1).value ?? "").trim();
    const nome = String(row.getCell(2).value ?? "").trim();

    if (!id || !nome) return;

    // Normaliza o nome: remove acentos, espaços → underline, maiúsculas
    const nomeNormalizado = nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .toUpperCase();

    dynamicBots.push({
      key: `BOT_${nomeNormalizado}_${id}`,   // ex: BOT_VALENTIM_33031
      name: `${nome} (${id})`,               // ex: Valentim (33031)
      rowNumber,
    });
  });

  return { workbook, sheet, dynamicBots };
}

// ─── Escreve as PKs geradas de volta na coluna CHAVE_PK do Excel ──────────────
async function writeKeysToExcel(xlsxPath, workbook, sheet, dynamicBots, generatedKeys) {
  dynamicBots.forEach((bot, index) => {
    const pk = generatedKeys[index];
    if (pk) {
      sheet.getRow(bot.rowNumber).getCell(3).value = pk; // coluna C = CHAVE_PK
    }
  });

  await workbook.xlsx.writeFile(xlsxPath);
  console.log("Excel atualizado com as PKs geradas:", xlsxPath);
}

// ─── Monta arrays finais: estáticos + dinâmicos ───────────────────────────────
function buildBotArrays(dynamicBots) {
  const BOT_KEYS  = [...STATIC_BOT_KEYS,  ...dynamicBots.map(b => b.key)];
  const BOT_NAMES = [...STATIC_BOT_NAMES, ...dynamicBots.map(b => b.name)];
  return { BOT_KEYS, BOT_NAMES };
}

// ─── Utilitários de .env ──────────────────────────────────────────────────────
function parseEnv(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function buildEnv(env) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

function writeEnv(newValues) {
  let env = {};
  if (fs.existsSync(ENV_PATH)) {
    env = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
  }
  env = { ...env, ...newValues };
  fs.writeFileSync(ENV_PATH, buildEnv(env), "utf-8");
}

function writeTradersJson(addresses, BOT_NAMES) {
  const payload = {
    traders: addresses.map((address, index) => ({
      address,
      name: BOT_NAMES[index] || `Bot ${index + 1}`,
    })),
  };
  fs.writeFileSync(TRADERS_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

// ─── Hardhat node ─────────────────────────────────────────────────────────────
function startHardhatNode() {
  return new Promise((resolve, reject) => {
    const child = spawn("yarn", ["hhnode"], {
      cwd: ROOT,
      shell: true,
    });

    let stdoutBuffer = "";
    let resolved = false;

    const accounts = [];
    const privateKeys = [];

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;

      const accountRegex = /Account #\d+:\s+(0x[a-fA-F0-9]{40})/g;
      const pkRegex      = /Private Key:\s+(0x[a-fA-F0-9]{64})/g;

      let match;
      while ((match = accountRegex.exec(stdoutBuffer)) !== null) {
        const address = match[1].toLowerCase();
        if (!accounts.includes(address)) accounts.push(address);
      }
      while ((match = pkRegex.exec(stdoutBuffer)) !== null) {
        const privateKey = match[1].toLowerCase();
        if (!privateKeys.includes(privateKey)) privateKeys.push(privateKey);
      }

      const totalBots = STATIC_BOT_KEYS.length; // mínimo garantido antes do Excel carregar
      const needed = Math.max(9, totalBots + 2);

      if (
        !resolved &&
        stdoutBuffer.includes("Started HTTP and WebSocket JSON-RPC server") &&
        accounts.length >= needed &&
        privateKeys.length >= needed
      ) {
        resolved = true;
        resolve({ child, accounts, privateKeys });
      }
    });

    child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!resolved) reject(new Error(`hardhat node exited early with code ${code}`));
    });
  });
}

// ─── Deploy ───────────────────────────────────────────────────────────────────
function runDeploy() {
  return new Promise((resolve, reject) => {
    const child = spawn("yarn", ["deploy:local"], {
      cwd: ROOT,
      shell: true,
    });

    let stdoutBuffer = "";
    const result = {};

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;

      const patterns = {
        EXCHANGE_ADDRESS: /EXCHANGE:\s+(0x[a-fA-F0-9]{40})/,
        TKN1_ADDRESS:     /TKN1:\s+(0x[a-fA-F0-9]{40})/,
        TKN2_ADDRESS:     /TKN2:\s+(0x[a-fA-F0-9]{40})/,
        TKN3_ADDRESS:     /TKN3:\s+(0x[a-fA-F0-9]{40})/,
        TKN4_ADDRESS:     /TKN4:\s+(0x[a-fA-F0-9]{40})/,
        TKN5_ADDRESS:     /TKN5:\s+(0x[a-fA-F0-9]{40})/,
      };

      for (const [key, regex] of Object.entries(patterns)) {
        const match = stdoutBuffer.match(regex);
        if (match) result[key] = match[1].toLowerCase();
      }
    });

    child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`deploy failed with code ${code}`));
        return;
      }
      resolve(result);
    });
  });
}

const unlink = promisify(fs.unlink);

async function deleteFile(filePath) {
  await unlink(filePath);
  console.log("Arquivo apagado com sucesso");
}

const filePath = path.resolve("data", "state.json");

deleteFile(filePath)
  .catch((err) => {
    console.error("Erro ao apagar state.json:", err.message);
  });

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Caminho para o Excel — pode ser passado como argumento ou usa o padrão
  const xlsxPath = process.argv[2] ?? path.join(ROOT, "PlanilhaChaves.xlsx");

  if (!fs.existsSync(xlsxPath)) {
    console.error(`Arquivo Excel não encontrado: ${xlsxPath}`);
    process.exit(1);
  }

  

  console.log("=================================");
  console.log("Carregando bots do Excel:", xlsxPath);
  const { workbook, sheet, dynamicBots } = await loadBotsFromExcel(xlsxPath);
  const { BOT_KEYS, BOT_NAMES } = buildBotArrays(dynamicBots);
  const numBots = BOT_KEYS.length;

  console.log(`Bots estáticos : ${STATIC_BOT_KEYS.length}`);
  console.log(`Bots do Excel  : ${dynamicBots.length}`);
  console.log(`Total de bots  : ${numBots}`);
  console.log("=================================");

  console.log("Starting local bootstrap...");
  console.log("=================================");

  const { child: hhnode, accounts, privateKeys } = await startHardhatNode();

  console.log("=================================");
  console.log("Hardhat node detected.");
  console.log("Accounts found:", accounts.length);
  console.log("Private keys found:", privateKeys.length);
  console.log("=================================");

  const deployed = await runDeploy();

  const botAddresses   = accounts.slice(1, numBots + 1);
  const botPrivateKeys = privateKeys.slice(1, numBots + 1);

  const envValues = {
    // Valor inicial usado no ranking.
    // Cada bot começa com 1000 unidades de cada um dos 5 tokens.
    // Como a referência inicial é TKN1, o valor estimado inicial é:
    // 1000 TKN1 + 1000 TKN2 + 1000 TKN3 + 1000 TKN4 + 1000 TKN5 ~= 5000 TKN1
    INITIAL_REFERENCE_VALUE: "5000",
    REFERENCE_TOKEN_SYMBOL: "TKN1",
    TRADERS_FILE: "traders.json",
    PORT: "3001",
    ...deployed,
  };

  // Grava todas as PKs (estáticas + dinâmicas) no .env
  for (let i = 0; i < BOT_KEYS.length; i++) {
    envValues[BOT_KEYS[i]] = botPrivateKeys[i];
  }

  writeEnv(envValues);
  writeTradersJson(botAddresses, BOT_NAMES);

  // ── Grava as PKs dos bots dinâmicos de volta no Excel ──
  const dynamicPKs = botPrivateKeys.slice(STATIC_BOT_KEYS.length);
  await writeKeysToExcel(xlsxPath, workbook, sheet, dynamicBots, dynamicPKs);

  console.log("=================================");
  console.log(".env updated from real hhnode + deploy output.");
  console.log("traders.json updated from real hhnode output.");
  console.log("");
  console.log("Admin account  :", accounts[0]);
  console.log("Bot traders    :", botAddresses);
  console.log("Contracts      :", deployed);
  console.log("");
  console.log("Bots no .env:");
  BOT_KEYS.forEach((key, i) => console.log(`  ${key} → ${botAddresses[i]}`));
  console.log("");
  console.log("Hardhat node is still running.");
  console.log("Leave this terminal open.");
  console.log("=================================");

  process.on("SIGINT", () => {
    console.log("\nStopping hardhat node...");
    hhnode.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Bootstrap error:");
  console.error(error);
  process.exit(1);
});