import { RefreshCw } from "lucide-react";
import { Card, Typography } from "antd";

export function PlaceholderPage() {
  return (
    <Card className="placeholder-card">
      <div className="placeholder-state">
        <RefreshCw />
        <Typography.Title level={2}>正在开发中</Typography.Title>
        <Typography.Paragraph>
          该功能暂未开放。
        </Typography.Paragraph>
      </div>
    </Card>
  );
}
