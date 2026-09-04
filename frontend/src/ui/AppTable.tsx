import { Table } from "antd";
import type { TableProps } from "antd";

type AppTableProps<RecordType extends object> = TableProps<RecordType> & {
  scrollX?: number | string;
};

export function AppTable<RecordType extends object>({
  scroll,
  scrollX,
  sticky,
  ...props
}: AppTableProps<RecordType>) {
  return (
    <Table<RecordType>
      sticky={sticky ?? { offsetHeader: 0 }}
      scroll={{ ...scroll, x: scroll?.x ?? scrollX }}
      {...props}
    />
  );
}
