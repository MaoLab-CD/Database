import type { ReactNode } from "react";
import { Card } from "antd";

export type SummaryItem = {
  key: string;
  label: ReactNode;
  value: ReactNode;
};

type AppSummaryGridProps = {
  items: SummaryItem[];
  className?: string;
};

export function AppSummaryGrid({
  items,
  className = "records-summary-grid",
}: AppSummaryGridProps) {
  return (
    <div className={className}>
      {items.map((item) => (
        <Card key={item.key} className="records-summary-card">
          <div>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        </Card>
      ))}
    </div>
  );
}
