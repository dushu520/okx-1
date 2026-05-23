import { useState, useEffect } from "react";
import { StrategyEditor } from "./StrategyEditor";
import type { StrategyConfig, RiskConfig } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TabName = "basic" | "long" | "short" | "advanced";

interface FormState {
  margin_per_trade: number;
  leverage: number;
  stop_loss_pct: number;
  take_profit_activation_pct: number;
  take_profit_pullback: number;
  momentum_ticks: number;
  volume_periods: number;
  rsi_period: number;
  imbalance_buy: number;
  rsi_buy_max: number;
  imbalance_sell: number;
  rsi_sell_min: number;
  strategy_exit: boolean;
  // Full strategy config (advanced mode)
  strategy_config: StrategyConfig | null;
}

const tabs: { key: TabName; label: string }[] = [
  { key: "basic", label: "基本设置" },
  { key: "long", label: "做多条件" },
  { key: "short", label: "做空条件" },
  { key: "advanced", label: "策略编辑器" },
];

export function SettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabName>("basic");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab("basic");
    setMsg("");
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: any) =>
        setForm({
          margin_per_trade: data.margin_per_trade,
          leverage: data.leverage,
          stop_loss_pct: data.stop_loss_pct,
          take_profit_activation_pct: data.take_profit_activation_pct,
          take_profit_pullback: data.take_profit_pullback,
          momentum_ticks: data.momentum_ticks,
          volume_periods: data.volume_periods,
          rsi_period: data.rsi_period,
          imbalance_buy: data.imbalance_buy,
          rsi_buy_max: data.rsi_buy_max,
          imbalance_sell: data.imbalance_sell,
          rsi_sell_min: data.rsi_sell_min,
          strategy_exit: data.strategy_exit,
          strategy_config: data.strategy_config ?? null,
        }),
      )
      .catch(() => setMsg("加载设置失败"));
  }, [open]);

  const update = (k: keyof FormState, v: string) => {
    if (!form) return;
    setForm({ ...form, [k]: parseFloat(v) || 0 });
  };

  const updateStrategyConfig = (config: StrategyConfig) => {
    if (!form) return;
    setForm({ ...form, strategy_config: config });
  };

  const doSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      let body: any;

      if (tab === "advanced" && form.strategy_config) {
        // Advanced mode: save full strategy config
        body = { strategy_config: form.strategy_config };
      } else {
        // Simple mode: compute risk params from form
        body = {
          margin_per_trade: form.margin_per_trade,
          leverage: form.leverage,
          stop_loss_pct: form.stop_loss_pct,
          take_profit_activation_pct: form.take_profit_activation_pct,
          take_profit_pullback: form.take_profit_pullback,
          strategy_exit: form.strategy_exit,
        };
      }

      const resp = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.ok) {
        setMsg("保存成功");
        setTimeout(onClose, 800);
      } else {
        setMsg("保存失败");
      }
    } catch {
      setMsg("请求失败");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const f = form;
  const stopPriceDrop = f && f.leverage > 0
    ? (f.stop_loss_pct / f.leverage).toFixed(1)
    : "2.0";

  return (
    <div className="modal-overlay">
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>交易设置</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`modal-tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === "basic" && (
            <>
              <div className="settings-grid">
                <label className="modal-field">
                  <span>买入金额 (USD)</span>
                  <input
                    type="number" min={10} max={10000}
                    value={f?.margin_per_trade ?? 100}
                    onChange={(e) => update("margin_per_trade", e.target.value)}
                  />
                </label>

                <label className="modal-field">
                  <span>合约倍数</span>
                  <input
                    type="number" min={1} max={100}
                    value={f?.leverage ?? 5}
                    onChange={(e) => update("leverage", e.target.value)}
                  />
                </label>

                <label className="modal-field">
                  <span>止损点 (%)</span>
                  <input
                    type="number" min={1} max={50} step={0.1}
                    value={f?.stop_loss_pct ?? 10}
                    onChange={(e) => update("stop_loss_pct", e.target.value)}
                  />
                  <span className="modal-hint">
                    下跌 {stopPriceDrop}% 触发
                  </span>
                </label>

                <label className="modal-field">
                  <span>止盈回撤 (%)</span>
                  <input
                    type="number" min={1} max={50} step={0.1}
                    value={f?.take_profit_pullback ?? 10}
                    onChange={(e) => update("take_profit_pullback", e.target.value)}
                  />
                  <span className="modal-hint">从最高价回撤 {f?.take_profit_pullback.toFixed(1) ?? "10"}% 止盈</span>
                </label>
              </div>

              <label className="modal-field">
                <span>止盈起点 (%)</span>
                <input
                  type="number" min={1} max={50} step={0.1}
                  value={f?.take_profit_activation_pct ?? 5}
                  onChange={(e) => update("take_profit_activation_pct", e.target.value)}
                />
                <span className="modal-hint">
                  持仓盈利 {f?.take_profit_activation_pct.toFixed(1) ?? "5"}% 启动追踪止盈
                </span>
              </label>

              <hr className="modal-sep" />

              <label className="modal-field" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={f?.strategy_exit ?? true}
                  onChange={(e) => {
                    if (!f) return;
                    setForm({ ...f, strategy_exit: e.target.checked });
                  }}
                  style={{ width: 18, height: 18 }}
                />
                <span>策略平仓</span>
              </label>
              <span className="modal-hint" style={{ marginTop: -8 }}>
                启用后，自动交易将根据策略信号平仓。关闭后仅依赖止盈止损平仓。
              </span>
            </>
          )}

          {tab === "long" && (
            <>
              <label className="modal-field">
                <span>失衡度买入阈值</span>
                <input
                  type="number" min={0.5} max={5} step={0.01}
                  value={f?.imbalance_buy ?? 1.2}
                  onChange={(e) => update("imbalance_buy", e.target.value)}
                />
                <span className="modal-hint">挂单失衡度大于此值时触发买入 (bidVol / askVol)</span>
              </label>

              <label className="modal-field">
                <span>RSI 上限</span>
                <input
                  type="number" min={30} max={100}
                  value={f?.rsi_buy_max ?? 70}
                  onChange={(e) => update("rsi_buy_max", e.target.value)}
                />
                <span className="modal-hint">RSI 低于此值时允许买入（避免超买）</span>
              </label>

              <hr className="modal-sep" />
              <p className="modal-tip">提示：使用"策略编辑器"标签页可以更灵活地配置入场/出场条件组。</p>
            </>
          )}

          {tab === "short" && (
            <>
              <label className="modal-field">
                <span>失衡度卖出阈值</span>
                <input
                  type="number" min={0.1} max={2} step={0.01}
                  value={f?.imbalance_sell ?? 0.83}
                  onChange={(e) => update("imbalance_sell", e.target.value)}
                />
                <span className="modal-hint">挂单失衡度小于此值时触发做空</span>
              </label>

              <label className="modal-field">
                <span>RSI 下限</span>
                <input
                  type="number" min={30} max={100}
                  value={f?.rsi_sell_min ?? 70}
                  onChange={(e) => update("rsi_sell_min", e.target.value)}
                />
                <span className="modal-hint">RSI 高于此值时允许做空（确认超买后回落）</span>
              </label>

              <hr className="modal-sep" />
              <p className="modal-tip">提示：使用"策略编辑器"标签页可以更灵活地配置入场/出场条件组。</p>
            </>
          )}

          {tab === "advanced" && f?.strategy_config && (
            <StrategyEditor config={f.strategy_config} onChange={updateStrategyConfig} />
          )}
        </div>

        <div className="modal-footer">
          {msg && <span className={`modal-msg ${msg === "保存成功" ? "ok" : "err"}`}>{msg}</span>}
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={doSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
