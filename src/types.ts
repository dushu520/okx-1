export interface TradingSettings {
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
}

export interface AutoTraderState {
  running: boolean;
  has_position: boolean;
  position_id: number | null;
  side: string | null;
  imbalance: number;
  rsi: number;
  volume_avg: number;
  current_volume: number;
  last_price: number;
}

export interface StateSnapshot {
  current_price: number;
  current_time: string;
  balance: number;
  initial_balance: number;
  total_pnl: number;
  real_balance: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_volume: number;
  total_turnover: number;
  positions: TradeRow[];
  recent_trades: TradeRow[];
  total_position_value: number;
  total_unrealized_pnl: number;
  ws_connected: boolean;
  auto_trader: AutoTraderState;
  candles?: CandlePoint[];
  current_candle?: CandlePoint | null;
  candles_1m?: CandlePoint[];
  current_candle_1m?: CandlePoint | null;
  candles_15m?: CandlePoint[];
  current_candle_15m?: CandlePoint | null;
  candles_1h?: CandlePoint[];
  current_candle_1h?: CandlePoint | null;
  trade_markers?: TradeMarker[];
}

export interface TradeMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: string;
  color: string;
  text: string;
}

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeRow {
  id: number;
  side: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  leverage: number;
  margin: number;
  position_value: number;
  market_value?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  pnl: number;
  pnl_percent: number;
  status: string;
  highest_price: number;
  lowest_price?: number;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string | null;
  inst_id?: string;
  stop_loss_price?: number;
  take_profit_price?: number;
  take_profit_activated?: boolean;
}
