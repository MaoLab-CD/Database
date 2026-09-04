import { Select } from "antd";
import type { SelectProps } from "antd";

export function AppSelect<ValueType = unknown, OptionType extends object = object>({
  className,
  ...props
}: SelectProps<ValueType, OptionType>) {
  return (
    <Select<ValueType, OptionType>
      {...props}
      className={["app-select", className].filter(Boolean).join(" ")}
    />
  );
}
