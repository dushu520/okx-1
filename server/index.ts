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
import {
  startTradingEngine,
  checkPositions,
  periodicPersist,
} from "./trading-engine.js";
import { startAutoTrader } from "./auto-trader.js";
import { fetchInitialCandles, refreshCandles, getCandlesForChart, getCurrentCandle } from "./market-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = getConfig();

// ---- Helpers ----

function buildSnapshot(): any {
  const snap = state.getSnapshot();
  snap.candles = getCandlesForChart(50);
  const cc = getCurrentCandle();
  snap.current_candle = cc ? { time: Math.floor(cc.ts / 1000), open: cc.open, high: cc.high, low: cc.low, close: cc.close, volume: cc.volume } : null;
  return snap;
}

function broadcast(): void {
  const data = JSON.stringify(buildSnapshot());
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

// ---- Startup ----

initDb();
startTradingEngine(); // loads DB state into memory

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
  ws.on("close", () => console.log(`[ws] Frontend disconnected (${wss.clients.size})`));
});

// ---- Real-time data flow ----
// OKX WS price tick → check positions in memory → if price changed → broadcast

let lastPrice = 0;
let lastATJson = "";

onPrice(() => {
  const price = state.currentPrice;

  // Check positions (purely in-memory, no DB)
  checkPositions(price);

  // Only push to frontend when price actually changed
  if (price !== lastPrice) {
    lastPrice = price;
    broadcast();
  }
});

// Broadcast auto-trader state changes to frontend (runs in-between price ticks)
setInterval(() => {
  const cur = JSON.stringify(state.autoTraderState);
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
// to keep connections alive through proxies / load balancers
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.ping();
  });
}, 25000);

// Start OKX WebSocket
startWs();

// Fetch initial 5m candles for indicator calculations
fetchInitialCandles();

// Periodically refresh 5m candles via REST (30s poll, candle changes every 5min)
setInterval(refreshCandles, 30000);

// Start auto-trader (降频: checks every 3s once data is ready)
startAutoTrader();

// ---- Listen ----

server.listen(cfg.port, () => {
  console.log(`[main] Server running on http://localhost:${cfg.port}`);
});
