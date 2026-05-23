import { useState } from "react";
import type { StrategyConfig, ConditionGroup, Condition } from "../types";
import { INDICATORS, OPERATORS } from "../types";

interface Props {
  config: StrategyConfig;
  onChange: (config: StrategyConfig) => void;
}

type Direction = "long" | "short";

const GROUP_LABELS: Record<string, string> = {
  long_entry: "做多入场",
  long_exit: "做多出场",
  short_entry: "做空入场",
  short_exit: "做空出场",
};

export function StrategyEditor({ config, onChange }: Props) {
  const [direction, setDirection] = useState<Direction>("long");

  const updateGroup = (key: keyof StrategyConfig, group: ConditionGroup) => {
    onChange({ ...config, [key]: group });
  };

  const addCondition = (groupKey: keyof StrategyConfig) => {
    const group = { ...config[groupKey] as ConditionGroup };
    group.conditions = [...group.conditions, { indicator: "imbalance", operator: ">", value: 1, params: {} }];
    updateGroup(groupKey, group);
  };

  const removeCondition = (groupKey: keyof StrategyConfig, idx: number) => {
    const group = { ...config[groupKey] as ConditionGroup };
    group.conditions = group.conditions.filter((_: any, i: number) => i !== idx);
    updateGroup(groupKey, group);
  };

  const updateCondition = (groupKey: keyof StrategyConfig, idx: number, cond: Condition) => {
    const group = { ...config[groupKey] as ConditionGroup };
    group.conditions = group.conditions.map((c: Condition, i: number) => i === idx ? cond : c);
    updateGroup(groupKey, group);
  };

  const toggleOperator = (groupKey: keyof StrategyConfig) => {
    const group = { ...config[groupKey] as ConditionGroup };
    group.operator = group.operator === "AND" ? "OR" : "AND";
    updateGroup(groupKey, group);
  };

  const renderGroup = (groupKey: keyof StrategyConfig) => {
    const group = config[groupKey] as ConditionGroup;

    return (
      <div className="se-group" key={groupKey}>
        <div className="se-group-header">
          <span className="se-group-label">{GROUP_LABELS[groupKey] ?? groupKey}</span>
          <button
            className="se-add-condition-btn"
            onClick={() => addCondition(groupKey)}
            title="添加条件"
          >
            + 条件
          </button>
        </div>

        {group.conditions.length === 0 && (
          <div className="se-empty">无条件 — 信号永不触发</div>
        )}

        {group.conditions.map((cond: Condition, i: number) => (
          <div className="se-condition" key={i}>
            {i > 0 && (
              <div className="se-operator-row">
                <button className="se-operator-btn" onClick={() => toggleOperator(groupKey)}>
                  {group.operator}
                </button>
              </div>
            )}
            <div className="se-condition-row">
              <select
                className="se-select"
                value={cond.indicator}
                onChange={(e) => updateCondition(groupKey, i, { ...cond, indicator: e.target.value })}
              >
                {INDICATORS.map((ind) => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
              <select
                className="se-select se-select-operator"
                value={cond.operator}
                onChange={(e) => updateCondition(groupKey, i, { ...cond, operator: e.target.value as any })}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <input
                className="se-input"
                type="number"
                step={0.01}
                value={cond.value}
                onChange={(e) => updateCondition(groupKey, i, { ...cond, value: parseFloat(e.target.value) || 0 })}
              />
              <button className="se-remove-btn" onClick={() => removeCondition(groupKey, i)} title="删除条件">
                ✕
              </button>
            </div>
            {cond.indicator === "rsi" && (
              <div className="se-params">
                <label>周期: <input className="se-param-input" type="number" min={2} max={30}
                  value={(cond.params?.rsi_period as number) ?? 5}
                  onChange={(e) => updateCondition(groupKey, i, { ...cond, params: { ...cond.params, rsi_period: parseInt(e.target.value) || 5 } })}
                /></label>
              </div>
            )}
            {cond.indicator === "momentum" && (
              <div className="se-params">
                <label>方向:
                  <select className="se-select" value={String(cond.params?.direction ?? "up")}
                    onChange={(e) => updateCondition(groupKey, i, { ...cond, params: { ...cond.params, direction: e.target.value } })}
                  >
                    <option value="up">上涨</option>
                    <option value="down">下跌</option>
                  </select>
                </label>
                <label>Ticks: <input className="se-param-input" type="number" min={1} max={20}
                  value={(cond.params?.momentum_ticks as number) ?? 3}
                  onChange={(e) => updateCondition(groupKey, i, { ...cond, params: { ...cond.params, momentum_ticks: parseInt(e.target.value) || 3 } })}
                /></label>
              </div>
            )}
            {cond.indicator === "volume_ratio" && (
              <div className="se-params">
                <label>均线周期: <input className="se-param-input" type="number" min={2} max={50}
                  value={(cond.params?.volume_periods as number) ?? 10}
                  onChange={(e) => updateCondition(groupKey, i, { ...cond, params: { ...cond.params, volume_periods: parseInt(e.target.value) || 10 } })}
                /></label>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="strategy-editor">
      <p className="se-description">
        条件满足时触发信号。<code>AND</code> = 全部满足，<code>OR</code> = 任一满足。
      </p>

      {/* Direction toggle */}
      <div className="se-direction-tabs">
        <button
          className={`se-dir-tab ${direction === "long" ? "active" : ""}`}
          onClick={() => setDirection("long")}
        >
          做多
        </button>
        <button
          className={`se-dir-tab ${direction === "short" ? "active" : ""}`}
          onClick={() => setDirection("short")}
        >
          做空
        </button>
      </div>

      {direction === "long" && (
        <>
          {renderGroup("long_entry")}
          {renderGroup("long_exit")}
        </>
      )}
      {direction === "short" && (
        <>
          {renderGroup("short_entry")}
          {renderGroup("short_exit")}
        </>
      )}
    </div>
  );
}
