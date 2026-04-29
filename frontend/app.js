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

let chart = null;
let candleSeries = null;
let volumeSeries = null;
let selectedProductAddress = null;
let selectedTimeframe = 5;
let tabsInitialized = false;
let lastState = null;
let lastProductsSignature = "";

let countdownInterval = null;
let _countdownEndTime = 0;
let _serverClockOffsetMs = 0;

let eventSource = null;
let reconnectTimer = null;

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";

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

function startCountdown(endTimeUnix, serverNowMs = Date.now()) {
  _serverClockOffsetMs = serverNowMs - Date.now();

  if (endTimeUnix === _countdownEndTime && countdownInterval) return;

  _countdownEndTime = endTimeUnix;
  clearInterval(countdownInterval);

  const tick = () => {
    const nowUnix = Math.floor((Date.now() + _serverClockOffsetMs) / 1000);
    const remaining = _countdownEndTime - nowUnix;

    if (remaining <= 0) {
      competitionTimeEl.textContent = "00:00:00";
      clearInterval(countdownInterval);
      countdownInterval = null;
      return;
    }

    competitionTimeEl.textContent = formatDuration(remaining);
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function buildCandles(pricePoints, timeframeSec) {
  if (!pricePoints || pricePoints.length === 0) return [];

  const tfMs = timeframeSec * 1000;
  const bucketMap = new Map();

  for (const { t, p } of pricePoints) {
    if (!p || p <= 0) continue;

    const bucketMs = Math.floor(t / tfMs) * tfMs;
    const timeUnix = Math.floor(bucketMs / 1000);

    if (!bucketMap.has(timeUnix)) {
      bucketMap.set(timeUnix, {
        time: timeUnix,
        open: p,
        high: p,
        low: p,
        close: p,
      });
    } else {
      const c = bucketMap.get(timeUnix);
      if (p > c.high) c.high = p;
      if (p < c.low) c.low = p;
      c.close = p;
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
}

function buildVolume(trades, productAddress, timeframeSec) {
  if (!trades || !productAddress) return [];

  const tfMs = timeframeSec * 1000;
  const productKey = productAddress.toLowerCase();
  const bucketMap = new Map();

  for (const trade of trades) {
    if ((trade.productToken || "").toLowerCase() !== productKey) continue;

    const t = trade.timestamp || 0;
    const bucketMs = Math.floor(t / tfMs) * tfMs;
    const timeUnix = Math.floor(bucketMs / 1000);
    const vol =
      trade.type === "BUY"
        ? Number(trade.amountIn || 0)
        : Number(trade.amountOut || 0);

    if (!bucketMap.has(timeUnix)) {
      bucketMap.set(timeUnix, {
        time: timeUnix,
        value: vol,
        color:
          trade.type === "BUY"
            ? "rgba(34,197,94,0.4)"
            : "rgba(239,68,68,0.4)",
      });
    } else {
      bucketMap.get(timeUnix).value += vol;
    }
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
}

function initChart() {
  const container = document.getElementById("chart-container");
  if (!container || typeof LightweightCharts === "undefined") return;

  chart = LightweightCharts.createChart(container, {
    width: container.offsetWidth,
    height: 400,
    layout: {
      background: { type: "solid", color: "#0f1419" },
      textColor: "#9aa4b2",
    },
    grid: {
      vertLines: { color: "#1e2730" },
      horzLines: { color: "#1e2730" },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#27313d" },
    timeScale: {
      borderColor: "#27313d",
      timeVisible: true,
      secondsVisible: selectedTimeframe <= 15,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#22c55e",
    downColor: "#ef4444",
    borderVisible: false,
    wickUpColor: "#22c55e",
    wickDownColor: "#ef4444",
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  const placeholder = container.querySelector(".chart-empty");
  if (placeholder) placeholder.remove();

  window.addEventListener("resize", () => {
    if (chart) chart.applyOptions({ width: container.offsetWidth });
  });
}

function updateChart(state) {
  if (!chart || !candleSeries || !selectedProductAddress) return;

  const productKey = selectedProductAddress.toLowerCase();
  let priceHistory = (state.priceHistory || {})[productKey] || [];
  const trades = state.trades || [];

  if (priceHistory.length === 0) {
    const pool = (state.pools || {})[productKey];
    const spotPrice = Number(pool?.spotPrice || 0);

    if (spotPrice > 0) {
      priceHistory = [{ t: state.lastUpdatedAt || Date.now(), p: spotPrice }];
    }
  }

  const candles = buildCandles(priceHistory, selectedTimeframe);
  const volume = buildVolume(trades, selectedProductAddress, selectedTimeframe);

  candleSeries.setData(candles);
  volumeSeries.setData(volume);

  chart.applyOptions({
    timeScale: { secondsVisible: selectedTimeframe <= 15 },
  });

  if (candles.length > 0) {
    chart.timeScale().fitContent();
  } else {
    chart.timeScale().resetTimeScale();
  }
}

function populateTokenTabs(products) {
  const tabContainer = document.getElementById("chart-token-tabs");
  if (!tabContainer || !products.length) return;

  if (!selectedProductAddress) selectedProductAddress = products[0].address;

  tabContainer.innerHTML = products
    .map((p) => {
      const active =
        p.address.toLowerCase() === selectedProductAddress.toLowerCase()
          ? "active"
          : "";

      return `<button class="chart-tab ${active}" data-address="${p.address}">
        ${p.symbol || p.address.slice(0, 6)}
      </button>`;
    })
    .join("");

  tabContainer.querySelectorAll(".chart-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabContainer.querySelectorAll(".chart-tab").forEach((b) => {
        b.classList.remove("active");
      });

      btn.classList.add("active");
      selectedProductAddress = btn.dataset.address;

      if (lastState) updateChart(lastState);
    });
  });
}

function getProductsSignature(products = []) {
  return products.map((p) => (p.address || "").toLowerCase()).join("|");
}

function ensureChartProducts(products = []) {
  const signature = getProductsSignature(products);
  if (!signature) return;

  if (signature !== lastProductsSignature) {
    lastProductsSignature = signature;
    selectedProductAddress = products[0]?.address || null;
    tabsInitialized = false;

    if (candleSeries) candleSeries.setData([]);
    if (volumeSeries) volumeSeries.setData([]);
  }

  if (!tabsInitialized && products.length > 0) {
    populateTokenTabs(products);
    tabsInitialized = true;

    if (!chart) initChart();
  }
}

function initTfButtons() {
  document.querySelectorAll(".tf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach((b) => {
        b.classList.remove("active");
      });

      btn.classList.add("active");
      selectedTimeframe = Number(btn.dataset.tf);

      if (lastState) updateChart(lastState);
    });
  });
}

function renderStatus(status = {}, serverNowMs = Date.now()) {
  const currentStatus = status.competitionStatus || "UNKNOWN";
  const livePill = document.querySelector(".live-pill");

  livePill.classList.remove("active", "ended", "pending", "error");

  const now = Math.floor(serverNowMs / 1000);
  const end = Number(status.competitionEndTime || 0);

  if (currentStatus === "ACTIVE" && end > now) {
    livePill.classList.add("active");
    competitionStatusEl.textContent = "LIVE";
    timeLabelEl.textContent = "Ends in";
    startCountdown(end, serverNowMs);
    return;
  }

  if (currentStatus === "ACTIVE" && end <= now) {
    livePill.classList.add("ended");
    competitionStatusEl.textContent = "ENDED";
    timeLabelEl.textContent = "Finished";
    competitionTimeEl.textContent = "00:00:00";
    clearInterval(countdownInterval);
    countdownInterval = null;
    return;
  }

  if (currentStatus === "ENDED") {
    livePill.classList.add("ended");
    competitionStatusEl.textContent = "ENDED";
    timeLabelEl.textContent = "Finished";
    competitionTimeEl.textContent = "00:00:00";
    clearInterval(countdownInterval);
    countdownInterval = null;
    return;
  }

  if (currentStatus === "NOT_STARTED") {
    livePill.classList.add("pending");
    competitionStatusEl.textContent = "PENDING";
    timeLabelEl.textContent = "Waiting";
    competitionTimeEl.textContent = "--:--:--";
    clearInterval(countdownInterval);
    countdownInterval = null;
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

  const totalVolume = trades.reduce((sum, t) => {
    if (t.type === "BUY") return sum + Number(t.amountIn || 0);
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
      const symbol = product.symbol || "TOKEN";
      const key = product.address?.toLowerCase();
      const pool = pools[key] || {};
      const spotPrice = Number(pool.spotPrice || 0);
      const reserveBase = Number(pool.reserveBase || 0);
      const liquidity = reserveBase * 2;
      const initPrice = initialPrices[key];

      const pctChange =
        initPrice && initPrice > 0
          ? ((spotPrice - initPrice) / initPrice) * 100
          : null;

      const changeBadge =
        pctChange !== null
          ? `<span class="price-change ${pctChange >= 0 ? "up" : "down"}">
              ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%
            </span>`
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
      const type = trade.type || "-";
      const typeClass = type === "BUY" ? "buy" : "sell";
      const traderName =
        trade.traderName ||
        traderNameMap[(trade.trader || "").toLowerCase()] ||
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

function getTraderTradeStats(trades = [], traderAddress) {
  const key = (traderAddress || "").toLowerCase();
  const stats = { total: 0, buys: 0, sells: 0 };

  for (const trade of trades) {
    if ((trade.trader || "").toLowerCase() !== key) continue;

    stats.total += 1;
    if (trade.type === "BUY") stats.buys += 1;
    if (trade.type === "SELL") stats.sells += 1;
  }

  return stats;
}

function renderRanking(ranking = [], competitionStatus, trades = []) {
  if (!ranking.length) {
    rankingBody.innerHTML = `<tr><td colspan="5" class="empty">Ranking ainda vazio.</td></tr>`;
    return;
  }

  const sorted = [...ranking].sort(
    (a, b) => Number(b.pnl || 0) - Number(a.pnl || 0)
  );

  rankingBody.innerHTML = sorted
    .map((item, index) => {
      const pnl = Number(item.pnl || 0);
      const pnlClass = pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const pnlPct = Number(item.pnlPct || 0);
      const isWinner = competitionStatus === "ENDED" && index === 0;
      const pnlSign = pnl >= 0 ? "+" : "";
      const stats = getTraderTradeStats(trades, item.trader);

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
            <span style="font-size:11px;opacity:0.7">
              (${pnlSign}${pnlPct.toFixed(1)}%)
            </span>
          </td>

          <td>
            <div class="ops-cell">
              <strong>${stats.total}</strong>
              <span class="ops-breakdown">
                <span class="op-buy">↑ ${stats.buys}</span>
                <span class="op-sell">↓ ${stats.sells}</span>
              </span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function buildTraderNameMap(ranking) {
  const map = {};

  for (const item of ranking || []) {
    if (item.trader) map[item.trader.toLowerCase()] = item.name || item.trader;
  }

  return map;
}

function renderAll(state) {
  lastState = state;

  const products = state.products || [];
  const pools = state.pools || {};
  const trades = state.trades || [];
  const ranking = state.ranking || [];
  const status = state.status || {};
  const initialPrices = state.initialPrices || {};
  const traderNameMap = buildTraderNameMap(ranking);

  renderControlPanel(state);
  renderStatus(status, state.lastUpdatedAt || Date.now());
  renderStats(state);
  renderProducts(products, pools, initialPrices);
  renderTrades(trades, traderNameMap);
  renderRanking(ranking, status.competitionStatus, trades);

  ensureChartProducts(products);
  updateChart(state);
}

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

const TRANSITIONING = new Set([
  "STARTING_NODE",
  "DEPLOYING",
  "SETTING_UP",
  "STARTING_BOTS",
  "STOPPING",
]);

function orchBadgeClass(orchState) {
  if (orchState === "RUNNING") return "running";
  if (orchState === "ERROR") return "error";
  if (orchState === "STOPPED") return "stopped";
  if (orchState === "MANUAL_ACTIVE") return "manual_active";
  if (TRANSITIONING.has(orchState)) return "working";
  return "";
}

function renderOrchestratorBadge(orchState) {
  const el = document.getElementById("orch-badge");
  if (!el) return;

  el.textContent = orchState || "IDLE";
  el.className = "orch-badge " + orchBadgeClass(orchState);
}

function getUiSystemMode(state) {
  const orchState = state.orchestrator?.state || "IDLE";
  const competitionStatus = state.status?.competitionStatus || "NOT_STARTED";

  if (
    competitionStatus === "ACTIVE" &&
    (orchState === "IDLE" || orchState === "STOPPED")
  ) {
    return "MANUAL_ACTIVE";
  }

  return orchState;
}

function updateButtonStates(state) {
  const orchState = state.orchestrator?.state || "IDLE";
  const competitionStatus = state.status?.competitionStatus || "NOT_STARTED";
  const mode = getUiSystemMode(state);
  const isBusy = TRANSITIONING.has(orchState);

  const canStart =
    !isBusy &&
    competitionStatus !== "ACTIVE" &&
    (orchState === "IDLE" || orchState === "STOPPED");

  const canStop =
    !isBusy &&
    orchState === "RUNNING" &&
    competitionStatus === "ACTIVE";

  const canRestartBots =
    !isBusy &&
    competitionStatus !== "ACTIVE" &&
    (orchState === "RUNNING" ||
      orchState === "STOPPED" ||
      orchState === "ERROR");

  const canRestartApp =
    !isBusy &&
    competitionStatus !== "ACTIVE" &&
    (orchState === "STOPPED" || orchState === "ERROR");

  const btnStart = document.getElementById("btn-start-app");
  const btnStop = document.getElementById("btn-stop-app");
  const btnRestartBots = document.getElementById("btn-restart-bots");
  const btnRestartApp = document.getElementById("btn-restart-app");

  if (btnStart) btnStart.disabled = !canStart;
  if (btnStop) btnStop.disabled = !canStop;
  if (btnRestartBots) btnRestartBots.disabled = !canRestartBots;
  if (btnRestartApp) btnRestartApp.disabled = !canRestartApp;

  const hint = document.getElementById("ctrl-hint");

  if (hint) {
    if (mode === "MANUAL_ACTIVE") {
      hint.textContent =
        "Competição ativa fora do orchestrator. A UI lê o estado, mas pode não controlar bots iniciados no terminal.";
    } else if (competitionStatus === "ACTIVE") {
      hint.textContent = "Competição em execução.";
    } else if (competitionStatus === "ENDED" && orchState === "RUNNING") {
      hint.textContent =
        "Competição terminou. Aguardando sincronização do controlador.";
    } else if (competitionStatus === "ENDED") {
      hint.textContent = "Competição terminada. Podes reiniciar os bots.";
    } else {
      hint.textContent = "Pronto para iniciar.";
    }
  }
}

function renderControlPanel(state) {
  const mode = getUiSystemMode(state);
  renderOrchestratorBadge(mode);
  updateButtonStates(state);
}

async function apiPost(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

  return json;
}

function getDuration() {
  return Number(document.getElementById("competition-duration")?.value || 300);
}

function withLoading(btn, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Working…";

  fn()
    .catch((err) => {
      console.error("Button action failed:", err.message);
      alert(err.message);
    })
    .finally(() => {
      btn.textContent = orig;
      btn.disabled = false;
      if (lastState) renderControlPanel(lastState);
    });
}

document.getElementById("btn-start-app")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/full-start", { duration: getDuration() })
  );
});

document.getElementById("btn-stop-app")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () => apiPost("/orchestrate/stop-app"));
});

document.getElementById("btn-restart-bots")?.addEventListener("click", (e) => {
  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/restart-bots", { duration: getDuration() })
  );
});

document.getElementById("btn-restart-app")?.addEventListener("click", (e) => {
  const ok = confirm(
    "Restart the application? This will reset market balances and relaunch all bots."
  );

  if (!ok) return;

  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/restart-app", { duration: getDuration() })
  );
});

initTfButtons();
connectSSE();