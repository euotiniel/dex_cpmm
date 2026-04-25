// ── Config ────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:3001";

// ── DOM refs ──────────────────────────────────────────────────────────────
const statusPill    = document.getElementById("status-pill");
const statusDot     = document.getElementById("status-dot");
const statusText    = document.getElementById("status-text");
const timerValue    = document.getElementById("timer-value");
const connIndicator = document.getElementById("conn-indicator");

const statTrades  = document.getElementById("stat-trades");
const statBots    = document.getElementById("stat-bots");
const statMarkets = document.getElementById("stat-markets");
const statVolume  = document.getElementById("stat-volume");

const gainersList = document.getElementById("gainers-list");
const losersList  = document.getElementById("losers-list");
const marketTbody = document.getElementById("market-tbody");
const chartsGrid  = document.getElementById("charts-grid");
const tradesFeed  = document.getElementById("trades-feed");
const leaderTbody = document.getElementById("leader-tbody");

// ── State ─────────────────────────────────────────────────────────────────
const charts = {};      // { [productAddress]: Chart instance }
let timerInterval = null;
let lastState = null;

// ── Formatting ────────────────────────────────────────────────────────────
function fmt(value, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const v = Number(value);
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function shortAddr(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("pt-PT");
}

// ── Timer countdown ───────────────────────────────────────────────────────
function startTimer(endTimeSeconds) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = endTimeSeconds - Math.floor(Date.now() / 1000);
    if (remaining <= 0) {
      timerValue.textContent = "00:00";
      clearInterval(timerInterval);
      return;
    }
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    timerValue.textContent = `${m}:${s}`;
  }, 500);
}

// ── Status bar ────────────────────────────────────────────────────────────
function renderStatus(status) {
  const s = status.competitionStatus || "UNKNOWN";
  statusText.textContent = s;

  statusDot.className = "status-dot";
  if (s === "ACTIVE")       statusDot.classList.add("active");
  else if (s === "ENDED")   statusDot.classList.add("ended");
  else                      statusDot.classList.add("waiting");

  if (s === "ACTIVE" && status.competitionEndTime) {
    startTimer(status.competitionEndTime);
  } else if (s !== "ACTIVE") {
    if (timerInterval) clearInterval(timerInterval);
    timerValue.textContent = s === "ENDED" ? "00:00" : "--:--";
  }
}

// ── Stat cards ────────────────────────────────────────────────────────────
function renderStats(state) {
  statTrades.textContent  = state.trades?.length ?? 0;
  statBots.textContent    = state.traders?.length ?? 0;
  statMarkets.textContent = state.products?.length ?? 0;

  // Total volume across all products
  const totalVol = Object.values(state.volume || {}).reduce((a, b) => a + b, 0);
  statVolume.textContent = fmt(totalVol, 2);
}

// ── Gainers / Losers ──────────────────────────────────────────────────────
function getPriceChange(state, productAddress) {
  const key = productAddress.toLowerCase();
  const initial = state.initialPrices?.[key];
  const current = state.pools?.[key]?.spotPrice;
  if (!initial || !current || initial === 0) return null;
  return ((current - initial) / initial) * 100;
}

function renderMovers(state) {
  const products = state.products || [];
  if (!products.length) {
    gainersList.innerHTML = `<div class="mover-placeholder">Sem dados.</div>`;
    losersList.innerHTML  = `<div class="mover-placeholder">Sem dados.</div>`;
    return;
  }

  const withChange = products.map((p) => ({
    symbol: p.symbol,
    address: p.address,
    price: state.pools?.[p.address.toLowerCase()]?.spotPrice,
    change: getPriceChange(state, p.address),
  })).filter((p) => p.change !== null);

  const sorted = [...withChange].sort((a, b) => b.change - a.change);
  const gainers = sorted.filter((p) => p.change >= 0).slice(0, 3);
  const losers  = [...sorted].reverse().filter((p) => p.change < 0).slice(0, 3);

  function moverRow(p, cls) {
    return `
      <div class="mover-row">
        <div class="mover-left">
          <span class="mover-symbol">${p.symbol}</span>
          <span class="mover-price">${fmt(p.price, 4)} CASH</span>
        </div>
        <span class="mover-change ${cls}">${fmtPct(p.change)}</span>
      </div>`;
  }

  gainersList.innerHTML = gainers.length
    ? gainers.map((p) => moverRow(p, "up")).join("")
    : `<div class="mover-placeholder">Sem altas.</div>`;

  losersList.innerHTML = losers.length
    ? losers.map((p) => moverRow(p, "down")).join("")
    : `<div class="mover-placeholder">Sem baixas.</div>`;
}

// ── Market Overview Table ─────────────────────────────────────────────────
function renderMarketTable(state) {
  const products = state.products || [];
  if (!products.length) {
    marketTbody.innerHTML = `<tr><td colspan="6" class="empty-row">Sem produtos.</td></tr>`;
    return;
  }

  marketTbody.innerHTML = products.map((p) => {
    const key    = p.address.toLowerCase();
    const pool   = state.pools?.[key] || {};
    const change = getPriceChange(state, p.address);
    const vol    = state.volume?.[key] || 0;

    let changeHtml = `<span class="change-flat">—</span>`;
    if (change !== null) {
      const cls = change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat";
      changeHtml = `<span class="${cls}">${fmtPct(change)}</span>`;
    }

    return `
      <tr>
        <td><span class="token-name">${p.symbol}</span></td>
        <td class="num">${fmt(pool.spotPrice, 6)}</td>
        <td class="num">${changeHtml}</td>
        <td class="num">${fmt(pool.reserveBase, 2)}</td>
        <td class="num">${fmt(pool.reserveProduct, 2)}</td>
        <td class="num">${fmt(vol, 2)}</td>
      </tr>`;
  }).join("");
}

// ── Price Charts ──────────────────────────────────────────────────────────
function getChartColor(state, productAddress) {
  const change = getPriceChange(state, productAddress);
  if (change === null) return { line: "#58a6ff", fill: "rgba(88,166,255,0.10)" };
  if (change >= 0) return { line: "#3fb950", fill: "rgba(63,185,80,0.10)" };
  return { line: "#f85149", fill: "rgba(248,81,73,0.10)" };
}

function initCharts(state) {
  chartsGrid.innerHTML = "";
  const products = state.products || [];

  products.forEach((p) => {
    const key = p.address.toLowerCase();
    const color = getChartColor(state, p.address);
    const change = getPriceChange(state, p.address);

    const card = document.createElement("div");
    card.className = "chart-card";
    card.id = `chart-card-${key}`;
    card.innerHTML = `
      <div class="chart-header">
        <span class="chart-symbol">${p.symbol}</span>
        <div class="chart-meta">
          <span class="chart-price" id="chart-price-${key}">— CASH</span>
          <span class="chart-change ${change >= 0 ? "change-up" : "change-down"}" id="chart-change-${key}">—</span>
        </div>
      </div>
      <div class="chart-canvas-wrap">
        <canvas id="chart-${key}"></canvas>
      </div>`;
    chartsGrid.appendChild(card);

    const history = state.priceHistory?.[key] || [];
    const labels = history.map((h) => fmtTime(h.t));
    const data   = history.map((h) => h.p);

    const ctx = document.getElementById(`chart-${key}`).getContext("2d");
    charts[key] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: color.line,
          backgroundColor: color.fill,
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toFixed(4)} CASH`,
          },
        }},
        scales: {
          x: { display: false },
          y: {
            display: true,
            position: "right",
            ticks: {
              color: "#7d8590",
              font: { family: "'JetBrains Mono'", size: 9 },
              maxTicksLimit: 4,
              callback: (v) => v.toFixed(2),
            },
            grid: { color: "#21262d" },
            border: { display: false },
          },
        },
      },
    });
  });
}

function updateCharts(state) {
  const products = state.products || [];
  products.forEach((p) => {
    const key   = state.products.find((x) => x.address === p.address)?.address?.toLowerCase() || p.address.toLowerCase();
    const chart = charts[key];
    if (!chart) return;

    const history = state.priceHistory?.[key] || [];
    const labels  = history.map((h) => fmtTime(h.t));
    const data    = history.map((h) => h.p);

    chart.data.labels = labels;
    chart.data.datasets[0].data = data;

    // Update color based on price direction
    const color = getChartColor(state, p.address);
    chart.data.datasets[0].borderColor      = color.line;
    chart.data.datasets[0].backgroundColor  = color.fill;
    chart.update("none");

    // Update header
    const priceEl  = document.getElementById(`chart-price-${key}`);
    const changeEl = document.getElementById(`chart-change-${key}`);
    const pool = state.pools?.[key];
    const change = getPriceChange(state, p.address);

    if (priceEl)  priceEl.textContent  = pool ? `${fmt(pool.spotPrice, 4)} CASH` : "—";
    if (changeEl) {
      changeEl.textContent = change !== null ? fmtPct(change) : "—";
      changeEl.className   = `chart-change ${change >= 0 ? "change-up" : "change-down"}`;
    }
  });
}

// ── Live Trades Feed ──────────────────────────────────────────────────────
const MAX_FEED_ROWS = 50;
let renderedTradeTimestamps = new Set();

function renderTrades(state) {
  const trades = state.trades || [];
  if (!trades.length) {
    tradesFeed.innerHTML = `<div class="feed-empty">Aguardando trades...</div>`;
    return;
  }

  // Find new trades not yet shown
  const newTrades = trades
    .slice(0, MAX_FEED_ROWS)
    .filter((t) => !renderedTradeTimestamps.has(`${t.timestamp}-${t.trader}`));

  if (!newTrades.length) return;

  // Remove empty placeholder if present
  const placeholder = tradesFeed.querySelector(".feed-empty");
  if (placeholder) placeholder.remove();

  // Prepend new rows
  newTrades.forEach((trade) => {
    renderedTradeTimestamps.add(`${trade.timestamp}-${trade.trader}`);

    const row = document.createElement("div");
    row.className = "feed-row";
    const typeClass = trade.type === "BUY" ? "buy" : "sell";
    const amountStr = trade.type === "BUY"
      ? `${fmt(trade.amountIn, 2)} CASH`
      : `${fmt(trade.amountIn, 4)} ${trade.productSymbol}`;

    row.innerHTML = `
      <span class="feed-time">${fmtTime(trade.timestamp)}</span>
      <span class="feed-type ${typeClass}">${trade.type}</span>
      <span class="feed-bot">${trade.traderName || shortAddr(trade.trader)}</span>
      <span class="feed-token">${trade.productSymbol || "—"}</span>
      <span class="feed-amount">${amountStr}</span>`;

    tradesFeed.insertBefore(row, tradesFeed.firstChild);
  });

  // Trim old rows beyond limit
  while (tradesFeed.children.length > MAX_FEED_ROWS) {
    tradesFeed.removeChild(tradesFeed.lastChild);
  }

  // Prune timestamp set size
  if (renderedTradeTimestamps.size > 300) {
    renderedTradeTimestamps = new Set([...renderedTradeTimestamps].slice(-200));
  }
}

// ── Leaderboard ───────────────────────────────────────────────────────────
function renderLeaderboard(state) {
  const ranking = state.ranking || [];
  const isEnded = state.status?.competitionStatus === "ENDED";

  if (!ranking.length) {
    leaderTbody.innerHTML = `<tr><td colspan="5" class="empty-row">Sem ranking.</td></tr>`;
    return;
  }

  leaderTbody.innerHTML = ranking.map((item, i) => {
    const pnlClass = item.pnl > 0 ? "pnl-pos" : item.pnl < 0 ? "pnl-neg" : "pnl-flat";
    const rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";
    const isWinner = isEnded && i === 0;

    return `
      <tr class="${isWinner ? "winner-row" : ""}">
        <td><span class="rank-badge ${rankClass}">${i + 1}</span></td>
        <td>
          <div class="trader-name">${item.name || shortAddr(item.trader)}</div>
          <div class="trader-addr">${shortAddr(item.trader)}</div>
        </td>
        <td class="num">${fmt(item.baseBalance, 2)}</td>
        <td class="num">${fmt(item.totalValue, 2)}</td>
        <td class="num ${pnlClass}">${item.pnl >= 0 ? "+" : ""}${fmt(item.pnl, 2)}</td>
      </tr>`;
  }).join("");
}

// ── Main render ───────────────────────────────────────────────────────────
let chartsInitialized = false;

function render(state) {
  lastState = state;

  renderStatus(state.status || {});
  renderStats(state);
  renderMovers(state);
  renderMarketTable(state);
  renderTrades(state);
  renderLeaderboard(state);

  if (!chartsInitialized && state.products?.length) {
    initCharts(state);
    chartsInitialized = true;
  } else if (chartsInitialized) {
    updateCharts(state);
  }
}

// ── SSE Connection ────────────────────────────────────────────────────────
function setConnStatus(connected) {
  connIndicator.className = `conn-indicator ${connected ? "connected" : "disconnected"}`;
}

function connectSSE() {
  setConnStatus(false);
  const es = new EventSource(`${API_BASE}/events`);

  es.onopen = () => setConnStatus(true);

  es.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      render(state);
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  };

  es.onerror = () => {
    setConnStatus(false);
    es.close();
    // Reconnect after 3 seconds
    setTimeout(connectSSE, 3000);
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
// Fetch initial state immediately, then open SSE
fetch(`${API_BASE}/state`)
  .then((r) => r.json())
  .then((state) => render(state))
  .catch(() => {
    statusText.textContent = "Backend offline";
  })
  .finally(() => {
    connectSSE();
  });
