import WebSocket from "ws";
import { getConfig } from "./config.js";
import { state } from "./shared-state.js";
import * as marketData from "./market-data.js";

const cfg = getConfig();
const logger = {
  info: (msg: string) => console.log(`[okx-ws] ${msg}`),
  warn: (msg: string) => console.warn(`[okx-ws] ${msg}`),
  error: (msg: string) => console.error(`[okx-ws] ${msg}`),
};

export type PriceCallback = (price: number) => void;
let priceCallback: PriceCallback | null = null;

export function onPrice(cb: PriceCallback): void {
  priceCallback = cb;
}

/** Create a single WS connection with auto-reconnect and heartbeat. */
function createConnection(
  url: string,
  channels: { channel: string; instId: string }[],
  onMessage: (channel: string, data: any) => void,
  opts?: { onConnected?: () => void; onDisconnected?: () => void }
): void {
  let backoff = 0.5;
  const maxBackoff = 30;
  let consecutiveFailures = 0;

  function connect(): void {
    let lastMessageTime = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let staleTimer: ReturnType<typeof setInterval> | null = null;

    function stopHeartbeat() {
      if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null; }
      if (staleTimer !== null) { clearInterval(staleTimer); staleTimer = null; }
    }

    const ws = new WebSocket(url);

    ws.on("open", () => {
      logger.info(`Connected to ${url.replace(/wss?:\/\//, "").split("/")[0]}`);
      opts?.onConnected?.();
      consecutiveFailures = 0;
      backoff = 0.5;
      lastMessageTime = Date.now();

      ws.send(JSON.stringify({ op: "subscribe", args: channels }));

      // Send ping every 20s to keep OKX connection alive
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 20000);

      // If no data received for 35s, force reconnect
      staleTimer = setInterval(() => {
        if (Date.now() - lastMessageTime > 35000) {
          logger.warn("No data for 35s, force reconnecting...");
          opts?.onDisconnected?.();
          ws.close();
        }
      }, 15000);
    });

    ws.on("message", (raw) => {
      lastMessageTime = Date.now();
      try {
        const text = raw.toString();
        if (text === "pong") return;

        const msg = JSON.parse(text);
        if (msg.event === "subscribe") {
          logger.info(`Subscribed to ${msg.arg?.channel ?? "?"}`);
          return;
        }
        if (msg.event === "error") {
          logger.error(`Subscribe error: ${JSON.stringify(msg)}`);
          return;
        }

        const channel = msg.arg?.channel;
        const data = msg.data;
        if (channel && data?.[0]) {
          onMessage(channel, data);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      stopHeartbeat();
      opts?.onDisconnected?.();
      consecutiveFailures++;
      if (consecutiveFailures <= 3) {
        backoff = 0.5;
      } else {
        backoff = Math.min(backoff * 2, maxBackoff);
      }
      logger.warn(
        `WS disconnected (${url.split("/")[2]}). Reconnecting in ${backoff}s (attempt #${consecutiveFailures})...`
      );
      setTimeout(connect, backoff * 1000);
    });

    ws.on("error", (err) => {
      logger.error(`WS error (${url.split("/")[2]}): ${err.message}`);
      ws.close();
    });
  }

  connect();
}

/** Start public WebSocket connection for tickers + order book. */
export function startWs(): void {
  createConnection(
    "wss://ws.okx.com:443/ws/v5/public",
    [
      { channel: "tickers", instId: "BTC-USDT" },
      { channel: "tickers", instId: "BTC-USDT-SWAP" },
      { channel: "books5", instId: "BTC-USDT" },
    ],
    (channel, data) => {
      if (channel === "tickers" && data[0]?.last) {
        const price = parseFloat(data[0].last);
        if (!isNaN(price) && price > 0) {
          const instId = data[0].instId;
          if (instId === "BTC-USDT-SWAP") {
            state.swapPrice = price;
          } else {
            marketData.recordPriceTick(price);
            state.currentPrice = price;
            state.currentTime = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
            state.priceUpdatedAt = Date.now();
            priceCallback?.(price);
          }
        }
      } else if (channel === "books5") {
        marketData.updateBids(data[0].bids ?? []);
        marketData.updateAsks(data[0].asks ?? []);
      }
    },
    {
      onConnected: () => { state.wsConnected = true; },
      onDisconnected: () => { state.wsConnected = false; },
    }
  );
}
