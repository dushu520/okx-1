import { Router, Request, Response } from "express";
import { getAllTrades } from "./db.js";
import { state } from "./shared-state.js";
import * as accountManager from "./account-manager.js";
import type { StrategyConfig } from "./strategy.js";
import { openTrade, manualClose, computePositionViews } from "./trading-engine.js";
import * as strategyRunner from "./strategy-runner.js";
import {
  getBids, getAsks, getConfirmedCandles,
  getPriceSampleCount, getWeightedImbalance, hasEnoughData,
  getCandlesForChartBar, CHART_BARS,
} from "./market-data.js";

export function setupRoutes(): Router {
  const router = Router();

  // ---- Account management ----

  /** List all accounts */
  router.get("/api/accounts", (_req: Request, res: Response) => {
    const accounts = accountManager.getAllAccounts();
    res.json({ accounts });
  });

  /** Switch active account */
  router.post("/api/accounts/switch", (req: Request, res: Response) => {
    const body = req.body as any;
    const id = parseInt(body.account_id, 10);
    const acct = accountManager.setActiveAccount(id);
    if (!acct) {
      res.json({ ok: false, error: `Account #${id} not found` });
      return;
    }
    console.log(`[routes] Switched to account #${id} (${acct.name})`);
    res.json({ ok: true, account_id: id });
  });

  /** Create new account */
  router.post("/api/accounts", (req: Request, res: Response) => {
    const body = req.body as any;
    const name = String(body.name || "New Account").slice(0, 50);
    const balance = Math.max(100, parseFloat(body.balance) || 10000);
    const acct = accountManager.createNewAccount(name, balance);
    console.log(`[routes] Created account #${acct.id} "${name}" with $${balance}`);
    res.json({ ok: true, account: { id: acct.id, name: acct.name, balance: acct.balance } });
  });

  // ---- Full state snapshot ----

  router.get("/api/state", (_req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    const price = state.currentPrice;
    const views = computePositionViews(acct.id, price);

    res.json({
      current_price: price,
      swap_price: state.swapPrice,
      current_time: state.currentTime,
      balance: acct.balance,
      initial_balance: acct.initialBalance,
      total_pnl: acct.totalPnl,
      total_trades: acct.totalTrades,
      winning_trades: acct.winningTrades,
      losing_trades: acct.losingTrades,
      total_volume: acct.totalVolume,
      total_turnover: acct.totalTurnover,
      positions: views,
      recent_trades: acct.recentTrades,
      total_position_value: views.reduce((s: number, p: any) => s + (p.market_value ?? 0), 0),
      total_unrealized_pnl: views.reduce((s: number, p: any) => s + (p.unrealized_pnl ?? 0), 0),
      ws_connected: state.wsConnected,
      auto_trader: acct.autoTraderState,
      active_account_id: acct.id,
    });
  });

  // ---- Candles ----

  router.get("/api/candles", (req: Request, res: Response) => {
    const bar = CHART_BARS.includes(req.query.bar as any) ? req.query.bar as string : "5m";
    res.json({ bar, candles: getCandlesForChartBar(bar, 100) });
  });

  // ---- Trades ----

  router.get("/api/trades", (_req: Request, res: Response) => {
    res.json({ trades: getAllTrades(100) });
  });

  // ---- Manual buy/short on active account ----

  router.post("/api/buy", (_req: Request, res: Response) => {
    const result = openPosition("long");
    res.json(result);
  });

  router.post("/api/short", (_req: Request, res: Response) => {
    const result = openPosition("short");
    res.json(result);
  });

  function openPosition(side: string): any {
    const acct = accountManager.getActiveAccount();
    const price = state.currentPrice;
    if (price <= 0) return { ok: false, error: "No price data. Wait for WS connection." };

    const risk = acct.strategyConfig.risk;
    const margin = risk.margin_per_trade;
    if (acct.balance < margin) {
      return {
        ok: false,
        error: `Insufficient balance: $${acct.balance.toFixed(2)} < $${margin.toFixed(2)}`,
      };
    }

    const leverage = risk.leverage;
    const positionValue = Math.round(margin * leverage * 100) / 100;
    const tradeId = openTrade(price, margin, leverage, positionValue, side, "BTC-USDT", acct.id);
    return {
      ok: true, trade_id: tradeId, entry_price: price, margin, position_value: positionValue, leverage,
      account_id: acct.id,
    };
  }

  // ---- Manual close ----

  router.post("/api/sell/:tradeId", (req: Request, res: Response) => {
    const price = state.currentPrice;
    if (price <= 0) {
      res.json({ ok: false, error: "No price data." });
      return;
    }

    const tradeId = parseInt(req.params.tradeId);
    const result = manualClose(tradeId, price);

    if (!result) {
      res.json({ ok: false, error: `Position #${tradeId} not found or already closed.` });
      return;
    }

    console.log(`[trade] SELL #${tradeId}: exit=${price} pnl=${result.pnl} (${result.pnlPct}%)`);
    res.json({
      ok: true,
      trade_id: tradeId,
      exit_price: price,
      pnl: result.pnl,
      pnl_percent: result.pnlPct,
    });
  });

  // ---- Strategy config (per account) ----

  router.get("/api/settings", (req: Request, res: Response) => {
    const accountId = parseInt(req.query.account_id as string) || accountManager.getActiveAccountId();
    const config = accountManager.getStrategyConfig(accountId);
    const risk = config.risk;
    res.json({
      margin_per_trade: risk.margin_per_trade,
      leverage: risk.leverage,
      stop_loss_pct: risk.stop_loss_pct * 100,
      take_profit_activation_pct: risk.take_profit_activation_pct * 100,
      take_profit_pullback: risk.take_profit_pullback * 100,
      momentum_ticks: 3,
      volume_periods: 10,
      rsi_period: 5,
      imbalance_buy: 1.2,
      rsi_buy_max: 70,
      imbalance_sell: 0.83,
      rsi_sell_min: 70,
      strategy_exit: risk.strategy_exit,
      // Return full strategy config for advanced editor
      strategy_config: config,
      account_id: accountId,
    });
  });

  router.post("/api/settings", (req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    const body = req.body as any;

    // Support both simple params mode and full strategy config mode
    if (body.strategy_config) {
      // Full strategy config mode
      accountManager.updateStrategyConfig(acct.id, body.strategy_config as StrategyConfig);
    } else {
      // Simple params mode — merge into existing config
      const config = { ...acct.strategyConfig };
      config.risk = {
        margin_per_trade: toNum(body.margin_per_trade, 10, 10000),
        leverage: toNum(body.leverage, 1, 100),
        stop_loss_pct: toNum(body.stop_loss_pct, 1, 50) / 100,
        take_profit_activation_pct: toNum(body.take_profit_activation_pct, 1, 50) / 100,
        take_profit_pullback: toNum(body.take_profit_pullback, 1, 50) / 100,
        strategy_exit: body.strategy_exit === true,
      };
      accountManager.updateStrategyConfig(acct.id, config);
    }

    console.log(`[settings] Updated account #${acct.id}:`, acct.strategyConfig.risk);
    res.json({ ok: true });
  });

  // ---- Auto-trader control (per account) ----

  router.get("/api/auto-trader", (_req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    res.json(acct.autoTraderState);
  });

  router.post("/api/auto-trader/stop", (_req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    strategyRunner.stopAccount(acct.id);
    strategyRunner.resetAccountPosition(acct.id);
    res.json({ ok: true });
  });

  router.post("/api/auto-trader/start", (_req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    strategyRunner.startAccount(acct.id);
    res.json({ ok: true });
  });

  // ---- Debug ----

  router.get("/api/debug", (_req: Request, res: Response) => {
    const acct = accountManager.getActiveAccount();
    res.json({
      bids: getBids().length,
      asks: getAsks().length,
      candles: getConfirmedCandles().length,
      priceSamples: getPriceSampleCount(),
      weightedImbalance: getBids().length > 0 ? getWeightedImbalance() : 0,
      hasEnoughData: hasEnoughData(),
      currentPrice: state.currentPrice,
      wsConnected: state.wsConnected,
      activeAccountId: acct.id,
      autoTraderRunning: acct.autoTraderState.running,
    });
  });

  return router;
}

function toNum(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Math.max(min, Math.min(max, isNaN(n) ? min : n));
}
