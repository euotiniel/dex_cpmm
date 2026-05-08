const API_BASE = "http://127.0.0.1:3001"; //alterar o 127.0.0.1 para o ip da maquina ou do servidor

const form = document.getElementById("weights-form");
const container = document.getElementById("weights-container");
const totalEl = document.getElementById("weights-total");
const messageEl = document.getElementById("weights-message");
const equalizeBtn = document.getElementById("btn-equalize");

let tokens = [];
let currentWeights = {};
let competitionStatus = "UNKNOWN";

function isCompetitionEnded() {
  return competitionStatus === "ENDED";
}

function setMessage(text, type = "info") {
  messageEl.textContent = text || "";
  messageEl.className = `ctrl-hint weights-message ${type}`;
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("pt-PT", {
    maximumFractionDigits: digits,
  });
}

function getFormWeights() {
  const weights = {};

  for (const token of tokens) {
    const input = document.querySelector(`[data-weight-symbol="${token.symbol}"]`);
    weights[token.symbol] = Number(input?.value || 0);
  }

  return weights;
}

function sumWeights(weights) {
  return Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
}

function updateTotal() {
  const total = sumWeights(getFormWeights());
  totalEl.textContent = `Total: ${formatNumber(total, 2)}%`;
  totalEl.className =
    Math.abs(total - 100) <= 0.0001
      ? "tag weights-total-ok"
      : "tag weights-total-error";
}

function renderForm() {
  if (!tokens.length) {
    container.innerHTML = `<p class="empty">Nenhum token encontrado.</p>`;
    return;
  }

  const disabled = isCompetitionEnded() ? "disabled" : "";

  container.innerHTML = tokens.map((token) => {
    const value = Number(currentWeights[token.symbol] ?? 0);

    return `
      <label class="weight-card ${isCompetitionEnded() ? "locked" : ""}">
        <div class="weight-token-meta">
          <strong>${token.symbol}</strong>
          <span>${token.address.slice(0, 6)}...${token.address.slice(-4)}</span>
        </div>

        <div class="weight-input-row">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value="${value}"
            data-weight-symbol="${token.symbol}"
            ${disabled}
          />
          <span>%</span>
        </div>
      </label>
    `;
  }).join("");

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", updateTotal);
  });

  equalizeBtn.disabled = isCompetitionEnded();
  form.querySelector('button[type="submit"]').disabled = isCompetitionEnded();

  if (isCompetitionEnded()) {
    setMessage("Competição terminada. Os pesos já não podem ser alterados.", "error");
  }

  updateTotal();
}

async function loadState() {
  const res = await fetch(`${API_BASE}/state`);
  const state = await res.json();

  tokens = state.tokens || [];
  currentWeights = state.gradingWeights || {};
  competitionStatus = state.status?.competitionStatus || "UNKNOWN";

  renderForm();
}

async function submitWeights(weights) {
  const res = await fetch(`${API_BASE}/admin/grading-weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Erro ao atualizar pesos");
  }

  return data;
}

equalizeBtn.addEventListener("click", () => {
  if (isCompetitionEnded()) return;
  if (!tokens.length) return;

  const equal = 100 / tokens.length;

  for (const token of tokens) {
    const input = document.querySelector(`[data-weight-symbol="${token.symbol}"]`);
    if (input) input.value = equal;
  }

  updateTotal();
  setMessage("Pesos igualados. Clique em Aplicar pesos para confirmar.");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isCompetitionEnded()) {
    setMessage("Competição terminada. Não é possível alterar os pesos.", "error");
    return;
  }

  const weights = getFormWeights();
  const total = sumWeights(weights);

  if (Math.abs(total - 100) > 0.0001) {
    setMessage(`A soma dos pesos deve ser 100%. Soma atual: ${formatNumber(total, 2)}%.`, "error");
    return;
  }

  try {
    setMessage("A atualizar pesos...");

    const data = await submitWeights(weights);

    currentWeights = data.weights || weights;
    renderForm();

    setMessage("Pesos atualizados com sucesso.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
});

loadState().catch((error) => {
  setMessage(`Erro ao carregar estado: ${error.message}`, "error");
});