/**
 * Trading engine: position lifecycle, TP/SL checks, persistence.
 * Now multi-account aware — each account has its own positions and balance.
 */

import { state } from "./shared-state.js";
import * as db from "./db.js";
import * as accountManager from "./account-manager.js";
import { getStrategyConfig, getAutoTraderState, updateAutoTraderState } from "./account-manager.js";

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

// ---- Position lifecycle ----

/** Open a position for a specific account */
export function openTrade(
  entryPrice: number,
  margin: number,
  leverage: number,
  positionValue: number,
  side: string = "long",
  instId = "BTC-USDT",
  accountId = 1,
): number {
  const id = db.createTrade(side, entryPrice, margin, positionValue, leverage, instId, accountId);
  const pos: MemPosition = {
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
  };
  accountManager.addPosition(accountId, pos);

  // Deduct margin from account balance
  const acct = accountManager.getAccount(accountId);
  if (acct) {
    accountManager.updateBalance(accountId, acct.balance - margin, acct.totalPnl);
  }

  persistAccount(accountId);

  const label = side === "short" ? "SHORT" : "BUY";
  console.log(`[trade] ${label} #${id} (acct #${accountId}): price=${entryPrice} margin=${margin} pos=${positionValue}`);
  return id;
}

/** Close a position manually */
export function manualClose(
  tradeId: number,
  exitPrice: number,
  reason: string = "manual",
  accountId?: number,
): { pnl: number; pnlPct: number } | null {
  // Try to find the position — if accountId provided, check that account; otherwise check all
  if (accountId !== undefined) {
    return closeFromAccount(tradeId, exitPrice, reason, accountId);
  }
  // Search all accounts
  for (const a of accountManager.getAllAccounts()) {
    const result = closeFromAccount(tradeId, exitPrice, reason, a.id);
    if (result) return result;
  }
  return null;
}

function closeFromAccount(
  tradeId: number,
  exitPrice: number,
  reason: string,
  accountId: number,
): { pnl: number; pnlPct: number } | null {
  const pos = accountManager.getPositions(accountId).find((p) => p.id === tradeId);
  if (!pos) return null;
  const { pnl, pnlPct } = calcPnl(pos.side, pos.entryPrice, exitPrice, pos.margin, pos.leverage);
  closePosition(accountId, tradeId, exitPrice, pnl, pnlPct, reason);
  return { pnl, pnlPct };
}

function closePosition(
  accountId: number,
  tradeId: number,
  exitPrice: number,
  pnl: number,
  pnlPct: number,
  reason: string,
) {
  const pos = accountManager.removePosition(accountId, tradeId);
  if (!pos) return;

  const acct = accountManager.getAccount(accountId)!;

  // Update account
  const newBalance = acct.balance + pos.margin + pnl;
  const newTotalPnl = acct.totalPnl + pnl;
  accountManager.updateBalance(accountId, newBalance, newTotalPnl);

  // Update stats
  const stats = {
    totalTrades: acct.totalTrades + 1,
    winningTrades: acct.winningTrades + (pnl > 0 ? 1 : 0),
    losingTrades: acct.losingTrades + (pnl <= 0 ? 1 : 0),
    totalVolume: acct.totalVolume + pos.positionValue,
    totalTurnover: acct.totalTurnover + pos.positionValue,
  };
  accountManager.updateStats(accountId, stats);

  // Build closed trade record
  const risk = getStrategyConfig(accountId).risk;
  const isLong = pos.side === "long";
  let stopLossPrice: number, takeProfitPrice = 0, isActivated = false;
  if (isLong) {
    stopLossPrice = pos.entryPrice * (1 - risk.stop_loss_pct / pos.leverage);
    const activationPrice = pos.entryPrice * (1 + risk.take_profit_activation_pct / pos.leverage);
    isActivated = risk.take_profit_activation_pct > 0 && pos.highestPrice >= activationPrice;
    if (risk.take_profit_activation_pct > 0) {
      takeProfitPrice = isActivated
        ? pos.entryPrice + (pos.highestPrice - pos.entryPrice) * (1 - risk.take_profit_pullback)
        : activationPrice;
    }
  } else {
    stopLossPrice = pos.entryPrice * (1 + risk.stop_loss_pct / pos.leverage);
    const activationPrice = pos.entryPrice * (1 - risk.take_profit_activation_pct / pos.leverage);
    isActivated = risk.take_profit_activation_pct > 0 && pos.lowestPrice <= activationPrice;
    if (risk.take_profit_activation_pct > 0) {
      takeProfitPrice = isActivated
        ? pos.entryPrice - (pos.entryPrice - pos.lowestPrice) * (1 - risk.take_profit_pullback)
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

  accountManager.addRecentTrade(accountId, closed);

  // Persist
  db.closeTrade(pos.id, exitPrice, pnl, pnlPct, reason);
  persistAccount(accountId);

  console.log(
    `[engine] ${reason.toUpperCase()} #${pos.id} (acct #${accountId}): entry=${pos.entryPrice} exit=${exitPrice} pnl=${pnl} (${pnlPct}%)`,
  );
}

// ---- Price-tick check (hot path, no DB) ----

let lastCheckPrice = 0;

/** Check all open positions across all accounts against current price */
export function checkPositions(price: number): boolean {
  if (price <= 0) return false;
  lastCheckPrice = price;
  let didTrade = false;

  for (const acct of accountManager.getAllAccounts()) {
    const risk = getStrategyConfig(acct.id).risk;
    const positions = acct.positions;

    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];

      if (pos.side === "long") {
        // Track high-water mark
        if (price > pos.highestPrice) pos.highestPrice = price;

        const stopPrice = pos.entryPrice * (1 - risk.stop_loss_pct / pos.leverage);
        const activationPrice = pos.entryPrice * (1 + risk.take_profit_activation_pct / pos.leverage);
        const isActivated = pos.highestPrice >= activationPrice;
        const trailPrice = pos.entryPrice + (pos.highestPrice - pos.entryPrice) * (1 - risk.take_profit_pullback);

        if (price <= stopPrice) {
          const { pnl, pnlPct } = calcPnl("long", pos.entryPrice, price, pos.margin, pos.leverage);
          closePosition(acct.id, pos.id, price, pnl, pnlPct, "stop_loss");
          didTrade = true;
        } else if (isActivated && price <= trailPrice && trailPrice > pos.entryPrice) {
          const { pnl, pnlPct } = calcPnl("long", pos.entryPrice, price, pos.margin, pos.leverage);
          closePosition(acct.id, pos.id, price, pnl, pnlPct, "take_profit");
          didTrade = true;
        }
      } else {
        // Short position
        if (price < pos.lowestPrice) pos.lowestPrice = price;

        const stopPrice = pos.entryPrice * (1 + risk.stop_loss_pct / pos.leverage);
        const activationPrice = pos.entryPrice * (1 - risk.take_profit_activation_pct / pos.leverage);
        const isActivated = risk.take_profit_activation_pct > 0 && pos.lowestPrice <= activationPrice;
        const trailPrice = pos.entryPrice - (pos.entryPrice - pos.lowestPrice) * (1 - risk.take_profit_pullback);

        if (price >= stopPrice) {
          const { pnl, pnlPct } = calcPnl("short", pos.entryPrice, price, pos.margin, pos.leverage);
          closePosition(acct.id, pos.id, price, pnl, pnlPct, "stop_loss");
          didTrade = true;
        } else if (isActivated && price >= trailPrice && trailPrice < pos.entryPrice) {
          const { pnl, pnlPct } = calcPnl("short", pos.entryPrice, price, pos.margin, pos.leverage);
          closePosition(acct.id, pos.id, price, pnl, pnlPct, "take_profit");
          didTrade = true;
        }
      }
    }
  }

  return didTrade;
}

/** Compute position views for a specific account (for frontend display) */
export function computePositionViews(accountId: number, currentPrice: number): any[] {
  const acct = accountManager.getAccount(accountId);
  if (!acct) return [];

  const risk = getStrategyConfig(accountId).risk;

  return acct.positions.map((p) => {
    const isLong = p.side === "long";
    const marketValue = currentPrice > 0
      ? (isLong ? (p.positionValue / p.entryPrice) * currentPrice
                : p.positionValue + (p.entryPrice - currentPrice) / p.entryPrice * p.positionValue)
      : p.positionValue;
    const upnl = currentPrice > 0 ? marketValue - p.positionValue : 0;

    let stopLossPrice: number, takeProfitPrice = 0, isActivated = false;
    if (isLong) {
      stopLossPrice = p.entryPrice * (1 - risk.stop_loss_pct / p.leverage);
      const activationPrice = p.entryPrice * (1 + risk.take_profit_activation_pct / p.leverage);
      isActivated = risk.take_profit_activation_pct > 0 && p.highestPrice >= activationPrice;
      if (risk.take_profit_activation_pct > 0) {
        takeProfitPrice = isActivated
          ? p.entryPrice + (p.highestPrice - p.entryPrice) * (1 - risk.take_profit_pullback)
          : activationPrice;
      }
    } else {
      stopLossPrice = p.entryPrice * (1 + risk.stop_loss_pct / p.leverage);
      const activationPrice = p.entryPrice * (1 - risk.take_profit_activation_pct / p.leverage);
      isActivated = risk.take_profit_activation_pct > 0 && p.lowestPrice <= activationPrice;
      if (risk.take_profit_activation_pct > 0) {
        takeProfitPrice = isActivated
          ? p.entryPrice - (p.entryPrice - p.lowestPrice) * (1 - risk.take_profit_pullback)
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
}

// ---- Persistence ----

let lastPersistTime = Date.now();

function persistAccount(accountId: number): void {
  accountManager.persistAccount(accountId);
}

function persistAllExtremePrices(): void {
  for (const acct of accountManager.getAllAccounts()) {
    accountManager.persistExtremePrices(acct.id);
  }
}

/** Periodic: persist extreme prices + account/stats to DB */
export function periodicPersist(): void {
  persistAllExtremePrices();
  if (Date.now() - lastPersistTime >= PERSIST_INTERVAL) {
    for (const acct of accountManager.getAllAccounts()) {
      accountManager.persistAccount(acct.id);
    }
    lastPersistTime = Date.now();
  }
}

// ---- Startup ----

/** Load all account state from DB into memory */
export function loadState(): void {
  accountManager.loadAccountsFromDb();

  // Log summary
  for (const acct of accountManager.getAllAccounts()) {
    const full = accountManager.getAccount(acct.id);
    console.log(
      `[engine] Account #${acct.id} "${acct.name}": balance=$${acct.balance} positions=${full?.positions.length ?? 0} trades=${acct.totalTrades}`,
    );
  }

  lastPersistTime = Date.now();
}

export function startTradingEngine(): void {
  loadState();
  const risk = getStrategyConfig(accountManager.getActiveAccountId()).risk;
  const pp = (risk.stop_loss_pct / risk.leverage * 100).toFixed(1);
  const tp = (risk.take_profit_pullback * 100).toFixed(1);
  console.log(`[engine] Ready: stop=${pp}% price drop, trail=give back ${tp}% of profit`);
}
