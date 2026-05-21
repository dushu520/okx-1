import type { TradeRow } from "../types";

interface Props {
  positions: TradeRow[];
  currentPrice: number;
  onSell: (id: number) => void;
  onSelect: (t: TradeRow) => void;
}

export function PositionsTable({ positions, currentPrice, onSell, onSelect }: Props) {
  if (!positions.length) {
    return <div className="empty-state">暂无持仓</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>币种</th>
          <th>类型</th>
          <th>合约</th>
          <th>持有数量</th>
          <th>开仓价</th>
          <th>当前价</th>
          <th>保证金</th>
          <th>仓位价值</th>
          <th>当前市值</th>
          <th>浮动盈亏</th>
          <th>收益率</th>
          <th>开仓时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const quantity = p.entry_price > 0
            ? p.position_value / p.entry_price
            : 0;
          const marketValue = currentPrice > 0
            ? quantity * currentPrice
            : p.position_value;
          const upnl = marketValue - p.position_value;
          const upnlPct = p.margin > 0 ? (upnl / p.margin) * 100 : 0;
          const pnlClass = upnl >= 0 ? "pnl-pos" : "pnl-neg";

          return (
            <tr key={p.id} className="clickable-row" onClick={() => onSelect(p)}>
              <td>#{p.id}</td>
              <td>{p.inst_id ?? "BTC-USDT"}</td>
              <td style={{ color: "var(--green)" }}>多</td>
              <td>{p.leverage}x</td>
              <td>{quantity.toFixed(8)}</td>
              <td>${p.entry_price.toFixed(2)}</td>
              <td>{currentPrice > 0 ? "$" + currentPrice.toFixed(2) : "--"}</td>
              <td>${p.margin.toFixed(2)}</td>
              <td>${p.position_value.toFixed(2)}</td>
              <td>{currentPrice > 0 ? "$" + marketValue.toFixed(2) : "--"}</td>
              <td className={pnlClass}>
                {currentPrice > 0 ? "$" + upnl.toFixed(2) : "--"}
              </td>
              <td className={pnlClass}>
                {currentPrice > 0 ? upnlPct.toFixed(1) + "%" : "--"}
              </td>
              <td>{p.entry_time}</td>
              <td>
                <button className="btn-sell" onClick={(e) => { e.stopPropagation(); onSell(p.id); }}>
                  平仓
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
