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
let selectedPoolId = null;
let selectedTimeframe = 5;
let lastState = null;
let lastPoolsSignature = "";

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

function poolsArray(state) {
  return Object.values(state.pools || {});
}

function tokensArray(state) {
  return state.tokens || [];
}

function renderStats(state) {
  const trades = state.trades || [];
  const ranking = state.ranking || [];
  const pools = poolsArray(state);
  const ref = state.referenceToken?.symbol || "--";

  totalTradesEl.textContent = trades.length;
  activeBotsEl.textContent = ranking.length;
  totalMarketsEl.textContent = pools.length;
  totalVolumeEl.textContent = ref;
}

function renderProducts(tokens = [], pools = {}, referenceToken = {}) {
  const poolList = Object.values(pools || {});

  if (!poolList.length) {
    productsContainer.innerHTML = `<p class="empty">Nenhuma pool encontrada.</p>`;
    return;
  }

  productsContainer.innerHTML = poolList
    .map((pool) => {
      const reserve0 = Number(pool.reserve0 || 0);
      const reserve1 = Number(pool.reserve1 || 0);
      const price01 = reserve0 > 0 ? reserve1 / reserve0 : 0;
      const price10 = reserve1 > 0 ? reserve0 / reserve1 : 0;

      const isRef0 =
        referenceToken?.address &&
        pool.token0?.toLowerCase() === referenceToken.address.toLowerCase();

      const isRef1 =
        referenceToken?.address &&
        pool.token1?.toLowerCase() === referenceToken.address.toLowerCase();

      const refBadge =
        isRef0 || isRef1
          ? `<span class="price-change up">REF</span>`
          : "";

      return `
        <article class="market-card">
          <div class="market-pair">
            <strong>${pool.pair || `${pool.symbol0}/${pool.symbol1}`}</strong>
            ${refBadge}
          </div>

          <div class="market-data">
            <div class="market-line">
              <span>${pool.symbol0} reserve</span>
              <strong>${formatNumber(reserve0, 2)}</strong>
            </div>

            <div class="market-line">
              <span>${pool.symbol1} reserve</span>
              <strong>${formatNumber(reserve1, 2)}</strong>
            </div>

            <div class="market-line">
              <span>1 ${pool.symbol0}</span>
              <strong>${formatNumber(price01, 5)} ${pool.symbol1}</strong>
            </div>

            <div class="market-line">
              <span>1 ${pool.symbol1}</span>
              <strong>${formatNumber(price10, 5)} ${pool.symbol0}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTrades(trades = [], traderNameMap = {}) {
  if (!trades.length) {
    tradesContainer.innerHTML = `<p class="empty">Ainda não há swaps.</p>`;
    return;
  }

  tradesContainer.innerHTML = trades
    .slice(0, 14)
    .map((trade) => {
      const traderName =
        trade.traderName ||
        traderNameMap[(trade.trader || "").toLowerCase()] ||
        shortAddress(trade.trader);

      const amountIn = formatNumber(trade.amountIn, 4);
      const amountOut = formatNumber(trade.amountOut, 4);

      const flow = `${amountIn} ${trade.tokenInSymbol || "TKN"} → ${amountOut} ${trade.tokenOutSymbol || "TKN"}`;

      return `
        <article class="trade-card">
          <div class="trade-main">
            <div class="trade-left">
              <span class="trade-side swap">SWAP</span>
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
  const stats = { total: 0, swaps: 0 };

  for (const trade of trades) {
    if ((trade.trader || "").toLowerCase() !== key) continue;

    stats.total += 1;
    stats.swaps += 1;
  }

  return stats;
}

function renderRanking(ranking = [], competitionStatus, trades = [], tokens = [], referenceToken = {}) {
  if (!ranking.length) {
    rankingBody.innerHTML = `<tr><td colspan="10" class="empty">Ranking ainda vazio.</td></tr>`;
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
      const pnlSign = pnl >= 0 ? "+" : "";
      const isWinner = competitionStatus === "ENDED" && index === 0;
      const stats = getTraderTradeStats(trades, item.trader);

      const balances = item.balances || {};

      const tokenCells = tokens.map((token) => {
        const value = balances[token.address.toLowerCase()] || 0;

        return `
          <td class="token-balance-cell">
            ${formatNumber(value, 2)}
          </td>
        `;
      }).join("");

      return `
        <tr class="${isWinner ? "final-winner" : ""}">
          <td><span class="rank">${index + 1}</span></td>

          <td>
            <span class="bot-name">${item.name || shortAddress(item.trader)}</span>
            <span class="address">${shortAddress(item.trader)}</span>
          </td>

          ${tokenCells}

          <td>
            ${formatNumber(item.totalValue, 4)}
            <span class="address">${referenceToken.symbol || "REF"}</span>
          </td>

          <td class="${pnlClass}">
            ${pnlSign}${formatNumber(pnl, 2)}
            <span style="font-size:11px;opacity:0.7">
              (${pnlSign}${pnlPct.toFixed(1)}%)
            </span>
          </td>

          <td>
            <div class="ops-cell">
              <span class="ops-breakdown">
                <span class="op-swap">↔ ${stats.swaps}</span>
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

function buildVolume(trades, poolId, timeframeSec) {
  if (!trades || !poolId) return [];

  const tfMs = timeframeSec * 1000;
  const key = String(poolId).toLowerCase();
  const bucketMap = new Map();

  for (const trade of trades) {
    if (String(trade.poolId || "").toLowerCase() !== key) continue;

    const t = trade.timestamp || 0;
    const bucketMs = Math.floor(t / tfMs) * tfMs;
    const timeUnix = Math.floor(bucketMs / 1000);
    const vol = Number(trade.amountIn || 0);

    if (!bucketMap.has(timeUnix)) {
      bucketMap.set(timeUnix, {
        time: timeUnix,
        value: vol,
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
  if (!chart || !candleSeries || !selectedPoolId) return;

  const key = String(selectedPoolId).toLowerCase();
  const priceHistory = (state.priceHistory || {})[key] || [];
  const trades = state.trades || [];

  const candles = buildCandles(priceHistory, selectedTimeframe);
  const volume = buildVolume(trades, selectedPoolId, selectedTimeframe);

  candleSeries.setData(candles);
  volumeSeries.setData(volume);

  if (candles.length > 0) {
    chart.timeScale().fitContent();
  }
}

function populatePoolTabs(pools) {
  const tabContainer = document.getElementById("chart-token-tabs");
  if (!tabContainer) return;

  const poolList = Object.values(pools || {});

  if (!poolList.length) {
    tabContainer.innerHTML = "";
    return;
  }

  if (!selectedPoolId) selectedPoolId = poolList[0].poolId;

  tabContainer.innerHTML = poolList
    .map((pool) => {
      const active =
        String(pool.poolId).toLowerCase() === String(selectedPoolId).toLowerCase()
          ? "active"
          : "";

      return `<button class="chart-tab ${active}" data-pool="${pool.poolId}">
        ${pool.pair || `${pool.symbol0}/${pool.symbol1}`}
      </button>`;
    })
    .join("");

  tabContainer.querySelectorAll(".chart-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabContainer.querySelectorAll(".chart-tab").forEach((b) => {
        b.classList.remove("active");
      });

      btn.classList.add("active");
      selectedPoolId = btn.dataset.pool;

      if (lastState) updateChart(lastState);
    });
  });
}

function ensureChartPools(pools = {}) {
  const poolList = Object.values(pools || {});
  const signature = poolList.map((p) => String(p.poolId).toLowerCase()).join("|");

  if (!signature) return;

  if (signature !== lastPoolsSignature) {
    lastPoolsSignature = signature;
    selectedPoolId = poolList[0]?.poolId || null;

    if (candleSeries) candleSeries.setData([]);
    if (volumeSeries) volumeSeries.setData([]);

    populatePoolTabs(pools);
  }

  if (!chart) initChart();
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
  if (btnRestartBots) btnRestartBots.disabled = true;
  if (btnRestartApp) btnRestartApp.disabled = !canRestartApp;

  const hint = document.getElementById("ctrl-hint");

  if (hint) {
    if (mode === "MANUAL_ACTIVE") {
      hint.textContent = "Competição ativa fora do orchestrator.";
    } else if (competitionStatus === "ACTIVE") {
      hint.textContent = "Competição em execução.";
    } else if (competitionStatus === "ENDED") {
      hint.textContent = "Competição terminada.";
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

function renderAll(state) {
  lastState = state;

  const tokens = tokensArray(state);
  const pools = state.pools || {};
  const trades = state.trades || [];
  const ranking = state.ranking || [];
  const status = state.status || {};
  const referenceToken = state.referenceToken || {};
  const traderNameMap = buildTraderNameMap(ranking);

  renderControlPanel(state);
  renderStatus(status, state.lastUpdatedAt || Date.now());
  renderStats(state);
  renderProducts(tokens, pools, referenceToken);
  renderTrades(trades, traderNameMap);
  renderRanking(ranking, status.competitionStatus, trades, tokens, referenceToken);

  ensureChartPools(pools);
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

document.getElementById("btn-restart-app")?.addEventListener("click", (e) => {
  const ok = confirm("Full reset? Isto vai redesplegar contratos e reiniciar a competição.");

  if (!ok) return;

  withLoading(e.currentTarget, () =>
    apiPost("/orchestrate/restart-app", { duration: getDuration() })
  );
});

async function fetchInitialState() {
  try {
    const res = await fetch(`${API_BASE}/state`);
    const state = await res.json();
    renderAll(state);
  } catch (e) {
    console.error("Initial state fetch failed:", e);
  }
}

initTfButtons();
fetchInitialState();
connectSSE();