import { Button } from "antd";
import type { ButtonProps } from "antd";

type AppButtonProps = ButtonProps & {
  tone?: "primary" | "secondary" | "danger" | "quiet";
};

export function AppButton({
  tone = "primary",
  className,
  ...props
}: AppButtonProps) {
  const buttonType = tone === "primary" ? "primary" : "default";
  const danger = tone === "danger" || props.danger;

  return (
    <Button
      {...props}
      type={buttonType}
      danger={danger}
      className={["app-button", `app-button-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
