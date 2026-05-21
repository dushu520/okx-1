import * as db from "./db.js";

export interface TradingSettings {
  marginPerTrade: number;
  leverage: number;
  stopLossPct: number;
  takeProfitActivationPct: number;
  takeProfitPullback: number;

  // Strategy parameters
  momentumTicks: number;
  volumePeriods: number;
  rsiPeriod: number;
  imbalanceBuy: number;
  rsiBuyMax: number;
  imbalanceSell: number;
  rsiSellMin: number;
}

// In-memory mutable settings (hot-path reads, no DB)
export const settings: TradingSettings = {
  marginPerTrade: 100,
  leverage: 5,
  stopLossPct: 0.1,
  takeProfitActivationPct: 0.05,
  takeProfitPullback: 0.1,
  momentumTicks: 3,
  volumePeriods: 10,
  rsiPeriod: 5,
  imbalanceBuy: 1.2,
  rsiBuyMax: 70,
  imbalanceSell: 0.83,
  rsiSellMin: 70,
};

/** Load settings from DB into memory (called once at startup) */
export function loadSettings(): void {
  const row = db.getSettings();
  if (row) {
    settings.marginPerTrade = row.margin_per_trade;
    settings.leverage = row.leverage;
    settings.stopLossPct = row.stop_loss_pct;
    settings.takeProfitActivationPct = row.take_profit_activation_pct;
    settings.takeProfitPullback = row.take_profit_pullback;
    settings.momentumTicks = row.momentum_ticks;
    settings.volumePeriods = row.volume_periods;
    settings.rsiPeriod = row.rsi_period;
    settings.imbalanceBuy = row.imbalance_buy;
    settings.rsiBuyMax = row.rsi_buy_max;
    settings.imbalanceSell = row.imbalance_sell;
    settings.rsiSellMin = row.rsi_sell_min;
  }
}

/** Persist new settings to DB and update in-memory values atomically */
export function saveSettings(s: TradingSettings): void {
  Object.assign(settings, s);
  db.updateSettings(
    s.marginPerTrade, s.leverage,
    s.stopLossPct, s.takeProfitActivationPct, s.takeProfitPullback,
    s.momentumTicks, s.volumePeriods, s.rsiPeriod,
    s.imbalanceBuy, s.rsiBuyMax, s.imbalanceSell, s.rsiSellMin,
  );
}
