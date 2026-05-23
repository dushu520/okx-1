/**
 * Strategy runner: per-account automated trading.
 * Replaces the old auto-trader.ts — each account gets independent strategy evaluation.
 *
 * Architecture:
 * - Single setInterval loop iterates all accounts
 * - Each account's strategy config is evaluated independently
 * - Trades execute against the account's own fund pool and positions
 */

import * as accountManager from "./account-manager.js";
import { openTrade, manualClose } from "./trading-engine.js";
import { evaluateStrategy, dataReadyForStrategy, getStrategyIndicatorValues } from "./strategy.js";
import { calcVolumeAvg, getCurrentVolume } from "./market-data.js";
import { state } from "./shared-state.js";

const logger = {
  info: (msg: string) => console.log(`[strategy-runner] ${msg}`),
  warn: (msg: string) => console.warn(`[strategy-runner] ${msg}`),
};

const CHECK_INTERVAL = 3000;

let intervalId: ReturnType<typeof setInterval> | null = null;
const enabledAccounts = new Set<number>();

// ---- Public API ----

export function isAccountRunning(accountId: number): boolean {
  return enabledAccounts.has(accountId);
}

export function startAccount(accountId: number): void {
  enabledAccounts.add(accountId);
  accountManager.updateAutoTraderState(accountId, { running: true });
  logger.info(`Started auto-trading for account #${accountId}`);
}

export function stopAccount(accountId: number): void {
  enabledAccounts.delete(accountId);
  accountManager.updateAutoTraderState(accountId, {
    running: false,
    has_position: false,
    position_id: null,
    side: null,
  });
  logger.info(`Stopped auto-trading for account #${accountId}`);
}

export function toggleAccount(accountId: number, running: boolean): void {
  if (running) startAccount(accountId);
  else stopAccount(accountId);
}

export function resetAccountPosition(accountId: number): void {
  accountManager.updateAutoTraderState(accountId, {
    has_position: false,
    position_id: null,
    side: null,
  });
}

/** Start the global runner loop */
export function startRunner(): void {
  if (intervalId) return;
  logger.info(`Starting strategy runner (check every ${CHECK_INTERVAL / 1000}s)`);
  intervalId = setInterval(checkAllAccounts, CHECK_INTERVAL);
}

/** Stop the global runner loop */
export function stopRunner(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  enabledAccounts.clear();
  logger.info("Strategy runner stopped");
}

export function isRunnerRunning(): boolean {
  return intervalId !== null;
}

// ---- Core check loop ----

let loggedDataReady = false;

function checkAllAccounts(): void {
  if (!dataReadyForStrategy()) {
    if (loggedDataReady) loggedDataReady = false;
    return;
  }
  if (!loggedDataReady) {
    loggedDataReady = true;
    logger.info("Market data ready for strategy evaluation");
  }

  const currentPrice = state.currentPrice;
  if (currentPrice <= 0) return;

  const indVals = getStrategyIndicatorValues();
  const accounts = accountManager.getAllAccountIds();

  for (const id of accounts) {
    // Update display values for ALL accounts (not just auto-trading ones)
    accountManager.updateAutoTraderState(id, {
      imbalance: indVals.imbalance ?? 0,
      rsi: indVals.rsi ?? 0,
      volume_avg: Math.round(calcVolumeAvg(10) * 100) / 100,
      current_volume: Math.round(getCurrentVolume() * 100) / 100,
      last_price: currentPrice,
    });

    if (!enabledAccounts.has(id)) continue;

    const acct = accountManager.getAccount(id);
    if (!acct) continue;
    const config = accountManager.getStrategyConfig(id);
    const positions = accountManager.getPositions(id);
    const atState = accountManager.getAutoTraderState(id);

    // Validate tracked position still exists
    if (atState.position_id !== null) {
      const stillOpen = positions.some((p) => p.id === atState.position_id);
      if (!stillOpen) {
        logger.info(`Account #${id}: position #${atState.position_id} closed externally, resetting`);
        accountManager.updateAutoTraderState(id, {
          has_position: false,
          position_id: null,
          side: null,
        });
        continue;
      }
    }

    const hasPosition = atState.position_id !== null;
    const hasEnoughBalance = acct.balance >= acct.initialBalance * 0.1;

    // Evaluate strategy
    const signal = evaluateStrategy(config);

    if (!hasPosition && hasEnoughBalance) {
      if (signal === "long_entry") {
        const margin = Math.min(config.risk.margin_per_trade, acct.balance);
        const leverage = config.risk.leverage;
        const positionValue = Math.round(margin * leverage * 100) / 100;
        const tradeId = openTrade(currentPrice, margin, leverage, positionValue, "long", "BTC-USDT", id);
        accountManager.updateAutoTraderState(id, {
          has_position: true,
          position_id: tradeId,
          side: "long",
        });
        logger.info(
          `Account #${id} BUY #${tradeId} | price=${currentPrice} margin=${margin} pos=${positionValue}` +
          ` | imbalance=${(indVals.imbalance ?? 0).toFixed(2)} rsi=${(indVals.rsi ?? 0).toFixed(1)}`
        );
      } else if (signal === "short_entry") {
        const margin = Math.min(config.risk.margin_per_trade, acct.balance);
        const leverage = config.risk.leverage;
        const positionValue = Math.round(margin * leverage * 100) / 100;
        const tradeId = openTrade(currentPrice, margin, leverage, positionValue, "short", "BTC-USDT", id);
        accountManager.updateAutoTraderState(id, {
          has_position: true,
          position_id: tradeId,
          side: "short",
        });
        logger.info(
          `Account #${id} SHORT #${tradeId} | price=${currentPrice} margin=${margin} pos=${positionValue}` +
          ` | imbalance=${(indVals.imbalance ?? 0).toFixed(2)} rsi=${(indVals.rsi ?? 0).toFixed(1)}`
        );
      }
    }

    // Strategy exits
    if (hasPosition && config.risk.strategy_exit) {
      if (atState.side === "long" && signal === "long_exit") {
        const result = manualClose(atState.position_id!, currentPrice, "strategy_exit", id);
        if (result) {
          logger.info(
            `Account #${id} EXIT LONG #${atState.position_id} | pnl=${result.pnl.toFixed(2)} (${result.pnlPct.toFixed(1)}%)`
          );
        }
        accountManager.updateAutoTraderState(id, {
          has_position: false,
          position_id: null,
          side: null,
        });
      } else if (atState.side === "short" && signal === "short_exit") {
        const result = manualClose(atState.position_id!, currentPrice, "strategy_exit", id);
        if (result) {
          logger.info(
            `Account #${id} COVER SHORT #${atState.position_id} | pnl=${result.pnl.toFixed(2)} (${result.pnlPct.toFixed(1)}%)`
          );
        }
        accountManager.updateAutoTraderState(id, {
          has_position: false,
          position_id: null,
          side: null,
        });
      }
    }
  }
}
