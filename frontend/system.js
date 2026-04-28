const API_BASE = "http://localhost:3001";

let eventSource    = null;
let reconnectTimer = null;
let _lastLogCount  = 0;

// ── Badge helpers ─────────────────────────────────────────────────────────────

const TRANSITIONING = new Set([
  "STARTING_NODE", "DEPLOYING", "SETTING_UP", "STARTING_BOTS", "STOPPING",
]);

function orchBadgeClass(s) {
  if (s === "RUNNING") return "running";
  if (s === "ERROR")   return "error";
  if (s === "STOPPED") return "stopped";
  if (TRANSITIONING.has(s)) return "working";
  return "";
}

function setConnStatus(text, ok) {
  const el = document.getElementById("sys-conn-status");
  if (!el) return;
  el.textContent = text;
  el.className   = "sys-conn" + (ok ? " sys-conn-ok" : " sys-conn-err");
}

// ── Bot status renderer ───────────────────────────────────────────────────────

function renderBots(bots) {
  const container = document.getElementById("sys-bots");
  const aliveEl   = document.getElementById("sys-bots-alive");
  if (!container) return;

  if (!bots || bots.length === 0) {
    container.innerHTML = `<p class="empty">No bots launched yet</p>`;
    if (aliveEl) aliveEl.textContent = "0 / 0";
    return;
  }

  const aliveCount = bots.filter((b) => b.alive).length;
  if (aliveEl) aliveEl.textContent = `${aliveCount} / ${bots.length} alive`;

  container.innerHTML = bots
    .map((b) => {
      const cls   = b.alive ? "alive" : "dead";
      const label = b.alive ? "LIVE" : `EXIT ${b.exitCode ?? "?"}`;
      const name  = b.name || b.module || "Bot";
      return `
        <div class="bot-pill ${cls}">
          <span class="bot-dot"></span>
          <span class="bot-pname">${name}</span>
          ${b.pid ? `<span class="bot-pid">PID ${b.pid}</span>` : ""}
          <span class="bot-status-tag">${label}</span>
        </div>`;
    })
    .join("");
}

// ── Fairness renderer ─────────────────────────────────────────────────────────

function renderFairness(fairness) {
  const container = document.getElementById("sys-fairness");
  const badgeEl   = document.getElementById("sys-fairness-badge");
  if (!container) return;

  if (!fairness) {
    container.innerHTML = `<p class="empty">Awaiting market data…</p>`;
    if (badgeEl) badgeEl.textContent = "--";
    return;
  }

  if (badgeEl) badgeEl.textContent = fairness.status || "--";

  const m      = fairness.metrics || {};
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
      <strong>${Number(m.dominancePct || 0).toFixed(1)}%
        ${m.dominantBot ? `<small>(${m.dominantBot})</small>` : ""}</strong>
    </div>
    <div class="fairness-metric">
      <span>Trade frequency ratio</span>
      <strong>${Number(m.tradeFrequencyRatio || 1).toFixed(2)}×</strong>
    </div>
    <div class="fairness-metric">
      <span>Buy / Sell balance</span>
      <strong>${(Number(m.buyRatio || 0.5) * 100).toFixed(0)}% buys / ${(Number(m.sellRatio || 0.5) * 100).toFixed(0)}% sells</strong>
    </div>
    ${issues}`;
}

// ── Log renderer ──────────────────────────────────────────────────────────────

function renderLogs(logs) {
  const container   = document.getElementById("sys-log-list");
  const autoScrollEl = document.getElementById("sys-log-autoscroll");
  if (!container || !logs) return;

  if (logs.length === _lastLogCount) return;
  _lastLogCount = logs.length;

  const wasAtBottom =
    container.scrollHeight - container.clientHeight - container.scrollTop < 80;
  const autoScroll = autoScrollEl ? autoScrollEl.checked : true;

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

  if (autoScroll && wasAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderAll(state) {
  const orch = state.orchestrator || {};

  const badge = document.getElementById("sys-orch-badge");
  if (badge) {
    badge.textContent = orch.state || "IDLE";
    badge.className   = "orch-badge " + orchBadgeClass(orch.state || "IDLE");
  }

  renderBots(orch.bots || []);
  renderFairness(state.fairness || null);
  renderLogs(orch.recentLogs || []);
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connectSSE() {
  if (eventSource) { eventSource.close(); eventSource = null; }

  eventSource = new EventSource(`${API_BASE}/events`);

  eventSource.onopen = () => setConnStatus("Live", true);

  eventSource.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      renderAll(state);
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  };

  eventSource.onerror = () => {
    setConnStatus("Reconnecting…", false);
    if (eventSource) { eventSource.close(); eventSource = null; }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

// ── Scroll button ─────────────────────────────────────────────────────────────

document.getElementById("sys-log-scroll-btn")?.addEventListener("click", () => {
  const el = document.getElementById("sys-log-list");
  if (el) el.scrollTop = el.scrollHeight;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
connectSSE();
