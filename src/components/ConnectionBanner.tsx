interface Props {
  connected: boolean;
  price: number;
}

export function ConnectionBanner({ connected, price }: Props) {
  const noPrice = price <= 0;

  if (connected && !noPrice) return null;

  return (
    <div
      style={{
        background: noPrice ? "#3d1a1a" : "#1a2333",
        color: noPrice ? "#f85149" : "#8b949e",
        textAlign: "center",
        padding: "8px",
        fontSize: "13px",
        fontWeight: 600,
        borderBottom: `1px solid ${noPrice ? "#6a2d2d" : "#30363d"}`,
      }}
    >
      {noPrice
        ? "⏳ 正在连接 WebSocket 获取实时价格数据..."
        : connected
          ? ""
          : "⚠️ WebSocket 连接断开，正在重连..."}
    </div>
  );
}
