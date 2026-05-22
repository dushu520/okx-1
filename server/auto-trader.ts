/**
 * Automatic trading strategy: long + short.
 * Conditions: weighted imbalance, momentum, volume, RSI.
 * Reads thresholds from settings (configurable per-side via settings UI).
 */
import { state } from "./shared-state.js";
import { settings } from "./settings.js";
import { openTrade } from "./trading-engine.js";
import {
  getWeightedImbalance,
  checkMomentum,
  calcRSI,
  calcVolumeAvg,
  getCurrentVolume,
  hasEnoughData,
  getConfirmedCandles,
  getPriceSampleCount,
  getBids,
  getAsks,
} from "./market-data.js";

const logger = {
  info: (msg: string) => console.log(`[auto-trader] ${msg}`),
  warn: (msg: string) => console.warn(`[auto-trader] ${msg}`),
};

const CHECK_INTERVAL = 3000;

let autoPositionId: number | null = null;
let autoPositionSide: "long" | "short" | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ---- Helpers ----

function hasEnoughBalance(): boolean {
  return state.balance >= state.initialBalance * 0.1;
}

function volAboveAvg(): boolean {
  const volAvg = calcVolumeAvg(settings.volumePeriods);
  const curVol = getCurrentVolume();
  return volAvg > 0 && curVol > volAvg;
}

// ---- Core strategy ----

let loggedDataReady = false;

function check(): void {
  // Update shared state for frontend display
  state.autoTraderState = getAutoTradeState();

  if (!hasEnoughData()) {
    if (loggedDataReady) loggedDataReady = false;
    return;
  }
  if (!loggedDataReady) {
    loggedDataReady = true;
    logger.info(`Data ready — imbalance=${getWeightedImbalance().toFixed(2)} rsi=${calcRSI(settings.rsiPeriod).toFixed(1)} candles=${getConfirmedCandles().length} samples=${getPriceSampleCount()}`);
  }

  const imbalance = getWeightedImbalance();
  const price = state.currentPrice;
  if (price <= 0) return;

  // Validate auto-trader's position still exists
  if (autoPositionId !== null) {
    const stillOpen = state.positions.some((p: any) => p.id === autoPositionId);
    if (!stillOpen) {
      logger.info(`Position #${autoPositionId} closed externally, resetting`);
      autoPositionId = null;
      autoPositionSide = null;
    }
  }

  const hasPosition = autoPositionId !== null;

  // ---- LONG entry ----
  if (!hasPosition && hasEnoughBalance()) {
    if (
      imbalance > settings.imbalanceBuy &&
      checkMomentum("up", settings.momentumTicks) &&
      volAboveAvg() &&
      calcRSI(settings.rsiPeriod) < settings.rsiBuyMax
    ) {
      const margin = Math.min(100, state.balance);
      const leverage = 5;
      const positionValue = Math.round(margin * leverage * 100) / 100;
      const id = openTrade(price, margin, leverage, positionValue, "long");
      autoPositionId = id;
      autoPositionSide = "long";
      logger.info(
        `BUY #${id} | imbalance=${imbalance.toFixed(2)} rsi=${calcRSI(settings.rsiPeriod).toFixed(1)} ` +
        `vol=${getCurrentVolume().toFixed(2)}/${calcVolumeAvg(settings.volumePeriods).toFixed(2)} price=${price}`
      );
      return;
    }
  }

  // ---- SHORT entry ----
  if (!hasPosition && hasEnoughBalance()) {
    if (
      imbalance < settings.imbalanceSell &&
      checkMomentum("down", settings.momentumTicks) &&
      volAboveAvg() &&
      calcRSI(settings.rsiPeriod) > settings.rsiSellMin
    ) {
      const margin = Math.min(100, state.balance);
      const leverage = 5;
      const positionValue = Math.round(margin * leverage * 100) / 100;
      const id = openTrade(price, margin, leverage, positionValue, "short");
      autoPositionId = id;
      autoPositionSide = "short";
      logger.info(
        `SHORT #${id} | imbalance=${imbalance.toFixed(2)} rsi=${calcRSI(settings.rsiPeriod).toFixed(1)} ` +
        `vol=${getCurrentVolume().toFixed(2)}/${calcVolumeAvg(settings.volumePeriods).toFixed(2)} price=${price}`
      );
      return;
    }
  }

}

// ---- Lifecycle ----

export function startAutoTrader(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info(`Starting auto-trader (check every ${CHECK_INTERVAL / 1000}s)`);
  intervalId = setInterval(check, CHECK_INTERVAL);
}

export function stopAutoTrader(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
  logger.info("Stopped");
}

export function isAutoTraderRunning(): boolean {
  return isRunning;
}

export function getAutoPositionId(): number | null {
  return autoPositionId;
}

export function getAutoPositionSide(): string | null {
  return autoPositionSide;
}

export function resetAutoPosition(): void {
  autoPositionId = null;
  autoPositionSide = null;
}

export function getAutoTradeState(): any {
  const obReady = getBids().length > 0 && getAsks().length > 0;

  return {
    running: isRunning,
    has_position: autoPositionId !== null,
    position_id: autoPositionId,
    side: autoPositionSide,
    imbalance: obReady ? Math.round(getWeightedImbalance() * 100) / 100 : 0,
    rsi: hasEnoughData() ? calcRSI(settings.rsiPeriod) : 0,
    volume_avg: hasEnoughData() ? Math.round(calcVolumeAvg(settings.volumePeriods) * 100) / 100 : 0,
    current_volume: hasEnoughData() ? Math.round(getCurrentVolume() * 100) / 100 : 0,
    last_price: state.currentPrice,
  };
}
