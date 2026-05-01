import fs from "fs";
import path from "path";

const symbol = process.argv[2]?.toUpperCase();

const ALLOWED = ["TKN1", "TKN2", "TKN3", "TKN4", "TKN5"];

if (!symbol) {
  console.log("Use: yarn ref TKN4");
  process.exit(1);
}

if (!ALLOWED.includes(symbol)) {
  console.log(`Token inválido: ${symbol}`);
  console.log(`Permitidos: ${ALLOWED.join(", ")}`);
  process.exit(1);
}

async function tryLiveUpdate() {
  try {
    const res = await fetch("http://localhost:3001/admin/reference-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol }),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json();

    console.log(`Reference token alterado ao vivo para ${data.referenceToken}`);
    return true;
  } catch {
    return false;
  }
}

function updateEnvFile() {
  const envPath = path.resolve(".env");

  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  }

  if (content.match(/^REFERENCE_TOKEN_SYMBOL=.*/m)) {
    content = content.replace(
      /^REFERENCE_TOKEN_SYMBOL=.*/m,
      `REFERENCE_TOKEN_SYMBOL=${symbol}`
    );
  } else {
    if (content.length && !content.endsWith("\n")) {
      content += "\n";
    }

    content += `REFERENCE_TOKEN_SYMBOL=${symbol}\n`;
  }

  fs.writeFileSync(envPath, content);
}

(async () => {
  const updatedLive = await tryLiveUpdate();

  updateEnvFile();

  if (!updatedLive) {
    console.log(`Reference token gravado em .env: ${symbol}`);
    console.log("Backend offline ou sem endpoint live.");
    console.log("Reinicia o backend para aplicar.");
  }
})();