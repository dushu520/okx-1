/**
 * Global shared state (market data only).
 * Per-account state (balance, positions, stats) is now in AccountManager.
 */
export const state = {
  currentPrice: 0,
  swapPrice: 0,
  currentTime: "",
  priceUpdatedAt: 0,

  realBalance: 0,

  wsConnected: false,
};
