import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { getConfig } from "./config.js";
import { initDb } from "./db.js";
import { fetchAccountBalance } from "./okx-rest.js";
import { onPrice, startWs } from "./okx-ws.js";
import { setupRoutes } from "./routes.js";
import { state } from "./shared-state.js";
import { startTradingEngine, checkPositions, periodicPersist, computePositionViews } from "./trading-engine.js";
import * as strategyRunner from "./strategy-runner.js";
import * as accountManager from "./account-manager.js";
import {
  fetchCandlesForBar, refreshCandlesForBar,
  getCandlesForChartBar, getCurrentCandleForBar, CHART_BARS,
} from "./market-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = getConfig();

// ---- Helpers ----

function beijingStrToEpoch(s: string): number {
  return new Date(s + " +08:00").getTime();
}

function buildSnapshot(accountId?: number): any {
  const aid = accountId ?? accountManager.getActiveAccountId();
  const acct = accountManager.getAccount(aid);
  if (!acct) return {};

  const price = state.currentPrice;
  const views = computePositionViews(aid, price);

  const snap: any = {
    current_price: price,
    swap_price: state.swapPrice,
    current_time: state.currentTime,
    balance: acct.balance,
    initial_balance: acct.initialBalance,
    total_pnl: acct.totalPnl,
    total_trades: acct.totalTrades,
    winning_trades: acct.winningTrades,
    losing_trades: acct.losingTrades,
    total_volume: acct.totalVolume,
    total_turnover: acct.totalTurnover,
    positions: views,
    recent_trades: acct.recentTrades,
    total_position_value: views.reduce((s: number, p: any) => s + (p.market_value ?? 0), 0),
    total_unrealized_pnl: views.reduce((s: number, p: any) => s + (p.unrealized_pnl ?? 0), 0),
    ws_connected: state.wsConnected,
    auto_trader: acct.autoTraderState,
    active_account_id: aid,
  };

  // Primary 5m candles (backwards-compat)
  snap.candles = getCandlesForChartBar("5m", 150);
  const cc = getCurrentCandleForBar("5m");
  snap.current_candle = cc ? { time: Math.floor(cc.ts / 1000), open: cc.open, high: cc.high, low: cc.low, close: cc.close, volume: cc.volume } : null;

  // Additional timeframe candles
  for (const bar of CHART_BARS) {
    if (bar === "5m") continue;
    const key = `candles_${bar.toLowerCase()}`;
    const curKey = `current_candle_${bar.toLowerCase()}`;
    snap[key] = getCandlesForChartBar(bar, 150);
    const cur = getCurrentCandleForBar(bar);
    snap[curKey] = cur ? { time: Math.floor(cur.ts / 1000), open: cur.open, high: cur.high, low: cur.low, close: cur.close, volume: cur.volume } : null;
  }

  // Trade markers: entry/exit points aligned to 5m candle boundaries
  const BAR_MS = 300_000; // 5m
  const markers: any[] = [];
  const addMarker = (timeStr: string, side: string, type: string, pnl?: number) => {
    const ms = beijingStrToEpoch(timeStr);
    if (isNaN(ms)) return;
    const time = Math.floor(ms / BAR_MS) * Math.floor(BAR_MS / 1000);
    const isLong = side === "long";
    if (type === "entry") {
      markers.push({ time, position: isLong ? "belowBar" : "aboveBar", shape: isLong ? "arrowUp" : "arrowDown", color: isLong ? "#3fb950" : "#f85149", text: isLong ? "B" : "S" });
    } else {
      const profit = (pnl ?? 0) >= 0;
      markers.push({ time, position: "inBar", shape: profit ? "arrowUp" : "arrowDown", color: profit ? "#3fb950" : "#f85149", text: profit ? "TP" : "SL" });
    }
  };
  // Use active account's positions and trades for markers
  for (const p of views) addMarker(p.entry_time, p.side, "entry");
  for (const t of acct.recentTrades) {
    addMarker(t.entry_time, t.side, "entry");
    if (t.exit_time) addMarker(t.exit_time, t.side, "exit", t.pnl);
  }
  snap.trade_markers = markers;

  return snap;
}

function broadcast(accountId?: number): void {
  try {
    const data = JSON.stringify(buildSnapshot(accountId));
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  } catch (err) {
    console.error("[main] broadcast error:", err);
  }
}

// ---- Startup ----

initDb();
startTradingEngine(); // loads all accounts & positions from DB into account-manager

// Fetch real OKX balance (async, non-critical, display only)
fetchAccountBalance().then((bal) => {
  if (bal) { state.realBalance = bal.eq; console.log(`[main] OKX real balance: $${bal.eq}`); }
}).catch(() => {});

// ---- Express app ----

const app = express();
app.use(cors());
app.use(express.json());

app.use(setupRoutes());

// Production: serve built frontend
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

// ---- HTTP + WebSocket server for frontend ----

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log(`[ws] Frontend connected (${wss.clients.size})`);
  ws.send(JSON.stringify(buildSnapshot()));

  // Listen for account switch messages from frontend
  ws.on("message", (raw: Buffer | string) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const msg = JSON.parse(text);
      if (msg.type === "switch_account" && msg.account_id) {
        const acct = accountManager.setActiveAccount(msg.account_id);
        if (acct) {
          console.log(`[ws] Switched to account #${msg.account_id} via WS`);
          ws.send(JSON.stringify(buildSnapshot()));
        }
      }
    } catch { /* ignore invalid messages */ }
  });

  ws.on("close", () => console.log(`[ws] Frontend disconnected (${wss.clients.size})`));
});

// ---- Real-time data flow ----

let lastPrice = 0;
let lastATJson = "";

onPrice(() => {
  const price = state.currentPrice;

  // Check positions across all accounts (purely in-memory, no DB)
  checkPositions(price);

  // Only push to frontend when price actually changed
  if (price !== lastPrice) {
    lastPrice = price;
    broadcast();
  }
});

// Broadcast auto-trader state changes to frontend (runs in-between price ticks)
setInterval(() => {
  const acct = accountManager.getActiveAccount();
  const cur = JSON.stringify(acct.autoTraderState);
  if (cur !== lastATJson) {
    lastATJson = cur;
    broadcast();
  }
}, 2000);

// Safety-net: broadcast full snapshot unconditionally every 5s
setInterval(broadcast, 5000);

// Periodic DB persistence (every 30 seconds)
setInterval(periodicPersist, 30000);

// Heartbeat for frontend WebSocket connections — send ping frames every 25s
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.ping();
  });
}, 25000);

// Start OKX WebSocket
startWs();

// Fetch initial candles for all timeframes
for (const bar of CHART_BARS) {
  fetchCandlesForBar(bar, 150);
}

// Periodically refresh all timeframes via REST
setInterval(async () => {
  for (const bar of CHART_BARS) {
    await refreshCandlesForBar(bar);
  }
}, 30000);

// Start strategy runner (replaces old auto-trader)
strategyRunner.startRunner();

// ---- Listen ----

server.listen(cfg.port, () => {
  console.log(`[main] Server running on http://localhost:${cfg.port}`);
});
