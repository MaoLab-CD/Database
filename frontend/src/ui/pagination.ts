import type { TablePaginationConfig } from "antd";

type AppPaginationOptions = {
  page: number;
  pageSize: number;
  total: number;
  unit?: string;
  showQuickJumper?: boolean;
  onChange: (page: number, pageSize: number) => void;
};

export function createTablePagination({
  page,
  pageSize,
  total,
  unit = "条",
  showQuickJumper = true,
  onChange,
}: AppPaginationOptions): TablePaginationConfig {
  return {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    showQuickJumper,
    showTotal: (count) => `共 ${count} ${unit}`,
    onChange,
  };
}
