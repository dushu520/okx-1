import { Router, Request, Response } from "express";
import { getAllTrades } from "./db.js";
import { state } from "./shared-state.js";
import { settings, saveSettings } from "./settings.js";
import type { TradingSettings } from "./settings.js";
import { openTrade, manualClose } from "./trading-engine.js";
import {
  startAutoTrader,
  stopAutoTrader,
  isAutoTraderRunning,
  resetAutoPosition,
  getAutoTradeState,
} from "./auto-trader.js";
import {
  getBids, getAsks, getConfirmedCandles,
  getPriceSampleCount, getWeightedImbalance, hasEnoughData,
  getCandlesForChart,
} from "./market-data.js";

export function setupRoutes(): Router {
  const router = Router();

  // Full state snapshot
  router.get("/api/state", (_req: Request, res: Response) => {
    res.json(state.getSnapshot());
  });

  // Candles for chart
  router.get("/api/candles", (_req: Request, res: Response) => {
    res.json({ candles: getCandlesForChart(100) });
  });

  // Trade history (from DB for completeness)
  router.get("/api/trades", (_req: Request, res: Response) => {
    res.json({ trades: getAllTrades(100) });
  });

  // Buy — open long position (in memory + persist immediately)
  router.post("/api/buy", (_req: Request, res: Response) => {
    const price = state.currentPrice;
    if (price <= 0) {
      res.json({ ok: false, error: "No price data. Wait for WS connection." });
      return;
    }

    const margin = settings.marginPerTrade;
    if (state.balance < margin) {
      res.json({
        ok: false,
        error: `Insufficient balance: $${state.balance.toFixed(2)} < $${margin.toFixed(2)}`,
      });
      return;
    }

    const leverage = settings.leverage;
    const positionValue = Math.round(margin * leverage * 100) / 100;

    const tradeId = openTrade(price, margin, leverage, positionValue);
    res.json({
      ok: true,
      trade_id: tradeId,
      entry_price: price,
      margin,
      position_value: positionValue,
      leverage,
    });
  });

  // Sell — manually close a position
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

  // GET /api/settings — return current trading parameters
  router.get("/api/settings", (_req: Request, res: Response) => {
    res.json({
      margin_per_trade: settings.marginPerTrade,
      leverage: settings.leverage,
      stop_loss_pct: settings.stopLossPct,
      take_profit_activation_pct: settings.takeProfitActivationPct,
      take_profit_pullback: settings.takeProfitPullback,
      momentum_ticks: settings.momentumTicks,
      volume_periods: settings.volumePeriods,
      rsi_period: settings.rsiPeriod,
      imbalance_buy: settings.imbalanceBuy,
      rsi_buy_max: settings.rsiBuyMax,
      imbalance_sell: settings.imbalanceSell,
      rsi_sell_min: settings.rsiSellMin,
    });
  });

  // POST /api/settings — update trading parameters
  router.post("/api/settings", (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const s: TradingSettings = {
      marginPerTrade: toNum(body.margin_per_trade, 10, 10000),
      leverage: toNum(body.leverage, 1, 100),
      stopLossPct: toNum(body.stop_loss_pct, 1, 50) / 100,
      takeProfitActivationPct: toNum(body.take_profit_activation_pct, 1, 50) / 100,
      takeProfitPullback: toNum(body.take_profit_pullback, 1, 50) / 100,
      momentumTicks: toNum(body.momentum_ticks, 1, 20),
      volumePeriods: toNum(body.volume_periods, 2, 50),
      rsiPeriod: toNum(body.rsi_period, 2, 30),
      imbalanceBuy: toNum(body.imbalance_buy, 0.5, 5),
      rsiBuyMax: toNum(body.rsi_buy_max, 30, 100),
      imbalanceSell: toNum(body.imbalance_sell, 0.1, 2),
      rsiSellMin: toNum(body.rsi_sell_min, 30, 100),
    };
    saveSettings(s);
    console.log("[settings] Updated:", s);
    res.json({ ok: true });
  });

  // Auto-trader status
  router.get("/api/auto-trader", (_req: Request, res: Response) => {
    res.json(getAutoTradeState());
  });

  // Debug: market data status
  router.get("/api/debug", (_req: Request, res: Response) => {
    res.json({
      bids: getBids().length,
      asks: getAsks().length,
      candles: getConfirmedCandles().length,
      priceSamples: getPriceSampleCount(),
      weightedImbalance: getBids().length > 0 ? getWeightedImbalance() : 0,
      hasEnoughData: hasEnoughData(),
      currentPrice: state.currentPrice,
      wsConnected: state.wsConnected,
      autoTraderRunning: getAutoTradeState().running,
    });
  });

  // Auto-trader control
  router.post("/api/auto-trader/stop", (_req: Request, res: Response) => {
    stopAutoTrader();
    resetAutoPosition();
    res.json({ ok: true });
  });

  router.post("/api/auto-trader/start", (_req: Request, res: Response) => {
    startAutoTrader();
    res.json({ ok: true });
  });

  return router;
}

function toNum(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Math.max(min, Math.min(max, isNaN(n) ? min : n));
}
