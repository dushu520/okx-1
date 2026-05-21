import { state } from "./shared-state.js";
import { settings, loadSettings } from "./settings.js";
import * as db from "./db.js";

const PERSIST_INTERVAL = 30000;

// ---- Types ----

interface MemPosition {
  id: number;
  side: string;
  entryPrice: number;
  margin: number;
  leverage: number;
  positionValue: number;
  highestPrice: number;
  lowestPrice: number;
  entryTime: string;
  instId: string;
}

// ---- In-memory state (zero DB reads on hot path) ----

const openPositions: MemPosition[] = [];
let recentClosedTrades: any[] = [];
let nextId = 1;
let lastPersistTime = Date.now();

// ---- Helpers ----

export function calcPnl(
  side: string,
  entryPrice: number,
  exitPrice: number,
  margin: number,
  leverage: number,
): { pnl: number; pnlPct: number } {
  if (entryPrice <= 0) return { pnl: 0, pnlPct: 0 };
  const pct = (exitPrice - entryPrice) / entryPrice;
  const pnlPct = side === "long" ? pct * leverage * 100 : -pct * leverage * 100;
  const pnl = margin * (pnlPct / 100);
  return { pnl: Math.round(pnl * 100) / 100, pnlPct: Math.round(pnlPct * 100) / 100 };
}

function nowStr(): string {
  const d = new Date();
  const beijing = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().replace("T", " ").slice(0, 19);
}

/** Sync in-memory state → shared state (for frontend broadcast) */
function syncStateFromMemory() {
  state.balance = Math.round(state.balance * 100) / 100;

  // Compute positions with current market data
  const cp = state.currentPrice;
  let totalPositionValue = 0;
  let totalUnrealizedPnl = 0;
  state.positions = openPositions.map((p) => {
    const isLong = p.side === "long";
    // For long: marketValue = posValue * (cur/entry); for short: inverse
    const marketValue = cp > 0
      ? (isLong ? (p.positionValue / p.entryPrice) * cp
                : p.positionValue + (p.entryPrice - cp) / p.entryPrice * p.positionValue)
      : p.positionValue;
    const upnl = cp > 0 ? marketValue - p.positionValue : 0;
    totalPositionValue += marketValue;
    totalUnrealizedPnl += upnl;

    // TP/SL prices
    let stopLossPrice: number, takeProfitPrice = 0, isActivated = false;
    if (isLong) {
      stopLossPrice = p.entryPrice * (1 - settings.stopLossPct / p.leverage);
      const activationPrice = p.entryPrice * (1 + settings.takeProfitActivationPct / p.leverage);
      isActivated = settings.takeProfitActivationPct > 0 && p.highestPrice >= activationPrice;
      if (settings.takeProfitActivationPct > 0) {
        takeProfitPrice = isActivated
          ? p.entryPrice + (p.highestPrice - p.entryPrice) * (1 - settings.takeProfitPullback)
          : activationPrice;
      }
    } else {
      // Short: SL when price rises above entry, TP when price falls
      stopLossPrice = p.entryPrice * (1 + settings.stopLossPct / p.leverage);
      const activationPrice = p.entryPrice * (1 - settings.takeProfitActivationPct / p.leverage);
      isActivated = settings.takeProfitActivationPct > 0 && p.lowestPrice <= activationPrice;
      if (settings.takeProfitActivationPct > 0) {
        takeProfitPrice = isActivated
          ? p.entryPrice - (p.entryPrice - p.lowestPrice) * (1 - settings.takeProfitPullback)
          : activationPrice;
      }
    }

    return {
      id: p.id,
      side: p.side,
      entry_price: p.entryPrice,
      margin: p.margin,
      leverage: p.leverage,
      position_value: p.positionValue,
      market_value: Math.round(marketValue * 100) / 100,
      unrealized_pnl: Math.round(upnl * 100) / 100,
      unrealized_pnl_pct: p.margin > 0 ? Math.round((upnl / p.margin) * 10000) / 100 : 0,
      highest_price: p.highestPrice,
      lowest_price: p.lowestPrice,
      entry_time: p.entryTime,
      inst_id: p.instId,
      status: "open",
      stop_loss_price: Math.round(stopLossPrice * 100) / 100,
      take_profit_price: Math.round(takeProfitPrice * 100) / 100,
      take_profit_activated: isActivated,
    };
  });
  state.totalPositionValue = Math.round(totalPositionValue * 100) / 100;
  state.totalUnrealizedPnl = Math.round(totalUnrealizedPnl * 100) / 100;
  state.recentTrades = recentClosedTrades;
}

// ---- Persistence ----

function persistNow() {
  db.updateAccount(state.balance, state.totalPnl);
  db.updateStats(
    state.totalTrades, state.winningTrades, state.losingTrades,
    state.totalVolume, state.totalTurnover,
  );
  lastPersistTime = Date.now();
}

function persistExtremePrices() {
  for (const p of openPositions) {
    db.updateHighestPrice(p.id, p.highestPrice);
    db.updateLowestPrice(p.id, p.lowestPrice);
  }
}

/** Periodic: persist highest_price + account/stats to DB */
export function periodicPersist() {
  persistExtremePrices();
  if (Date.now() - lastPersistTime >= PERSIST_INTERVAL) {
    persistNow();
  }
}

// ---- Position lifecycle ----

/** Open a position (called from routes on manual buy / auto-trader) */
export function openTrade(
  entryPrice: number,
  margin: number,
  leverage: number,
  positionValue: number,
  side: string = "long",
  instId = "BTC-USDT",
): number {
  const id = db.createTrade(side, entryPrice, margin, positionValue, leverage, instId);
  openPositions.push({
    id,
    side,
    entryPrice,
    margin,
    leverage,
    positionValue,
    highestPrice: entryPrice,
    lowestPrice: entryPrice,
    entryTime: nowStr(),
    instId,
  });
  state.balance -= margin;
  if (id >= nextId) nextId = id + 1;
  syncStateFromMemory();
  persistNow();
  const label = side === "short" ? "SHORT" : "BUY";
  console.log(`[trade] ${label} #${id}: price=${entryPrice} margin=${margin} pos=${positionValue}`);
  return id;
}

/** Manually close a position (called from routes) */
export function manualClose(tradeId: number, exitPrice: number): { pnl: number; pnlPct: number } | null {
  const idx = openPositions.findIndex((p) => p.id === tradeId);
  if (idx === -1) return null;
  const pos = openPositions[idx];
  const { pnl, pnlPct } = calcPnl(pos.side, pos.entryPrice, exitPrice, pos.margin, pos.leverage);
  closePosition(idx, exitPrice, pnl, pnlPct, "manual");
  return { pnl, pnlPct };
}

function closePosition(
  idx: number,
  exitPrice: number,
  pnl: number,
  pnlPct: number,
  reason: string,
) {
  const pos = openPositions[idx];
  openPositions.splice(idx, 1);

  // Update account
  state.balance += pos.margin + pnl;
  state.totalPnl += pnl;

  // Update stats
  state.totalTrades++;
  if (pnl > 0) state.winningTrades++;
  else state.losingTrades++;
  state.totalVolume += pos.positionValue;
  state.totalTurnover += pos.positionValue;

  // Add to recent-closed list
  const isLong = pos.side === "long";
  let stopLossPrice: number, takeProfitPrice = 0, isActivated = false;
  if (isLong) {
    stopLossPrice = pos.entryPrice * (1 - settings.stopLossPct / pos.leverage);
    const activationPrice = pos.entryPrice * (1 + settings.takeProfitActivationPct / pos.leverage);
    isActivated = settings.takeProfitActivationPct > 0 && pos.highestPrice >= activationPrice;
    if (settings.takeProfitActivationPct > 0) {
      takeProfitPrice = isActivated
        ? pos.entryPrice + (pos.highestPrice - pos.entryPrice) * (1 - settings.takeProfitPullback)
        : activationPrice;
    }
  } else {
    stopLossPrice = pos.entryPrice * (1 + settings.stopLossPct / pos.leverage);
    const activationPrice = pos.entryPrice * (1 - settings.takeProfitActivationPct / pos.leverage);
    isActivated = settings.takeProfitActivationPct > 0 && pos.lowestPrice <= activationPrice;
    if (settings.takeProfitActivationPct > 0) {
      takeProfitPrice = isActivated
        ? pos.entryPrice - (pos.entryPrice - pos.lowestPrice) * (1 - settings.takeProfitPullback)
        : activationPrice;
    }
  }
  const closed = {
    id: pos.id,
    side: pos.side,
    entry_price: pos.entryPrice,
    exit_price: exitPrice,
    margin: pos.margin,
    leverage: pos.leverage,
    position_value: pos.positionValue,
    inst_id: pos.instId,
    pnl,
    pnl_percent: pnlPct,
    status: "closed",
    entry_time: pos.entryTime,
    exit_time: nowStr(),
    exit_reason: reason,
    stop_loss_price: Math.round(stopLossPrice * 100) / 100,
    take_profit_price: Math.round(takeProfitPrice * 100) / 100,
    take_profit_activated: isActivated,
  };
  recentClosedTrades.unshift(closed);
  if (recentClosedTrades.length > 20) recentClosedTrades.pop();

  syncStateFromMemory();
  persistNow();
  db.closeTrade(pos.id, exitPrice, pnl, pnlPct, reason);

  console.log(
    `[engine] ${reason.toUpperCase()} #${pos.id}: entry=${pos.entryPrice} exit=${exitPrice} pnl=${pnl} (${pnlPct}%)`,
  );
}

// ---- Price-tick check (hot path, no DB) ----

let lastCheckPrice = 0;

/** Check all open positions against current price. Returns true if any trade closed. */
export function checkPositions(price: number): boolean {
  if (price <= 0) return false;
  lastCheckPrice = price;
  let didTrade = false;

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];

    if (pos.side === "long") {
      // Track high-water mark
      if (price > pos.highestPrice) pos.highestPrice = price;

      // Long stop: price drops below entry
      const stopPrice = pos.entryPrice * (1 - settings.stopLossPct / pos.leverage);
      const activationPrice =
        pos.entryPrice * (1 + settings.takeProfitActivationPct / pos.leverage);
      const isActivated = pos.highestPrice >= activationPrice;
      const trailPrice =
        pos.entryPrice + (pos.highestPrice - pos.entryPrice) * (1 - settings.takeProfitPullback);

      if (price <= stopPrice) {
        const { pnl, pnlPct } = calcPnl("long", pos.entryPrice, price, pos.margin, pos.leverage);
        closePosition(i, price, pnl, pnlPct, "stop_loss");
        didTrade = true;
      } else if (isActivated && price <= trailPrice && trailPrice > pos.entryPrice) {
        const { pnl, pnlPct } = calcPnl("long", pos.entryPrice, price, pos.margin, pos.leverage);
        closePosition(i, price, pnl, pnlPct, "take_profit");
        didTrade = true;
      }

    } else {
      // Short position
      // Track low-water mark (lowest price reached)
      if (price < pos.lowestPrice) pos.lowestPrice = price;

      // Short stop: price rises above entry
      const stopPrice = pos.entryPrice * (1 + settings.stopLossPct / pos.leverage);
      const activationPrice =
        pos.entryPrice * (1 - settings.takeProfitActivationPct / pos.leverage);
      const isActivated = settings.takeProfitActivationPct > 0 && pos.lowestPrice <= activationPrice;
      const trailPrice =
        pos.entryPrice - (pos.entryPrice - pos.lowestPrice) * (1 - settings.takeProfitPullback);

      if (price >= stopPrice) {
        const { pnl, pnlPct } = calcPnl("short", pos.entryPrice, price, pos.margin, pos.leverage);
        closePosition(i, price, pnl, pnlPct, "stop_loss");
        didTrade = true;
      } else if (isActivated && price >= trailPrice && trailPrice < pos.entryPrice) {
        const { pnl, pnlPct } = calcPnl("short", pos.entryPrice, price, pos.margin, pos.leverage);
        closePosition(i, price, pnl, pnlPct, "take_profit");
        didTrade = true;
      }
    }
  }

  if (didTrade) syncStateFromMemory();
  return didTrade;
}

// ---- Startup ----

/** Load persisted state from DB into memory */
export function loadState(): void {
  const acct = db.getAccount();
  if (acct) {
    state.balance = acct.balance;
    state.totalPnl = acct.total_pnl;
  }

  const stats = db.getStats();
  if (stats) {
    state.totalTrades = stats.total_trades;
    state.winningTrades = stats.winning_trades;
    state.losingTrades = stats.losing_trades;
    state.totalVolume = stats.total_volume;
    state.totalTurnover = stats.total_turnover;
  }

  // Load open positions into memory
  const rows = db.getOpenPositions();
  openPositions.length = 0;
  for (const r of rows) {
    openPositions.push({
      id: r.id,
      side: r.side,
      entryPrice: r.entry_price,
      margin: r.margin,
      leverage: r.leverage,
      positionValue: r.position_value,
      highestPrice: r.highest_price ?? r.entry_price,
      lowestPrice: r.lowest_price ?? r.entry_price,
      entryTime: r.entry_time,
      instId: r.inst_id ?? "BTC-USDT",
    });
    if (r.id >= nextId) nextId = r.id + 1;
  }

  recentClosedTrades = db.getClosedTrades(20);
  syncStateFromMemory();
  lastPersistTime = Date.now();

  console.log(
    `[engine] Loaded: balance=$${state.balance} positions=${openPositions.length} trades=${state.totalTrades}`,
  );
}

export function startTradingEngine(): void {
  loadSettings();
  loadState();
  const pp = (settings.stopLossPct / settings.leverage * 100).toFixed(1);
  const tp = (settings.takeProfitPullback * 100).toFixed(1);
  console.log(`[engine] Ready: stop=${pp}% price drop, trail=give back ${tp}% of profit`);
}
