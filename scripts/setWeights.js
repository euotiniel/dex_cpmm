import "dotenv/config";

const args = process.argv.slice(2);

if (!args.length) {
  console.log("Use: node scripts/setWeights.js TKN1=80 TKN2=15 TKN3=5 TKN4=0 TKN5=0");
  process.exit(1);
}

const weights = {};

for (const arg of args) {
  const [symbolRaw, valueRaw] = arg.split("=");

  const symbol = String(symbolRaw || "").trim().toUpperCase();
  const value = Number(valueRaw);

  if (!symbol || !Number.isFinite(value) || value < 0) {
    console.log(`Peso inválido: ${arg}`);
    process.exit(1);
  }

  weights[symbol] = value;
}

const total = Object.values(weights).reduce((sum, value) => sum + value, 0);

if (Math.abs(total - 100) > 0.0001) {
  console.log(`A soma dos pesos deve ser 100. Soma atual: ${total}`);
  process.exit(1);
}

async function main() {
  try {
    const API_URL = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

    const res = await fetch(`${API_URL}/admin/grading-weights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ weights }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.log(data.error || "Erro ao atualizar pesos");
      process.exit(1);
    }

    console.log("Pesos atualizados on-chain:");
    console.table(data.weights);
  } catch (error) {
    console.log("Backend offline ou endpoint indisponível.");
    console.log(error.message);
    process.exit(1);
  }
}

main();