export function StatCard({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="card stat-card">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
