import { useState, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { ConnectionBanner } from "./ConnectionBanner";
import { PositionsTable } from "./PositionsTable";
import { TradeHistory } from "./TradeHistory";
import { SettingsModal } from "./SettingsModal";
import { TradeDetailModal } from "./TradeDetailModal";
import { PriceChart } from "./PriceChart";
import type { TradingSettings, TradeRow } from "../types";

export function Dashboard() {
  const snapshot = useWebSocket();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tradingSettings, setTradingSettings] = useState<TradingSettings | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<TradeRow | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: TradingSettings) => setTradingSettings(s))
      .catch(() => {});
  }, []);

  const d = snapshot;

  const price = d?.current_price ?? 0;
  const balance = d?.balance ?? 10000;
  const initialBalance = d?.initial_balance ?? 10000;
  const totalPnl = d?.total_pnl ?? 0;
  const realBalance = d?.real_balance ?? 0;
  const totalTrades = d?.total_trades ?? 0;
  const wins = d?.winning_trades ?? 0;
  const losses = d?.losing_trades ?? 0;
  const volume = d?.total_volume ?? 0;
  const turnover = d?.total_turnover ?? 0;
  const positions = d?.positions ?? [];
  const recentTrades = d?.recent_trades ?? [];
  const totalPositionValue = d?.total_position_value ?? 0;
  const totalUnrealizedPnl = d?.total_unrealized_pnl ?? 0;
  const wsConnected = d?.ws_connected ?? false;
  const autoTrader = d?.auto_trader;
  const candles = d?.candles;
  const currentCandle = d?.current_candle;
  const tradeMarkers = d?.trade_markers ?? [];
  const atRunning = autoTrader?.running ?? false;
  const atImbalance = autoTrader?.imbalance ?? 0;
  const atRsi = autoTrader?.rsi ?? 0;
  const atSide = autoTrader?.side;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : "--";
  const pnlPct = initialBalance > 0 ? ((totalPnl / initialBalance) * 100).toFixed(1) : "0.0";

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  };

  const doBuy = async () => {
    try {
      const resp = await fetch("/api/buy", { method: "POST" });
      const data = await resp.json();
      if (data.ok) {
        showMsg(
          `买入成功! 入场价: $${Number(data.entry_price).toFixed(2)} | 保证金: $${data.margin} | 仓位: $${data.position_value}`,
          true
        );
      } else {
        showMsg(data.error || "买入失败", false);
      }
    } catch {
      showMsg("请求失败", false);
    }
  };

  const doSell = async (id: number) => {
    try {
      const resp = await fetch(`/api/sell/${id}`, { method: "POST" });
      const data = await resp.json();
      if (data.ok) {
        showMsg(
          `平仓成功! 盈亏: $${Number(data.pnl).toFixed(2)} (${Number(data.pnl_percent).toFixed(1)}%)`,
          data.pnl >= 0
        );
      } else {
        showMsg(data.error || "平仓失败", false);
      }
    } catch {
      showMsg("请求失败", false);
    }
  };

  return (
    <>
      <ConnectionBanner connected={wsConnected} price={price} />

      <div className="header">
        <div className="header-left">
          <h1>OKX 模拟交易</h1>
          <span>
            <span className={`ws-dot ${wsConnected ? "on" : "off"}`} />
            <span className="ws-status">
              {!wsConnected ? "未连接" : price > 0 ? "已连接" : "连接中..."}
            </span>
          </span>
          <span>
            <span className={`at-dot ${atRunning ? "on" : "off"}`} />
            <span className="at-status">
              {atRunning ? `自动 ${atSide === "short" ? "空" : "多"}` : "自动停止"}
            </span>
          </span>
          <button className="btn-settings" onClick={() => setShowSettings(true)} title="交易设置">
            ⚙
          </button>
        </div>
        <div className="price-display">
          {price > 0 ? "$" + price.toFixed(2) : "--"}
        </div>
        <div className="time-display">{d?.current_time ?? ""}</div>
      </div>

      <div className="layout-main">
        {/* Left: Chart */}
        <div className="layout-chart">
          <PriceChart
            candles={candles}
            currentCandle={currentCandle}
            autoTrader={autoTrader}
            currentPrice={price}
            positions={positions}
            recentTrades={recentTrades}
            tradeMarkers={tradeMarkers}
            candleMap={{
              "1m": { candles: d?.candles_1m, currentCandle: d?.current_candle_1m },
              "5m": { candles, currentCandle },
              "15m": { candles: d?.candles_15m, currentCandle: d?.current_candle_15m },
              "1H": { candles: d?.candles_1h, currentCandle: d?.current_candle_1h },
            }}
          />
        </div>

        {/* Right: Indicators + Stats */}
        <div className="layout-sidebar">
          {/* Key Indicators */}
          <div className="indicator-grid">
            <div className="indicator-card">
              <div className="indicator-label">失衡度</div>
              <div className={`indicator-value ${atImbalance > 1.2 ? "up" : atImbalance < 0.83 ? "down" : ""}`}>
                {atImbalance.toFixed(2)}
              </div>
              <div className="indicator-desc">{atImbalance > 1.2 ? "偏多" : atImbalance < 0.83 ? "偏空" : "中性"}</div>
            </div>
            <div className="indicator-card">
              <div className="indicator-label">RSI({tradingSettings?.rsi_period ?? 5})</div>
              <div className={`indicator-value ${atRsi > 70 ? "down" : atRsi < 30 ? "up" : ""}`}>
                {atRsi.toFixed(1)}
              </div>
              <div className="indicator-desc">{atRsi > 70 ? "超买" : atRsi < 30 ? "超卖" : "中性"}</div>
            </div>
            <div className="indicator-card">
              <div className="indicator-label">成交量</div>
              <div className="indicator-value">
                {autoTrader?.current_volume?.toFixed(0) ?? "--"}
              </div>
              <div className="indicator-desc">
                均量 {autoTrader?.volume_avg?.toFixed(0) ?? "--"}
              </div>
            </div>
            <div className="indicator-card">
              <div className="indicator-label">持仓方向</div>
              <div className={`indicator-value ${positions.length > 0 ? (positions[0]?.side === "short" ? "down" : "up") : ""}`}>
                {positions.length > 0 ? (positions[0]?.side === "short" ? "做空" : "做多") : "--"}
              </div>
              <div className="indicator-desc">
                {positions.length > 0 ? `${positions.length} 笔` : "无持仓"}
              </div>
            </div>
          </div>

          {/* Compact Stats */}
          <div className="stats-compact">
            <div className="stats-compact-title">账户概览</div>
            <div className="stats-compact-grid">
              <div className="stats-compact-item">
                <span className="stats-compact-label">余额</span>
                <span className="stats-compact-value" style={{ color: balance >= initialBalance ? "var(--green)" : "var(--red)" }}>
                  ${balance.toFixed(2)}
                </span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">总盈亏</span>
                <span className="stats-compact-value" style={{ color: totalPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                  <span className="stats-compact-sub"> ({totalPnl >= 0 ? "+" : ""}{pnlPct}%)</span>
                </span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">交易</span>
                <span className="stats-compact-value">{totalTrades}</span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">胜率</span>
                <span className="stats-compact-value" style={{ color: winRate !== "--" ? (parseFloat(winRate) >= 50 ? "var(--green)" : "var(--red)") : undefined }}>
                  {winRate}{winRate !== "--" ? "%" : ""}
                </span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">仓位价值</span>
                <span className="stats-compact-value">${totalPositionValue.toFixed(2)}</span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">浮动盈亏</span>
                <span className="stats-compact-value" style={{ color: totalUnrealizedPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
                </span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">盈利</span>
                <span className="stats-compact-value" style={{ color: "var(--green)" }}>{wins}</span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">亏损</span>
                <span className="stats-compact-value" style={{ color: "var(--red)" }}>{losses}</span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">真实余额</span>
                <span className="stats-compact-value" style={{ color: "var(--yellow)" }}>
                  {realBalance > 0 ? "$" + realBalance.toFixed(2) : "--"}
                </span>
              </div>
              <div className="stats-compact-item">
                <span className="stats-compact-label">成交量</span>
                <span className="stats-compact-value">${volume.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar + Positions */}
      <div className="layout-bottom">
        <div className="action-bar">
          <button className="btn-buy" onClick={doBuy} disabled={price <= 0 || !wsConnected}>
            买入 BTC ({tradingSettings?.leverage ?? 5}x {tradingSettings?.margin_per_trade ?? 100}$)
          </button>
          {msg && (
            <span className={`msg show ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>
          )}
        </div>

        <div className="section">
          <div className="section-title">当前持仓 ({positions.length})</div>
          <div className="table-wrap">
            <PositionsTable positions={positions} currentPrice={price} onSell={doSell} onSelect={setSelectedTrade} />
          </div>
        </div>

        <div className="section">
          <div className="section-title">交易记录</div>
          <div className="table-wrap">
            <TradeHistory trades={recentTrades} onSelect={setSelectedTrade} />
          </div>
        </div>
      </div>

      <TradeDetailModal
        trade={selectedTrade}
        currentPrice={price}
        onClose={() => setSelectedTrade(null)}
      />

      <SettingsModal
        open={showSettings}
        onClose={() => {
          setShowSettings(false);
          fetch("/api/settings")
            .then((r) => r.json())
            .then((s: TradingSettings) => setTradingSettings(s))
            .catch(() => {});
        }}
      />
    </>
  );
}
