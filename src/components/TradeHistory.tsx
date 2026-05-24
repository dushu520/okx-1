import type { TradeRow } from "../types";

interface Props {
  trades: TradeRow[];
  onSelect: (t: TradeRow) => void;
}

const reasonLabels: Record<string, string> = {
  stop_loss: "止损",
  take_profit: "止盈",
  manual: "手动",
};

export function TradeHistory({ trades, onSelect }: Props) {
  if (!trades.length) {
    return <div className="empty-state">暂无交易记录</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>币种</th>
          <th>方向</th>
          <th>合约</th>
          <th>入场价</th>
          <th>出场价</th>
          <th>保证金</th>
          <th>盈亏</th>
          <th>盈亏%</th>
          <th>出场原因</th>
          <th>入场时间</th>
          <th>出场时间</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const pnl = t.pnl;
          const pnlPct = t.pnl_percent;
          return (
            <tr key={t.id} className="clickable-row" onClick={() => onSelect(t)}>
              <td>#{t.id}</td>
              <td>{t.inst_id ?? "BTC-USDT"}</td>
              <td style={{ color: t.side === "short" ? "var(--red)" : "var(--green)" }}>
                {t.side === "short" ? "空" : "多"}
              </td>
              <td>{t.leverage}x</td>
              <td>${t.entry_price.toFixed(2)}</td>
              <td>${(t.exit_price ?? 0).toFixed(2)}</td>
              <td>${t.margin.toFixed(2)}</td>
              <td className={pnl >= 0 ? "pnl-pos" : "pnl-neg"}>
                ${pnl.toFixed(2)}
              </td>
              <td className={pnlPct >= 0 ? "pnl-pos" : "pnl-neg"}>
                {pnlPct.toFixed(1)}%
              </td>
              <td>{reasonLabels[t.exit_reason ?? ""] || t.exit_reason || "-"}</td>
              <td>{t.entry_time}</td>
              <td>{t.exit_time || "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
