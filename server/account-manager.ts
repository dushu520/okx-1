/**
 * Account manager: multi-account state, switching, and persistence.
 *
 * Each account has its own:
 *  - Balance sheet (balance, initialBalance, totalPnl)
 *  - Trade stats (trades, wins, losses, volume)
 *  - Positions (open positions + recent closed trades)
 *  - Strategy configuration
 */

import * as db from "./db.js";
import type { StrategyConfig } from "./strategy.js";

// ---- Per-account in-memory state ----

export interface MemPosition {
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

export interface AccountState {
  id: number;
  name: string;
  balance: number;
  initialBalance: number;
  totalPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalVolume: number;
  totalTurnover: number;
  positions: MemPosition[];
  recentTrades: any[];
  autoTraderState: AutoTraderState;
  strategyConfig: StrategyConfig;
}

export interface AutoTraderState {
  running: boolean;
  has_position: boolean;
  position_id: number | null;
  side: string | null;
  imbalance: number;
  rsi: number;
  volume_avg: number;
  current_volume: number;
  last_price: number;
}

// ---- Module-level state ----

const accounts = new Map<number, AccountState>();
let activeAccountId = 1;
let nextId = 1;

// ---- Load from DB ----

export function loadAccountsFromDb(): void {
  const rows = db.getAllAccounts();
  for (const row of rows) {
    const acct: AccountState = {
      id: row.id,
      name: row.name,
      balance: row.balance,
      initialBalance: row.initial_balance,
      totalPnl: row.total_pnl,
      totalTrades: row.total_trades,
      winningTrades: row.winning_trades,
      losingTrades: row.losing_trades,
      totalVolume: row.total_volume,
      totalTurnover: row.total_turnover,
      positions: [],
      recentTrades: [],
      autoTraderState: createDefaultATState(),
      strategyConfig: getDefaultStrategyConfig(),
    };

    // Load strategy config
    const scRow = db.getStrategyConfig(row.id);
    if (scRow) {
      try {
        acct.strategyConfig = JSON.parse(scRow.config_json);
      } catch { /* use default */ }
    } else {
      acct.strategyConfig = getDefaultStrategyConfig();
    }

    // Load open positions from DB
    const openTrades = db.getOpenPositionsByAccount(row.id);
    for (const t of openTrades) {
      acct.positions.push({
        id: t.id,
        side: t.side,
        entryPrice: t.entry_price,
        margin: t.margin,
        leverage: t.leverage,
        positionValue: t.position_value,
        highestPrice: t.highest_price ?? t.entry_price,
        lowestPrice: t.lowest_price ?? t.entry_price,
        entryTime: t.entry_time,
        instId: t.inst_id ?? "BTC-USDT",
      });
      if (t.id >= nextId) nextId = t.id + 1;
    }

    // Load recent closed trades
    acct.recentTrades = db.getClosedTradesByAccount(row.id, 20);

    accounts.set(row.id, acct);
  }

  // Set active to first account
  activeAccountId = accounts.size > 0 ? [...accounts.keys()][0] : 1;

  console.log(`[account-manager] Loaded ${accounts.size} accounts, active=#${activeAccountId}`);
}

// ---- Account queries ----

export function getActiveAccount(): AccountState {
  return accounts.get(activeAccountId)!;
}

export function setActiveAccount(id: number): AccountState | null {
  if (accounts.has(id)) {
    activeAccountId = id;
    return accounts.get(id)!;
  }
  return null;
}

export function getActiveAccountId(): number {
  return activeAccountId;
}

export function getAccount(id: number): AccountState | undefined {
  return accounts.get(id);
}

export function getAllAccounts(): { id: number; name: string; balance: number; initialBalance: number; totalPnl: number; totalTrades: number }[] {
  return [...accounts.values()].map((a) => ({
    id: a.id,
    name: a.name,
    balance: a.balance,
    initialBalance: a.initialBalance,
    totalPnl: a.totalPnl,
    totalTrades: a.totalTrades,
  }));
}

export function getAllAccountIds(): number[] {
  return [...accounts.keys()];
}

export function createNewAccount(name: string, initialBalance: number): AccountState {
  const row = db.createAccount(name, initialBalance);
  const acct: AccountState = {
    id: row.id,
    name: row.name,
    balance: row.balance,
    initialBalance: row.initial_balance,
    totalPnl: row.total_pnl,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalVolume: 0,
    totalTurnover: 0,
    positions: [],
    recentTrades: [],
    autoTraderState: createDefaultATState(),
    strategyConfig: getDefaultStrategyConfig(),
  };
  accounts.set(row.id, acct);
  return acct;
}

// ---- Positions management (called from trading-engine) ----

export function addPosition(accountId: number, pos: MemPosition): void {
  const acct = accounts.get(accountId);
  if (acct) {
    acct.positions.push(pos);
    if (pos.id >= nextId) nextId = pos.id + 1;
  }
}

export function removePosition(accountId: number, positionId: number): MemPosition | null {
  const acct = accounts.get(accountId);
  if (!acct) return null;
  const idx = acct.positions.findIndex((p) => p.id === positionId);
  if (idx === -1) return null;
  const [pos] = acct.positions.splice(idx, 1);
  return pos;
}

export function getPositions(accountId: number): MemPosition[] {
  return accounts.get(accountId)?.positions ?? [];
}

export function getNextId(): number {
  return nextId++;
}

export function addRecentTrade(accountId: number, trade: any): void {
  const acct = accounts.get(accountId);
  if (acct) {
    acct.recentTrades.unshift(trade);
    if (acct.recentTrades.length > 20) acct.recentTrades.pop();
  }
}

// ---- Balance & stats management ----

export function updateBalance(accountId: number, balance: number, totalPnl: number): void {
  const acct = accounts.get(accountId);
  if (acct) {
    acct.balance = Math.round(balance * 100) / 100;
    acct.totalPnl = totalPnl;
  }
}

export function updateStats(accountId: number, stats: { totalTrades: number; winningTrades: number; losingTrades: number; totalVolume: number; totalTurnover: number }): void {
  const acct = accounts.get(accountId);
  if (acct) {
    acct.totalTrades = stats.totalTrades;
    acct.winningTrades = stats.winningTrades;
    acct.losingTrades = stats.losingTrades;
    acct.totalVolume = stats.totalVolume;
    acct.totalTurnover = stats.totalTurnover;
  }
}

export function getHighestPrice(accountId: number, positionId: number): number {
  const acct = accounts.get(accountId);
  if (!acct) return 0;
  const pos = acct.positions.find((p) => p.id === positionId);
  return pos?.highestPrice ?? 0;
}

export function setHighestPrice(accountId: number, positionId: number, price: number): void {
  const acct = accounts.get(accountId);
  if (!acct) return;
  const pos = acct.positions.find((p) => p.id === positionId);
  if (pos && price > pos.highestPrice) pos.highestPrice = price;
}

export function setLowestPrice(accountId: number, positionId: number, price: number): void {
  const acct = accounts.get(accountId);
  if (!acct) return;
  const pos = acct.positions.find((p) => p.id === positionId);
  if (pos && price < pos.lowestPrice) pos.lowestPrice = price;
}

// ---- Strategy config ----

export function updateStrategyConfig(accountId: number, config: StrategyConfig): void {
  const acct = accounts.get(accountId);
  if (acct) {
    acct.strategyConfig = config;
    db.updateStrategyConfig(accountId, JSON.stringify(config));
  }
}

export function getStrategyConfig(accountId: number): StrategyConfig {
  return accounts.get(accountId)?.strategyConfig ?? getDefaultStrategyConfig();
}

// ---- Auto-trader state ----

export function updateAutoTraderState(accountId: number, atState: Partial<AutoTraderState>): void {
  const acct = accounts.get(accountId);
  if (acct) {
    Object.assign(acct.autoTraderState, atState);
  }
}

export function getAutoTraderState(accountId: number): AutoTraderState {
  return accounts.get(accountId)?.autoTraderState ?? createDefaultATState();
}

// ---- Persist to DB ----

export function persistAccount(accountId: number): void {
  const acct = accounts.get(accountId);
  if (!acct) return;
  db.updateAccountBalance(accountId, acct.balance, acct.totalPnl);
  db.updateAccountStats(accountId, acct.totalTrades, acct.winningTrades, acct.losingTrades, acct.totalVolume, acct.totalTurnover);
}

export function persistExtremePrices(accountId: number): void {
  const acct = accounts.get(accountId);
  if (!acct) return;
  for (const p of acct.positions) {
    db.updateHighestPrice(p.id, p.highestPrice);
    db.updateLowestPrice(p.id, p.lowestPrice);
  }
}

// ---- Defaults ----

function createDefaultATState(): AutoTraderState {
  return {
    running: false,
    has_position: false,
    position_id: null,
    side: null,
    imbalance: 0,
    rsi: 0,
    volume_avg: 0,
    current_volume: 0,
    last_price: 0,
  };
}

function getDefaultStrategyConfig(): StrategyConfig {
  return {
    name: "Default Strategy",
    long_entry: { operator: "AND", conditions: [] },
    long_exit: { operator: "AND", conditions: [] },
    short_entry: { operator: "AND", conditions: [] },
    short_exit: { operator: "AND", conditions: [] },
    risk: {
      margin_per_trade: 100,
      leverage: 5,
      stop_loss_pct: 0.1,
      take_profit_activation_pct: 0.05,
      take_profit_pullback: 0.1,
      strategy_exit: true,
    },
  };
}
