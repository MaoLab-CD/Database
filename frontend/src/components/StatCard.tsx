import type { ReactNode } from "react";
import { Card } from "antd";

export function StatCard({
  label,
  value,
  note,
  icon,
  tone = "blue",
}: {
  label: string;
  value: number;
  note: string;
  icon: ReactNode;
  tone?: "blue" | "green" | "amber" | "slate" | "cyan";
}) {
  return (
    <Card className={`dashboard-stat dashboard-stat-${tone}`}>
      <div className="dashboard-stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}</strong>
        <small>{note}</small>
      </div>
    </Card>
  );
}
