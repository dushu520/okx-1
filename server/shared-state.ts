/**
 * Module-level shared state (no asyncio.Lock needed in Node.js single thread).
 * Mutations are synchronous and atomic.
 */
export const state = {
  currentPrice: 0,
  currentTime: "",
  priceUpdatedAt: 0,

  balance: 10000,
  initialBalance: 10000,
  totalPnl: 0,

  realBalance: 0,

  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalVolume: 0,
  totalTurnover: 0,

  positions: [] as any[],
  recentTrades: [] as any[],

  totalPositionValue: 0,
  totalUnrealizedPnl: 0,

  wsConnected: false,

  getSnapshot(): any {
    return {
      current_price: this.currentPrice,
      current_time: this.currentTime,
      balance: this.balance,
      initial_balance: this.initialBalance,
      total_pnl: this.totalPnl,
      real_balance: this.realBalance,
      total_trades: this.totalTrades,
      winning_trades: this.winningTrades,
      losing_trades: this.losingTrades,
      total_volume: this.totalVolume,
      total_turnover: this.totalTurnover,
      positions: this.positions,
      recent_trades: this.recentTrades,
      total_position_value: this.totalPositionValue,
      total_unrealized_pnl: this.totalUnrealizedPnl,
      ws_connected: this.wsConnected,
      auto_trader: this.autoTraderState,
    };
  },

  autoTraderState: { running: false, has_position: false, position_id: null, imbalance: 0, rsi: 0 },
};
