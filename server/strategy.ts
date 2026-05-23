/**
 * Strategy engine: rule-group based signal evaluation.
 *
 * Design:
 * - A strategy is 4 signal groups: long_entry, long_exit, short_entry, short_exit
 * - Each group = conditions combined with AND/OR
 * - Each condition = indicator + operator + value + params
 * - Indicator registry allows adding new indicators without changing core logic
 */

import {
  getWeightedImbalance,
  checkMomentum,
  calcRSI,
  calcVolumeAvg,
  getCurrentVolume,
  hasEnoughData,
  getBids,
  getAsks,
  getConfirmedCandles,
  getPriceSampleCount,
} from "./market-data.js";

// ---- Types ----

export interface Condition {
  indicator: string;                     // "imbalance" | "rsi" | "momentum" | "volume_ratio"
  operator: ">" | "<" | ">=" | "<=";
  value: number;                         // threshold
  params?: Record<string, number | string>; // e.g. { rsi_period: 5, momentum_ticks: 3 }
}

export interface ConditionGroup {
  operator: "AND" | "OR";
  conditions: Condition[];
}

export interface RiskConfig {
  margin_per_trade: number;
  leverage: number;
  stop_loss_pct: number;
  take_profit_activation_pct: number;
  take_profit_pullback: number;
  strategy_exit: boolean;
}

export interface StrategyConfig {
  name: string;
  long_entry: ConditionGroup;
  long_exit: ConditionGroup;
  short_entry: ConditionGroup;
  short_exit: ConditionGroup;
  risk: RiskConfig;
}

export type StrategySignal = "long_entry" | "long_exit" | "short_entry" | "short_exit" | null;

// ---- Indicator registry ----

type IndicatorFn = (params: Record<string, number | string>) => number;
const indicators = new Map<string, IndicatorFn>();

export function registerIndicator(name: string, fn: IndicatorFn): void {
  indicators.set(name, fn);
}

function getIndicator(name: string): IndicatorFn | undefined {
  return indicators.get(name);
}

// ---- Built-in indicators ----

registerIndicator("imbalance", (_p) => {
  const b = getBids().length;
  const a = getAsks().length;
  if (b === 0 || a === 0) return 1;
  return getWeightedImbalance();
});

registerIndicator("rsi", (p) => {
  const period = typeof p.rsi_period === "number" ? p.rsi_period : 5;
  return calcRSI(period);
});

registerIndicator("momentum", (p) => {
  const ticks = typeof p.momentum_ticks === "number" ? p.momentum_ticks : 3;
  const dir = String(p.direction ?? "up") as "up" | "down";
  if (getPriceSampleCount() < ticks) return 0;
  return checkMomentum(dir, ticks) ? 1 : 0;
});

registerIndicator("volume_ratio", (p) => {
  const periods = typeof p.volume_periods === "number" ? p.volume_periods : 10;
  const avg = calcVolumeAvg(periods);
  if (avg <= 0) return 0;
  return getCurrentVolume() / avg;
});

registerIndicator("has_enough_data", (_p) => {
  return hasEnoughData() ? 1 : 0;
});

// ---- Condition evaluation ----

function evaluateCondition(c: Condition): boolean {
  const fn = getIndicator(c.indicator);
  if (!fn) return false;
  const val = fn(c.params ?? {});
  switch (c.operator) {
    case ">": return val > c.value;
    case "<": return val < c.value;
    case ">=": return val >= c.value;
    case "<=": return val <= c.value;
  }
}

function evaluateGroup(g: ConditionGroup): boolean {
  if (g.conditions.length === 0) return true;
  if (g.operator === "AND") {
    return g.conditions.every((c) => evaluateCondition(c));
  } else {
    return g.conditions.some((c) => evaluateCondition(c));
  }
}

// ---- Main evaluation ----

export function evaluateStrategy(config: StrategyConfig): StrategySignal {
  if (!hasEnoughData()) return null;

  if (evaluateGroup(config.long_entry)) return "long_entry";
  if (evaluateGroup(config.short_entry)) return "short_entry";
  if (config.risk.strategy_exit) {
    if (evaluateGroup(config.long_exit)) return "long_exit";
    if (evaluateGroup(config.short_exit)) return "short_exit";
  }
  return null;
}

// ---- Helpers ----

export function dataReadyForStrategy(): boolean {
  return hasEnoughData();
}

export function getStrategyIndicatorValues(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, fn] of indicators) {
    try {
      out[name] = Math.round(fn({}) * 100) / 100;
    } catch {
      out[name] = 0;
    }
  }
  return out;
}
