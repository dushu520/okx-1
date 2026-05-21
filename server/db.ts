import Database from "better-sqlite3";
import path from "path";
import { getConfig } from "./config.js";

const cfg = getConfig();
let db: Database.Database;

function beijingNow(): string {
  const d = new Date();
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(cfg.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDb(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance REAL NOT NULL DEFAULT 10000.0,
      initial_balance REAL NOT NULL DEFAULT 10000.0,
      total_pnl REAL NOT NULL DEFAULT 0.0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      side TEXT NOT NULL CHECK (side IN ('long', 'short')),
      entry_price REAL NOT NULL,
      exit_price REAL,
      quantity REAL NOT NULL DEFAULT 0,
      leverage INTEGER NOT NULL DEFAULT 5,
      margin REAL NOT NULL,
      position_value REAL NOT NULL,
      pnl REAL DEFAULT 0,
      pnl_percent REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      highest_price REAL,
      lowest_price REAL,
      entry_time TEXT NOT NULL,
      exit_time TEXT,
      exit_reason TEXT,
      inst_id TEXT NOT NULL DEFAULT 'BTC-USDT'
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      margin_per_trade REAL NOT NULL DEFAULT 100.0,
      leverage INTEGER NOT NULL DEFAULT 5,
      stop_loss_pct REAL NOT NULL DEFAULT 0.1,
      take_profit_activation_pct REAL NOT NULL DEFAULT 0.05,
      take_profit_pullback REAL NOT NULL DEFAULT 0.1
    );

    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_trades INTEGER NOT NULL DEFAULT 0,
      winning_trades INTEGER NOT NULL DEFAULT 0,
      losing_trades INTEGER NOT NULL DEFAULT 0,
      total_volume REAL NOT NULL DEFAULT 0.0,
      total_turnover REAL NOT NULL DEFAULT 0.0,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: add inst_id column for older DBs
  try { db.exec("ALTER TABLE trades ADD COLUMN inst_id TEXT NOT NULL DEFAULT 'BTC-USDT'"); } catch {}

  // Migration: add strategy settings columns for older DBs
  try { db.exec("ALTER TABLE settings ADD COLUMN momentum_ticks INTEGER NOT NULL DEFAULT 3"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN volume_periods INTEGER NOT NULL DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN rsi_period INTEGER NOT NULL DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN imbalance_buy REAL NOT NULL DEFAULT 1.2"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN rsi_buy_max REAL NOT NULL DEFAULT 70"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN imbalance_sell REAL NOT NULL DEFAULT 0.83"); } catch {}
  try { db.exec("ALTER TABLE settings ADD COLUMN rsi_sell_min REAL NOT NULL DEFAULT 70"); } catch {}

  // Seed account if not exists
  const acctRow = db.prepare("SELECT id FROM account WHERE id = 1").get();
  if (!acctRow) {
    const now = beijingNow();
    db.prepare(
      "INSERT INTO account (id, balance, initial_balance, total_pnl, updated_at) VALUES (1, ?, ?, 0.0, ?)"
    ).run(cfg.initialBalance, cfg.initialBalance, now);
  }

  // Seed settings if not exists
  const settingsRow = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!settingsRow) {
    db.prepare(
      `INSERT INTO settings (id, margin_per_trade, leverage, stop_loss_pct, take_profit_activation_pct, take_profit_pullback,
       momentum_ticks, volume_periods, rsi_period, imbalance_buy, rsi_buy_max, imbalance_sell, rsi_sell_min)
       VALUES (1, 100.0, 5, 0.1, 0.05, 0.1, 3, 10, 5, 1.2, 70, 0.83, 70)`
    ).run();
  }

  // Seed stats if not exists
  const statsRow = db.prepare("SELECT id FROM stats WHERE id = 1").get();
  if (!statsRow) {
    const now = beijingNow();
    db.prepare(
      "INSERT INTO stats (id, total_trades, winning_trades, losing_trades, total_volume, total_turnover, updated_at) VALUES (1, 0, 0, 0, 0.0, 0.0, ?)"
    ).run(now);
  }
}

export interface TradeRow {
  id: number;
  side: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  leverage: number;
  margin: number;
  position_value: number;
  pnl: number;
  pnl_percent: number;
  status: string;
  highest_price: number;
  lowest_price: number | null;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string | null;
}

export interface AccountRow {
  id: number;
  balance: number;
  initial_balance: number;
  total_pnl: number;
  updated_at: string;
}

export interface SettingsRow {
  id: number;
  margin_per_trade: number;
  leverage: number;
  stop_loss_pct: number;
  take_profit_activation_pct: number;
  take_profit_pullback: number;
  momentum_ticks: number;
  volume_periods: number;
  rsi_period: number;
  imbalance_buy: number;
  rsi_buy_max: number;
  imbalance_sell: number;
  rsi_sell_min: number;
}

export function getSettings(): SettingsRow | undefined {
  return db.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow | undefined;
}

export function updateSettings(
  marginPerTrade: number,
  leverage: number,
  stopLossPct: number,
  takeProfitActivationPct: number,
  takeProfitPullback: number,
  momentumTicks: number,
  volumePeriods: number,
  rsiPeriod: number,
  imbalanceBuy: number,
  rsiBuyMax: number,
  imbalanceSell: number,
  rsiSellMin: number,
): void {
  db.prepare(
    `UPDATE settings SET margin_per_trade = ?, leverage = ?, stop_loss_pct = ?,
     take_profit_activation_pct = ?, take_profit_pullback = ?,
     momentum_ticks = ?, volume_periods = ?, rsi_period = ?,
     imbalance_buy = ?, rsi_buy_max = ?, imbalance_sell = ?, rsi_sell_min = ? WHERE id = 1`
  ).run(marginPerTrade, leverage, stopLossPct, takeProfitActivationPct, takeProfitPullback,
        momentumTicks, volumePeriods, rsiPeriod, imbalanceBuy, rsiBuyMax, imbalanceSell, rsiSellMin);
}

export interface StatsRow {
  id: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_volume: number;
  total_turnover: number;
  updated_at: string;
}

export function getAccount(): AccountRow | undefined {
  return db.prepare("SELECT * FROM account WHERE id = 1").get() as AccountRow | undefined;
}

export function updateAccount(balance: number, totalPnl: number): void {
  const now = beijingNow();
  db.prepare("UPDATE account SET balance = ?, total_pnl = ?, updated_at = ? WHERE id = 1").run(
    balance,
    totalPnl,
    now
  );
}

export function createTrade(
  side: string,
  entryPrice: number,
  margin: number,
  positionValue: number,
  leverage: number,
  instId = "BTC-USDT"
): number {
  const now = beijingNow();
  const result = db
    .prepare(
      `INSERT INTO trades (side, entry_price, margin, position_value, leverage,
       highest_price, lowest_price, status, entry_time, quantity, inst_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, ?)`
    )
    .run(side, entryPrice, margin, positionValue, leverage, entryPrice, entryPrice, now, instId);
  return Number(result.lastInsertRowid);
}

export function closeTrade(
  tradeId: number,
  exitPrice: number,
  pnl: number,
  pnlPercent: number,
  exitReason: string
): void {
  const now = beijingNow();
  db.prepare(
    `UPDATE trades SET exit_price = ?, pnl = ?, pnl_percent = ?,
     status = 'closed', exit_time = ?, exit_reason = ? WHERE id = ?`
  ).run(exitPrice, pnl, pnlPercent, now, exitReason, tradeId);
}

export function updateHighestPrice(tradeId: number, highestPrice: number): void {
  db.prepare("UPDATE trades SET highest_price = MAX(COALESCE(highest_price, 0), ?) WHERE id = ?").run(
    highestPrice,
    tradeId
  );
}

export function updateLowestPrice(tradeId: number, lowestPrice: number): void {
  db.prepare(
    "UPDATE trades SET lowest_price = ? WHERE id = ? AND (COALESCE(lowest_price, ?) > ?)"
  ).run(lowestPrice, tradeId, lowestPrice, lowestPrice);
}

export function getOpenPositions(): TradeRow[] {
  return db
    .prepare("SELECT * FROM trades WHERE status = 'open' ORDER BY entry_time DESC")
    .all() as TradeRow[];
}

export function getClosedTrades(limit = 50): TradeRow[] {
  return db
    .prepare("SELECT * FROM trades WHERE status = 'closed' ORDER BY exit_time DESC LIMIT ?")
    .all(limit) as TradeRow[];
}

export function getAllTrades(limit = 100): TradeRow[] {
  return db
    .prepare("SELECT * FROM trades ORDER BY COALESCE(exit_time, entry_time) DESC LIMIT ?")
    .all(limit) as TradeRow[];
}

export function getStats(): StatsRow | undefined {
  return db.prepare("SELECT * FROM stats WHERE id = 1").get() as StatsRow | undefined;
}

export function updateStats(
  totalTrades: number,
  winningTrades: number,
  losingTrades: number,
  totalVolume: number,
  totalTurnover: number
): void {
  const now = beijingNow();
  db.prepare(
    `UPDATE stats SET total_trades = ?, winning_trades = ?, losing_trades = ?,
     total_volume = ?, total_turnover = ?, updated_at = ? WHERE id = 1`
  ).run(totalTrades, winningTrades, losingTrades, totalVolume, totalTurnover, now);
}
