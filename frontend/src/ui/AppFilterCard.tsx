import type { ReactNode } from "react";
import { Card } from "antd";

type AppFilterCardProps = {
  children: ReactNode;
  className?: string;
};

export function AppFilterCard({
  children,
  className = "samples-filter-card",
}: AppFilterCardProps) {
  return <Card className={className}>{children}</Card>;
}
