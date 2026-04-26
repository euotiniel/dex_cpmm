const API_BASE = "http://localhost:3001";

const competitionStatusEl = document.getElementById("competition-status");
const competitionTimeEl = document.getElementById("competition-time");
const timeLabelEl = document.getElementById("time-label");

const productsContainer = document.getElementById("products-container");
const tradesContainer = document.getElementById("trades-container");
const rankingBody = document.getElementById("ranking-body");

const totalTradesEl = document.getElementById("total-trades");
const activeBotsEl = document.getElementById("active-bots");
const totalMarketsEl = document.getElementById("total-markets");
const totalVolumeEl = document.getElementById("total-volume");

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function shortAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0));

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);

  return [hours, minutes, secs]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");
}

function formatTradeTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function buildTraderNameMap(ranking) {
  const map = {};

  for (const item of ranking || []) {
    if (item.trader) {
      map[item.trader.toLowerCase()] = item.name || item.trader;
    }
  }

  return map;
}

function renderStatus(status = {}) {
  const currentStatus = status.competitionStatus || "UNKNOWN";
  const livePill = document.querySelector(".live-pill");

  livePill.classList.remove("active", "ended", "pending", "error");

  const now = Math.floor(Date.now() / 1000);
  const start = Number(status.competitionStartTime || 0);
  const end = Number(status.competitionEndTime || 0);

  if (currentStatus === "ACTIVE") {
    livePill.classList.add("active");
    competitionStatusEl.textContent = "LIVE";

    if (end > now) {
      timeLabelEl.textContent = "Ends in";
      competitionTimeEl.textContent = formatDuration(end - now);
    } else {
      timeLabelEl.textContent = "Running";
      competitionTimeEl.textContent = "--:--:--";
    }

    return;
  }

  if (currentStatus === "ENDED") {
    livePill.classList.add("ended");
    competitionStatusEl.textContent = "ENDED";
    timeLabelEl.textContent = "Finished";
    competitionTimeEl.textContent = "00:00:00";
    return;
  }

  if (currentStatus === "NOT_STARTED") {
    livePill.classList.add("pending");
    competitionStatusEl.textContent = "PENDING";

    if (start > now) {
      timeLabelEl.textContent = "Starts in";
      competitionTimeEl.textContent = formatDuration(start - now);
    } else {
      timeLabelEl.textContent = "Waiting";
      competitionTimeEl.textContent = "--:--:--";
    }

    return;
  }

  livePill.classList.add("error");
  competitionStatusEl.textContent = "UNKNOWN";
  timeLabelEl.textContent = "Status";
  competitionTimeEl.textContent = "--:--:--";
}

function renderStats(state) {
  const trades = state.trades || [];
  const ranking = state.ranking || [];
  const products = state.products || [];

  totalTradesEl.textContent = trades.length;
  activeBotsEl.textContent = ranking.length;
  totalMarketsEl.textContent = products.length;

  const totalVolume = trades.reduce((sum, trade) => {
    if (trade.type === "BUY") return sum + Number(trade.amountIn || 0);
    if (trade.type === "SELL") return sum + Number(trade.amountOut || 0);
    return sum;
  }, 0);

  totalVolumeEl.textContent = `${formatNumber(totalVolume, 2)} CASH`;
}

function renderProducts(products = [], pools = {}) {
  if (!products.length) {
    productsContainer.innerHTML = `<p class="empty">Nenhum mercado encontrado.</p>`;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const symbol = product.symbol || "TOKEN";
      const pool = pools[product.address?.toLowerCase()] || {};

      const reserveBase = Number(pool.reserveBase || 0);
      const liquidity = reserveBase * 2;

      return `
        <article class="market-card">
          <div class="market-pair">
            <strong>${symbol}/CASH</strong>
          </div>

          <div class="market-data">
            <div class="market-line">
              <span>Price</span>
              <strong>${formatNumber(pool.spotPrice, 5)}</strong>
            </div>

            <div class="market-line">
              <span>Liquidity</span>
              <strong>${formatNumber(liquidity, 2)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTrades(trades = [], traderNameMap = {}) {
  if (!trades.length) {
    tradesContainer.innerHTML = `<p class="empty">Ainda não há trades.</p>`;
    return;
  }

  tradesContainer.innerHTML = trades
    .slice(0, 14)
    .map((trade) => {
      const type = trade.type || "-";
      const typeClass = type === "BUY" ? "buy" : "sell";

      const traderName =
        trade.traderName ||
        traderNameMap[trade.trader?.toLowerCase()] ||
        shortAddress(trade.trader);

      const amountIn = formatNumber(trade.amountIn, 4);
      const amountOut = formatNumber(trade.amountOut, 4);
      const product = trade.productSymbol || "PROD";

      const flow =
        type === "BUY"
          ? `${amountIn} CASH → ${amountOut} ${product}`
          : `${amountIn} ${product} → ${amountOut} CASH`;

      return `
        <article class="trade-card">
          <div class="trade-main">
            <div class="trade-left">
              <span class="trade-side ${typeClass}">${type}</span>
              <span class="trade-bot">${traderName}</span>
            </div>

            <span class="trade-time">${formatTradeTime(trade.timestamp)}</span>
          </div>

          <div class="trade-flow">${flow}</div>
        </article>
      `;
    })
    .join("");
}

function renderRanking(ranking = [], competitionStatus) {
  if (!ranking.length) {
    rankingBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty">Ranking ainda vazio.</td>
      </tr>
    `;
    return;
  }

  const sortedRanking = [...ranking].sort(
    (a, b) => Number(b.pnl || 0) - Number(a.pnl || 0)
  );

  rankingBody.innerHTML = sortedRanking
    .map((item, index) => {
      const pnl = Number(item.pnl || 0);
      const pnlClass = pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const isWinner = competitionStatus === "ENDED" && index === 0;

      return `
        <tr class="${isWinner ? "final-winner" : ""}">
          <td><span class="rank">${index + 1}</span></td>

          <td>
            <span class="bot-name">${item.name || shortAddress(item.trader)}</span>
            <span class="address">${shortAddress(item.trader)}</span>
          </td>

          <td>${formatNumber(item.totalValue, 4)}</td>

          <td class="${pnlClass}">
            ${pnl >= 0 ? "+" : ""}${formatNumber(pnl, 4)}
          </td>
        </tr>
      `;
    })
    .join("");
}

async function fetchState() {
  const response = await fetch(`${API_BASE}/state`);

  if (!response.ok) {
    throw new Error("Falha ao buscar estado do backend");
  }

  return response.json();
}

async function refreshDashboard() {
  try {
    const state = await fetchState();

    const products = state.products || [];
    const pools = state.pools || {};
    const trades = state.trades || [];
    const ranking = state.ranking || [];
    const status = state.status || {};

    const traderNameMap = buildTraderNameMap(ranking);

    renderStatus(status);
    renderStats(state);
    renderProducts(products, pools);
    renderTrades(trades, traderNameMap);
    renderRanking(ranking, status.competitionStatus);
  } catch (error) {
    console.error(error);

    competitionStatusEl.textContent = "ERROR";
    timeLabelEl.textContent = "Backend";
    competitionTimeEl.textContent = "Offline";
  }
}

refreshDashboard();
setInterval(refreshDashboard, 1000);
