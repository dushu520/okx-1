import type { TradeRow } from "../types";

interface Props {
  trade: TradeRow | null;
  currentPrice: number;
  onClose: () => void;
}

const reasonLabels: Record<string, string> = {
  stop_loss: "止损",
  take_profit: "止盈",
  manual: "手动",
};

function Item({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="detail-item">
      <span className="detail-item-label">{label}</span>
      <span className="detail-item-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export function TradeDetailModal({ trade, currentPrice, onClose }: Props) {
  if (!trade) return null;

  const isLong = trade.side === "long" || !trade.side;
  const isOpen = trade.status === "open";

  // Direction display
  const directionLabel = isLong ? "做多" : "做空";
  const directionColor = isLong ? "var(--green)" : "var(--red)";

  // Quantity & market value
  const quantity = trade.entry_price > 0 ? trade.position_value / trade.entry_price : 0;
  const rawMarketValue = isOpen && currentPrice > 0
    ? quantity * currentPrice
    : trade.exit_price
      ? quantity * trade.exit_price
      : trade.position_value;
  // PnL: short profits when price drops (position_value - market_value)
  const pnl = isOpen
    ? (currentPrice > 0
      ? (isLong ? rawMarketValue - trade.position_value : trade.position_value - rawMarketValue)
      : 0)
    : trade.pnl;
  const pnlPct = isOpen
    ? (trade.margin > 0 && currentPrice > 0 ? (pnl / trade.margin) * 100 : 0)
    : trade.pnl_percent;
  const pnlColor = pnl >= 0 ? "var(--green)" : "var(--red)";

  // Market value displayed (absolute, always positive)
  const marketValue = rawMarketValue;

  // TP/SL derived from position data
  const tp = trade.take_profit_price ?? 0;
  const sl = trade.stop_loss_price ?? 0;
  const hasTp = tp > 0;
  const hasSl = sl > 0;

  // Color logic depends on direction
  const slLongHit = isLong && sl > 0 && currentPrice <= sl;
  const slShortHit = !isLong && sl > 0 && currentPrice >= sl;
  const slColor = slLongHit || slShortHit ? "var(--red)" : undefined;
  const tpLongHit = isLong && tp > 0 && currentPrice >= tp;
  const tpShortHit = !isLong && tp > 0 && currentPrice <= tp;
  const tpColor = tpLongHit || tpShortHit ? "var(--green)" : undefined;

  // Price direction color
  const priceUpColor = isLong
    ? (currentPrice >= trade.entry_price ? "var(--green)" : "var(--red)")
    : (currentPrice <= trade.entry_price ? "var(--green)" : "var(--red)");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>交易详情 #{trade.id}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* TP/SL row — always first */}
          <div className="detail-grid-tpsl">
            <Item
              label="止损价"
              value={hasSl ? `$${sl.toFixed(2)}` : "未设置"}
              color={slColor}
            />
            <Item
              label={hasTp ? (trade.take_profit_activated ? "止盈追踪" : "止盈激活") : "止盈价"}
              value={hasTp ? `$${tp.toFixed(2)}` : "未设置"}
              color={tpColor}
            />
          </div>

          {/* Main info in 2-column grid */}
          <div className="detail-grid">
            <Item label="方向" value={directionLabel} color={directionColor} />
            <Item label="开仓价" value={`$${trade.entry_price.toFixed(2)}`} />
            {isOpen ? (
              <Item
                label="当前价"
                value={`$${currentPrice.toFixed(2)}`}
                color={priceUpColor}
              />
            ) : (
              <Item label="平仓价" value={`$${(trade.exit_price ?? 0).toFixed(2)}`} />
            )}
            <Item label="合约倍数" value={`${trade.leverage}x`} />
            <Item label="最高价" value={`$${(trade.highest_price ?? trade.entry_price).toFixed(2)}`} />
            <Item label="最低价" value={`$${(trade.lowest_price ?? trade.entry_price).toFixed(2)}`} />
            <Item label="保证金" value={`$${trade.margin.toFixed(2)}`} />
            <Item label="仓位价值" value={`$${trade.position_value.toFixed(2)}`} />
            <Item label="当前市值" value={`$${marketValue.toFixed(2)}`} color="var(--blue)" />
            <Item label="持有数量" value={`${quantity.toFixed(8)} BTC`} />
            <Item label="盈亏" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`} color={pnlColor} />
            <Item label="收益率" value={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`} color={pnlColor} />
            <Item label="开仓时间" value={trade.entry_time} />
            {!isOpen && <Item label="平仓时间" value={trade.exit_time || "-"} />}
            {!isOpen && (
              <Item
                label="平仓原因"
                value={reasonLabels[trade.exit_reason ?? ""] || trade.exit_reason || "-"}
                color={trade.exit_reason === "take_profit" ? "var(--green)" : trade.exit_reason === "stop_loss" ? "var(--red)" : undefined}
              />
            )}
            <Item
              label="状态"
              value={isOpen ? "持仓中" : "已平仓"}
              color={isOpen ? "var(--green)" : "var(--text-dim)"}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
