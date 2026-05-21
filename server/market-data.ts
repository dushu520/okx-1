/**
 * Market data store: order book, candles, price ticks, and indicators.
 */
import { getConfig } from "./config.js";

const cfg = getConfig();

// ---- Types ----

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---- Order book ----

let bids: OrderBookLevel[] = [];
let asks: OrderBookLevel[] = [];

export function updateBids(raw: string[][]): void {
  bids = raw.map(([p, sz]) => ({ price: parseFloat(p), size: parseFloat(sz) }));
}
export function updateAsks(raw: string[][]): void {
  asks = raw.map(([p, sz]) => ({ price: parseFloat(p), size: parseFloat(sz) }));
}

/** Order-book imbalance ratio (raw volume): sumBidVol / sumAskVol (>1 = buy pressure) */
export function getImbalance(): number {
  const bidVol = bids.reduce((s, l) => s + l.size, 0);
  const askVol = asks.reduce((s, l) => s + l.size, 0);
  if (askVol === 0) return 1;
  return bidVol / askVol;
}

/**
 * Weighted order-book imbalance.
 * Closer levels get higher weight: level 1→5, level 2→4, ... level 5→1.
 * This amplifies the impact of near-price liquidity.
 */
export function getWeightedImbalance(): number {
  const weight = (idx: number) => Math.max(bids.length - idx, 1);
  const bidVol = bids.reduce((s, l, i) => s + l.size * weight(i), 0);
  const askVol = asks.reduce((s, l, i) => s + l.size * weight(i), 0);
  if (askVol === 0) return 1;
  return bidVol / askVol;
}

export function getBids(): OrderBookLevel[] { return bids; }
export function getAsks(): OrderBookLevel[] { return asks; }

// ---- Candles ----

let confirmedCandles: Candle[] = [];   // closed candles
let currentCandle: Candle | null = null; // forming candle

export function getConfirmedCandles(): Candle[] {
  return confirmedCandles;
}

// ---- Price sampling (1s interval for momentum detection) ----

const SAMPLE_MS = 1000;
let priceSamples: number[] = [];
let lastSample = 0;

export function recordPriceTick(price: number): void {
  const now = Date.now();
  if (now - lastSample >= SAMPLE_MS) {
    priceSamples.push(price);
    if (priceSamples.length > 30) priceSamples.shift();
    lastSample = now;
  }
}

/** Check if the last N price samples are consecutively rising or falling. */
export function checkMomentum(direction: "up" | "down", ticks: number): boolean {
  if (priceSamples.length < ticks) return false;
  const recent = priceSamples.slice(-ticks);
  for (let i = 1; i < recent.length; i++) {
    if (direction === "up" && recent[i] <= recent[i - 1]) return false;
    if (direction === "down" && recent[i] >= recent[i - 1]) return false;
  }
  return true;
}

export function getLastPriceSample(): number {
  return priceSamples.length > 0 ? priceSamples[priceSamples.length - 1] : 0;
}

export function getPriceSampleCount(): number {
  return priceSamples.length;
}

// ---- Indicators ----

/** RSI using confirmed candle closes. */
export function calcRSI(period: number): number {
  const closes = confirmedCandles.map((c) => c.close);
  if (closes.length < period + 1) return 50; // neutral default

  const recentCloses = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recentCloses.length; i++) {
    const diff = recentCloses[i] - recentCloses[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100; // no losses in period → max bullish
  const rs = gains / period / (losses / period);
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/** Average volume of the last N confirmed candles. */
export function calcVolumeAvg(period: number): number {
  if (confirmedCandles.length < period) return 0;
  const recent = confirmedCandles.slice(-period);
  const total = recent.reduce((s, c) => s + c.volume, 0);
  return total / period;
}

/** Latest forming candle's volume (or 0 if none). */
export function getCurrentVolume(): number {
  return currentCandle?.volume ?? 0;
}

export function getLatestCandle(): Candle | null {
  return confirmedCandles.length > 0
    ? confirmedCandles[confirmedCandles.length - 1]
    : currentCandle;
}

export function getCurrentCandle(): Candle | null {
  return currentCandle;
}

/** Get confirmed candles formatted for frontend (last N, light-weight). */
export function getCandlesForChart(n: number): any[] {
  // Deduplicate by timestamp (WS may push same candle multiple times)
  const seen = new Set<number>();
  const unique: Candle[] = [];
  for (let i = confirmedCandles.length - 1; i >= 0 && unique.length < n; i--) {
    const c = confirmedCandles[i];
    if (!seen.has(c.ts)) {
      seen.add(c.ts);
      unique.unshift(c);
    }
  }
  return unique.map((c) => ({
    time: Math.floor(c.ts / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/** Check if we have enough data to start the auto-trader. */
export function hasEnoughData(): boolean {
  return (
    bids.length > 0 &&
    asks.length > 0 &&
    confirmedCandles.length >= 11 && // need 10 for volume avg + 1 for RSI
    priceSamples.length >= 3
  );
}

// ---- REST fetch for candles (5m via polling, no WS) ----

const BAR = "5m";
const MAX_CANDLES = 50;

/** Internal: fetch candles from OKX REST API. */
async function fetchFromREST(limit: number): Promise<string[][] | null> {
  try {
    const url = `${cfg.restBase}/api/v5/market/candles?instId=BTC-USDT&bar=${BAR}&limit=${limit}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data: any = await resp.json();
    if (data.code === "0" && Array.isArray(data.data)) return data.data;
  } catch { /* ignore */ }
  return null;
}

/** Parse a raw OKX candle array (9 elements) into a Candle. */
function parseCandle(arr: string[]): Candle {
  const [ts, o, h, l, c, vol] = arr;
  return { ts: parseInt(ts), open: parseFloat(o), high: parseFloat(h), low: parseFloat(l), close: parseFloat(c), volume: parseFloat(vol) };
}

/** Initial fetch: load 50 5m candles at startup. */
export async function fetchInitialCandles(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = await fetchFromREST(50);
    if (!raw) { await new Promise((r) => setTimeout(r, 2000)); continue; }

    // REST returns newest-first; reverse to chronological
    // Separate confirmed candles from the forming one
    const confirmed = raw.filter((a) => a[8] === "1").reverse();
    confirmedCandles = confirmed.map(parseCandle);

    const forming = raw.find((a) => a[8] === "0");
    currentCandle = forming ? parseCandle(forming) : null;

    console.log(`[market-data] Loaded ${confirmedCandles.length} 5m candles`);
    return;
  }
  console.warn(`[market-data] Failed to fetch initial candles after 3 attempts`);
}

/** Periodic refresh: fetch latest 5 candles and merge into store. */
export async function refreshCandles(): Promise<void> {
  const raw = await fetchFromREST(5);
  if (!raw) return;

  // raw is newest-first; iterate oldest-first so newer data overwrites older
  for (let i = raw.length - 1; i >= 0; i--) {
    const arr = raw[i];
    const candle = parseCandle(arr);

    if (arr[8] === "1") {
      // Confirmed candle: update in-place or append
      const last = confirmedCandles[confirmedCandles.length - 1];
      if (last && last.ts === candle.ts) {
        confirmedCandles[confirmedCandles.length - 1] = candle;
      } else if (!last || candle.ts > last.ts) {
        confirmedCandles.push(candle);
        if (confirmedCandles.length > MAX_CANDLES) confirmedCandles.shift();
      }
    } else {
      currentCandle = candle;
    }
  }
}
