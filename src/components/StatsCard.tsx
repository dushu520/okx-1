interface Props {
  label: string;
  value: string;
  color?: string;
}

export function StatsCard({ label, value, color }: Props) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
