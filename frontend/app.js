const API_BASE = "http://localhost:3001";

const competitionStatusEl = document.getElementById("competition-status");
const competitionTimeEl = document.getElementById("competition-time");
const productsContainer = document.getElementById("products-container");
const tradesContainer = document.getElementById("trades-container");
const rankingBody = document.getElementById("ranking-body");

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  

  return Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function shortAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(unixSeconds) {
  if (!unixSeconds || Number(unixSeconds) === 0) return "-";

  const date = new Date(Number(unixSeconds) * 1000);
  return date.toLocaleString("pt-PT");
}

function buildTraderNameMap(ranking) {
  const map = {};

  for (const item of ranking) {
    map[item.trader.toLowerCase()] = item.name || item.trader;
  }

  return map;
}

function renderStatus(status) {
  competitionStatusEl.textContent = status.competitionStatus || "UNKNOWN";

  if (status.competitionStatus === "NOT_STARTED") {
    competitionTimeEl.textContent = "Competição ainda não iniciada.";
    return;
  }

  if (status.competitionStatus === "ACTIVE") {
    competitionTimeEl.textContent =
      `Iniciada em: ${formatTimestamp(status.competitionStartTime)}`;
    return;
  }

  if (status.competitionStatus === "ENDED") {
    competitionTimeEl.textContent =
      `Terminou em: ${formatTimestamp(status.competitionEndTime)}`;
    return;
  }

  competitionTimeEl.textContent = "Sem informação de tempo.";
}

function renderProducts(products, pools) {
  if (!products.length) {
    productsContainer.innerHTML = `<p class="empty">Nenhum produto encontrado.</p>`;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const pool = pools[product.address.toLowerCase()];

      return `
        <div class="product-item">
          <div class="product-top">
            <div>
              <div class="product-symbol">${product.symbol}</div>
              <div class="address">${product.address}</div>
            </div>
            <div class="muted">Price: ${formatNumber(pool?.spotPrice, 6)} CASH</div>
          </div>

          <div class="product-details">
            <div><strong>Reserve CASH:</strong> ${formatNumber(pool?.reserveBase, 4)}</div>
            <div><strong>Reserve ${product.symbol}:</strong> ${formatNumber(pool?.reserveProduct, 4)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTrades(trades, traderNameMap) {
  if (!trades.length) {
    tradesContainer.innerHTML = `<p class="empty">Ainda não há trades.</p>`;
    return;
  }

  tradesContainer.innerHTML = trades
    .slice(0, 12)
    .map((trade) => {
      const typeClass = trade.type === "BUY" ? "buy" : "sell";
      const traderName =
        trade.traderName ||
        traderNameMap[trade.trader.toLowerCase()] ||
        shortAddress(trade.trader);

      return `
        <div class="trade-item">
          <div class="trade-top">
            <div class="trade-type ${typeClass}">${trade.type}</div>
            <div class="muted">${new Date(trade.timestamp).toLocaleTimeString("pt-PT")}</div>
          </div>

          <div class="trade-details">
            <div><strong>Bot:</strong> ${traderName}</div>
            <div><strong>Product:</strong> ${trade.productSymbol}</div>
            <div><strong>Amount In:</strong> ${formatNumber(trade.amountIn, 6)}</div>
            <div><strong>Amount Out:</strong> ${formatNumber(trade.amountOut, 6)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRanking(ranking, competitionStatus) {
  if (!ranking.length) {
    rankingBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">Ranking ainda vazio.</td>
      </tr>
    `;
    return;
  }

  rankingBody.innerHTML = ranking
    .map((item, index) => {
      const pnlClass = item.pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const isWinner = competitionStatus === "ENDED" && index === 0;

      return `
        <tr class="${isWinner ? "final-winner" : ""}">
          <td><span class="rank-badge">${index + 1}</span></td>
          <td>
            <div>${item.name || shortAddress(item.trader)}</div>
            <div class="address">${item.trader}</div>
          </td>
          <td>${formatNumber(item.baseBalance, 4)}</td>
          <td>${formatNumber(item.totalValue, 4)}</td>
          <td class="${pnlClass}">${item.pnl >= 0 ? "+" : ""}${formatNumber(item.pnl, 4)}</td>
        </tr>
      `;
    })
    .join("");
}

async function fetchState() {
  const response = await fetch(`${API_BASE}/state`);
  if (!response.ok) throw new Error("Falha ao buscar estado do backend");

  return response.json();
}

async function refreshDashboard() {
  try {
    const state = await fetchState();
    const traderNameMap = buildTraderNameMap(state.ranking || []);

    renderStatus(state.status);
    renderProducts(state.products, state.pools);
    renderTrades(state.trades, traderNameMap);
    renderRanking(state.ranking, state.status.competitionStatus);
  } catch (error) {
    console.error(error);

    competitionStatusEl.textContent = "ERROR";
    competitionTimeEl.textContent = "Não foi possível carregar o backend.";
  }
}

refreshDashboard();
setInterval(refreshDashboard, 2000);