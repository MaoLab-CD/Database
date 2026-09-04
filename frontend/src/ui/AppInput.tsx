import { Input } from "antd";
import type { InputProps, PasswordProps } from "antd/es/input";

export function AppInput({ className, ...props }: InputProps) {
  return (
    <Input
      {...props}
      className={["app-input", className].filter(Boolean).join(" ")}
    />
  );
}

export function AppPasswordInput({ className, ...props }: PasswordProps) {
  return (
    <Input.Password
      {...props}
      className={["app-input", className].filter(Boolean).join(" ")}
    />
  );
}
