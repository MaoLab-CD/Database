import type { ReactNode } from "react";
import { Card } from "antd";

type AppTableCardProps = {
  children: ReactNode;
  title: ReactNode;
  total: number;
  totalLabel?: string;
  extra?: ReactNode;
  className?: string;
};

export function AppTableCard({
  children,
  title,
  total,
  totalLabel = "条",
  extra,
  className = "samples-table-card",
}: AppTableCardProps) {
  return (
    <Card
      className={className}
      title={title}
      extra={extra ?? <span className="table-total">共 {total} {totalLabel}</span>}
    >
      {children}
    </Card>
  );
}
