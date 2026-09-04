import { Alert } from "antd";
import type { AlertProps } from "antd";

export function AppAlert({ className, showIcon = true, ...props }: AlertProps) {
  return (
    <Alert
      {...props}
      showIcon={showIcon}
      className={["app-alert", className].filter(Boolean).join(" ")}
    />
  );
}
