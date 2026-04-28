const API_BASE = "http://localhost:3001";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const competitionStatusEl = document.getElementById("competition-status");
const competitionTimeEl   = document.getElementById("competition-time");
const timeLabelEl         = document.getElementById("time-label");
const productsContainer   = document.getElementById("products-container");
const tradesContainer     = document.getElementById("trades-container");
const rankingBody         = document.getElementById("ranking-body");
const totalTradesEl       = document.getElementById("total-trades");
const activeBotsEl        = document.getElementById("active-bots");
const totalMarketsEl      = document.getElementById("total-markets");
const totalVolumeEl       = document.getElementById("total-volume");

// ── Chart state ───────────────────────────────────────────────────────────────
let chart         = null;
let candleSeries  = null;
let volumeSeries  = null;
let selectedProductAddress = null;
let selectedTimeframe      = 5;   // seconds
let tabsInitialized        = false;
let lastState              = null;

// ── Countdown state ───────────────────────────────────────────────────────────
let countdownInterval = null;
let _countdownEndTime = 0;

// ── SSE state ─────────────────────────────────────────────────────────────────
let eventSource    = null;
let reconnectTimer = null;

// ── Formatters ────────────────────────────────────────────────────────────────

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function shortAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((u) => String(u).padStart(2, "0")).join(":");
}

function formatTradeTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function startCountdown(endTimeUnix) {
  if (endTimeUnix === _countdownEndTime) return;
  _countdownEndTime = endTimeUnix;

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const remaining = _countdownEndTime - Math.floor(Date.now() / 1000);
    if (remaining <= 0) {
      competitionTimeEl.textContent = "00:00:00";
      clearInterval(countdownInterval);
      return;
    }
    competitionTimeEl.textContent = formatDuration(remaining);
  }, 1000);

  // Render immediately without waiting 1s
  const remaining = endTimeUnix - Math.floor(Date.now() / 1000);
  competitionTimeEl.textContent = formatDuration(Math.max(0, remaining));
}

// ── Candle builders ───────────────────────────────────────────────────────────

function buildCandles(pricePoints, timeframeSec) {
  if (!pricePoints || pricePoints.length === 0) return [];

  const tfMs = timeframeSec * 1000;
  const bucketMap = new Map();

  for (const { t, p } of pricePoints) {
    if (!p || p <= 0) continue;
    const bucketMs  = Math.floor(t / tfMs) * tfMs;
    const timeUnix  = Math.floor(bucketMs / 1000); // lightweight-charts: seconds

    if (!bucketMap.has(timeUnix)) {
      bucketMap.set(timeUnix, { time: timeUnix, open: p, high: p, low: p, close: p });
    } else {
      const c = bucketMap.get(timeUnix);
      if (p > c.high) c.high = p;
      if (p < c.low)  c.low  = p;
      c.close = p;
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
}

function buildVolume(trades, productAddress, timeframeSec) {
  if (!trades || !productAddress) return [];

  const tfMs       = timeframeSec * 1000;
  const productKey = productAddress.toLowerCase();
  const bucketMap  = new Map();

  for (const trade of trades) {
    if ((trade.productToken || "").toLowerCase() !== productKey) continue;

    const t        = trade.timestamp || 0;
    const bucketMs = Math.floor(t / tfMs) * tfMs;
    const timeUnix = Math.floor(bucketMs / 1000);
    const vol      = trade.type === "BUY"
      ? Number(trade.amountIn  || 0)
      : Number(trade.amountOut || 0);

    if (!bucketMap.has(timeUnix)) {
      bucketMap.set(timeUnix, {
        time:  timeUnix,
        value: vol,
        color: trade.type === "BUY" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
      });
    } else {
      bucketMap.get(timeUnix).value += vol;
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
}

// ── Chart init & update ───────────────────────────────────────────────────────

function initChart() {
  const container = document.getElementById("chart-container");
  if (!container || typeof LightweightCharts === "undefined") return;

  chart = LightweightCharts.createChart(container, {
    width:  container.offsetWidth,
    height: 400,
    layout: {
      background: { type: "solid", color: "#0f1419" },
      textColor:  "#9aa4b2",
    },
    grid: {
      vertLines: { color: "#1e2730" },
      horzLines: { color: "#1e2730" },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#27313d" },
    timeScale: {
      borderColor:    "#27313d",
      timeVisible:    true,
      secondsVisible: selectedTimeframe <= 15,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:      "#22c55e",
    downColor:    "#ef4444",
    borderVisible: false,
    wickUpColor:   "#22c55e",
    wickDownColor: "#ef4444",
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat:   { type: "volume" },
    priceScaleId:  "volume",
    scaleMargins:  { top: 0.82, bottom: 0 },
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  // Remove the placeholder text once the chart is mounted
  const placeholder = container.querySelector(".chart-empty");
  if (placeholder) placeholder.remove();

  window.addEventListener("resize", () => {
    if (chart) chart.applyOptions({ width: container.offsetWidth });
  });
}

function updateChart(state) {
  if (!chart || !candleSeries || !selectedProductAddress) return;

  const productKey   = selectedProductAddress.toLowerCase();
  const priceHistory = (state.priceHistory || {})[productKey] || [];
  const trades       = state.trades || [];

  const candles = buildCandles(priceHistory, selectedTimeframe);
  const volume  = buildVolume(trades, selectedProductAddress, selectedTimeframe);

  if (candles.length > 0) candleSeries.setData(candles);
  if (volume.length  > 0) volumeSeries.setData(volume);

  chart.applyOptions({
    timeScale: { secondsVisible: selectedTimeframe <= 15 },
  });
}

// ── Token tab management ──────────────────────────────────────────────────────

function populateTokenTabs(products) {
  const tabContainer = document.getElementById("chart-token-tabs");
  if (!tabContainer || !products.length) return;

  if (!selectedProductAddress) {
    selectedProductAddress = products[0].address;
  }

  tabContainer.innerHTML = products
    .map((p) => {
      const active =
        p.address.toLowerCase() === selectedProductAddress.toLowerCase()
          ? "active"
          : "";
      return `<button class="chart-tab ${active}" data-address="${p.address}">${
        p.symbol || p.address.slice(0, 6)
      }</button>`;
    })
    .join("");

  tabContainer.querySelectorAll(".chart-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabContainer
        .querySelectorAll(".chart-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedProductAddress = btn.dataset.address;
      if (lastState) updateChart(lastState);
    });
  });
}

function initTfButtons() {
  document.querySelectorAll(".tf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tf-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTimeframe = Number(btn.dataset.tf);
      if (lastState) updateChart(lastState);
    });
  });
}

// ── UI renderers ──────────────────────────────────────────────────────────────

function renderStatus(status = {}) {
  const currentStatus = status.competitionStatus || "UNKNOWN";
  const livePill = document.querySelector(".live-pill");
  livePill.classList.remove("active", "ended", "pending", "error");

  const now = Math.floor(Date.now() / 1000);
  const end = Number(status.competitionEndTime || 0);

  if (currentStatus === "ACTIVE") {
    livePill.classList.add("active");
    competitionStatusEl.textContent = "LIVE";
    timeLabelEl.textContent = "Ends in";
    if (end > now) startCountdown(end);
    return;
  }

  if (currentStatus === "ENDED") {
    livePill.classList.add("ended");
    competitionStatusEl.textContent = "ENDED";
    timeLabelEl.textContent = "Finished";
    competitionTimeEl.textContent = "00:00:00";
    clearInterval(countdownInterval);
    return;
  }

  if (currentStatus === "NOT_STARTED") {
    livePill.classList.add("pending");
    competitionStatusEl.textContent = "PENDING";
    timeLabelEl.textContent = "Waiting";
    competitionTimeEl.textContent = "--:--:--";
    return;
  }

  livePill.classList.add("error");
  competitionStatusEl.textContent = "UNKNOWN";
  timeLabelEl.textContent = "Status";
  competitionTimeEl.textContent = "--:--:--";
}

function renderStats(state) {
  const trades   = state.trades   || [];
  const ranking  = state.ranking  || [];
  const products = state.products || [];

  totalTradesEl.textContent  = trades.length;
  activeBotsEl.textContent   = ranking.length;
  totalMarketsEl.textContent = products.length;

  const totalVolume = trades.reduce((sum, t) => {
    if (t.type === "BUY")  return sum + Number(t.amountIn  || 0);
    if (t.type === "SELL") return sum + Number(t.amountOut || 0);
    return sum;
  }, 0);

  totalVolumeEl.textContent = `${formatNumber(totalVolume, 2)} CASH`;
}

function renderProducts(products = [], pools = {}, initialPrices = {}) {
  if (!products.length) {
    productsContainer.innerHTML = `<p class="empty">Nenhum mercado encontrado.</p>`;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const symbol     = product.symbol || "TOKEN";
      const pool       = pools[product.address?.toLowerCase()] || {};
      const spotPrice  = Number(pool.spotPrice  || 0);
      const reserveBase = Number(pool.reserveBase || 0);
      const liquidity  = reserveBase * 2;

      const initPrice  = initialPrices[product.address?.toLowerCase()];
      const pctChange  = initPrice && initPrice > 0
        ? ((spotPrice - initPrice) / initPrice) * 100
        : null;

      const changeBadge = pctChange !== null
        ? `<span class="price-change ${pctChange >= 0 ? "up" : "down"}">${
            pctChange >= 0 ? "+" : ""
          }${pctChange.toFixed(2)}%</span>`
        : "";

      return `
        <article class="market-card">
          <div class="market-pair">
            <strong>${symbol}/CASH</strong>
            ${changeBadge}
          </div>
          <div class="market-data">
            <div class="market-line">
              <span>Price</span>
              <strong>${formatNumber(spotPrice, 5)}</strong>
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
      const type      = trade.type || "-";
      const typeClass = type === "BUY" ? "buy" : "sell";
      const traderName =
        trade.traderName ||
        traderNameMap[(trade.trader || "").toLowerCase()] ||
        shortAddress(trade.trader);

      const amountIn  = formatNumber(trade.amountIn,  4);
      const amountOut = formatNumber(trade.amountOut, 4);
      const product   = trade.productSymbol || "PROD";
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
    rankingBody.innerHTML = `<tr><td colspan="4" class="empty">Ranking ainda vazio.</td></tr>`;
    return;
  }

  const sorted = [...ranking].sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));

  rankingBody.innerHTML = sorted
    .map((item, index) => {
      const pnl      = Number(item.pnl || 0);
      const pnlClass = pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const pnlPct   = Number(item.pnlPct || 0);
      const isWinner = competitionStatus === "ENDED" && index === 0;
      const pnlSign  = pnl >= 0 ? "+" : "";

      return `
        <tr class="${isWinner ? "final-winner" : ""}">
          <td><span class="rank">${index + 1}</span></td>
          <td>
            <span class="bot-name">${item.name || shortAddress(item.trader)}</span>
            <span class="address">${shortAddress(item.trader)}</span>
          </td>
          <td>${formatNumber(item.totalValue, 4)}</td>
          <td class="${pnlClass}">
            ${pnlSign}${formatNumber(pnl, 2)}
            <span style="font-size:11px;opacity:0.7">(${pnlSign}${pnlPct.toFixed(1)}%)</span>
          </td>
        </tr>
      `;
    })
    .join("");
}

// ── Main render ───────────────────────────────────────────────────────────────

function buildTraderNameMap(ranking) {
  const map = {};
  for (const item of ranking || []) {
    if (item.trader) map[item.trader.toLowerCase()] = item.name || item.trader;
  }
  return map;
}

function renderAll(state) {
  lastState = state;

  const products      = state.products      || [];
  const pools         = state.pools         || {};
  const trades        = state.trades        || [];
  const ranking       = state.ranking       || [];
  const status        = state.status        || {};
  const initialPrices = state.initialPrices || {};
  const traderNameMap = buildTraderNameMap(ranking);

  renderControlPanel(state);
  renderStatus(status);
  renderStats(state);
  renderProducts(products, pools, initialPrices);
  renderTrades(trades, traderNameMap);
  renderRanking(ranking, status.competitionStatus);

  // Populate token tabs once (products are fixed for the lifetime of a session)
  if (!tabsInitialized && products.length > 0) {
    populateTokenTabs(products);
    tabsInitialized = true;

    // Init chart only after we know the products
    if (!chart) initChart();
  }

  updateChart(state);
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource(`${API_BASE}/events`);

  eventSource.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      renderAll(state);
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  };

  eventSource.onerror = () => {
    const livePill = document.querySelector(".live-pill");
    livePill.classList.remove("active", "ended", "pending");
    livePill.classList.add("error");
    competitionStatusEl.textContent = "OFFLINE";
    timeLabelEl.textContent = "Reconectando...";

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

// ── Control Panel ─────────────────────────────────────────────────────────────

const TRANSITIONING = new Set([
  "STARTING_NODE", "DEPLOYING", "SETTING_UP", "STARTING_BOTS", "STOPPING",
]);

function orchBadgeClass(orchState) {
  if (orchState === "RUNNING") return "running";
  if (orchState === "ERROR")   return "error";
  if (TRANSITIONING.has(orchState)) return "working";
  return "";
}

function renderOrchestratorBadge(orchState) {
  const el = document.getElementById("orch-badge");
  if (!el) return;
  el.textContent = orchState || "IDLE";
  el.className   = "orch-badge " + orchBadgeClass(orchState);
}

function renderBots(bots) {
  const container = document.getElementById("ctrl-bots-list");
  if (!container) return;

  if (!bots || bots.length === 0) {
    container.innerHTML = `<p class="empty">No bots launched</p>`;
    return;
  }

  container.innerHTML = bots
    .map((b) => {
      const cls    = b.alive ? "alive" : "dead";
      const label  = b.alive ? "LIVE" : `EXIT ${b.exitCode ?? "?"}`;
      const name   = b.name || b.module || "Bot";
      return `
        <div class="bot-pill ${cls}">
          <span class="bot-dot"></span>
          <span class="bot-pname">${name}</span>
          <span class="bot-status-tag">${label}</span>
        </div>`;
    })
    .join("");
}

function renderFairness(fairness) {
  const container = document.getElementById("ctrl-fairness");
  if (!container) return;

  if (!fairness) {
    container.innerHTML = `<p class="empty">Awaiting market data…</p>`;
    return;
  }

  const m = fairness.metrics || {};
  const issues = (fairness.issues || [])
    .map((i) => `<div class="fairness-issue">⚠ ${i}</div>`)
    .join("");

  container.innerHTML = `
    <div class="fairness-badge ${fairness.status}">${fairness.status}</div>
    <div class="fairness-metric">
      <span>Gini coefficient</span>
      <strong>${Number(m.gini || 0).toFixed(4)}</strong>
    </div>
    <div class="fairness-metric">
      <span>Top bot dominance</span>
      <strong>${Number(m.dominancePct || 0).toFixed(1)}%</strong>
    </div>
    <div class="fairness-metric">
      <span>Trade frequency ratio</span>
      <strong>${Number(m.tradeFrequencyRatio || 1).toFixed(2)}×</strong>
    </div>
    <div class="fairness-metric">
      <span>Buy / Sell ratio</span>
      <strong>${(Number(m.buyRatio || 0.5) * 100).toFixed(0)}% / ${(Number(m.sellRatio || 0.5) * 100).toFixed(0)}%</strong>
    </div>
    ${issues}`;
}

let _lastLogCount = 0;

function renderLogs(logs) {
  const container = document.getElementById("ctrl-log-list");
  if (!container || !logs) return;

  if (logs.length === _lastLogCount) return;
  _lastLogCount = logs.length;

  const wasAtBottom =
    container.scrollHeight - container.clientHeight - container.scrollTop < 60;

  container.innerHTML = logs
    .map((entry) => {
      const t   = new Date(entry.t).toLocaleTimeString("pt-PT", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const lvl = entry.level || "INFO";
      const msg = (entry.message || "").replace(/</g, "&lt;");
      return `<div class="log-entry ${lvl}"><span class="log-time">${t}</span><span class="log-msg">${msg}</span></div>`;
    })
    .join("");

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

function updateButtonStates(orchState, compStatus) {
  const isTransitioning = TRANSITIONING.has(orchState);
  const isIdle   = orchState === "IDLE";
  const isActive = compStatus === "ACTIVE";

  const btnStart        = document.getElementById("btn-full-start");
  const btnStopComp     = document.getElementById("btn-stop-comp");
  const btnRestartBots  = document.getElementById("btn-restart-bots");
  const btnReset        = document.getElementById("btn-reset");

  if (btnStart)       btnStart.disabled       = !isIdle || isActive;
  if (btnStopComp)    btnStopComp.disabled     = compStatus !== "ACTIVE";
  if (btnRestartBots) btnRestartBots.disabled  = isIdle || isTransitioning;
  if (btnReset)       btnReset.disabled        = isIdle || isTransitioning;
}

function renderControlPanel(state) {
  const orch       = state.orchestrator || {};
  const compStatus = (state.status || {}).competitionStatus || "NOT_STARTED";

  renderOrchestratorBadge(orch.state || "IDLE");
  renderBots(orch.bots || []);
  renderFairness(state.fairness || null);
  renderLogs(orch.recentLogs || []);
  updateButtonStates(orch.state || "IDLE", compStatus);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path, body = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch (err) {
    console.error(`[API] POST ${path} failed:`, err.message);
    throw err;
  }
}

function withLoading(btn, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Working…";
  fn().catch((err) => {
    console.error("Button action failed:", err.message);
  }).finally(() => {
    btn.textContent = orig;
  });
}

// ── Button wiring ─────────────────────────────────────────────────────────────

document.getElementById("btn-full-start")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () => {
    const duration = Number(
      document.getElementById("competition-duration")?.value || 300
    );
    return apiPost("/orchestrate/full-start", { duration });
  });
});

document.getElementById("btn-stop-comp")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/stop-competition")
  );
});

document.getElementById("btn-restart-bots")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/restart-bots")
  );
});

document.getElementById("btn-reset")?.addEventListener("click", (e) => {
  if (!confirm("Reset the entire system? This will kill all bots and the Hardhat node.")) return;
  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/reset")
  );
});

document.getElementById("ctrl-log-scroll-btn")?.addEventListener("click", () => {
  const el = document.getElementById("ctrl-log-list");
  if (el) el.scrollTop = el.scrollHeight;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
initTfButtons();
connectSSE();
