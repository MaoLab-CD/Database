import { Tag } from "antd";

export const STATUS_LABELS: Record<string, string> = {
  pending: "待确认",
  not_stored: "未入库",
  sequencing: "测序中",
  in_storage: "在库",
  checked_out: "已出库",
  return_pending: "待归还复核",
  consumed: "已用完",
  lost: "丢失",
  discarded: "废弃",
  archived: "归档",
  none: "暂无数据",
  available: "数据完整",
  incomplete: "文件不完整",
  unmatched: "未匹配样本",
  changed: "文件变化",
  missing: "路径缺失",
};

export const SAMPLE_STATUS_OPTIONS = [
  { value: "not_stored", label: "未入库" },
  { value: "sequencing", label: "测序中" },
  { value: "in_storage", label: "在库" },
  { value: "checked_out", label: "已出库" },
  { value: "return_pending", label: "待归还复核" },
  { value: "consumed", label: "已用完" },
  { value: "lost", label: "丢失" },
  { value: "discarded", label: "废弃" },
  { value: "archived", label: "归档" },
];

export const SEQUENCING_STATUS_OPTIONS = [
  { value: "none", label: "暂无数据" },
  { value: "available", label: "数据完整" },
  { value: "incomplete", label: "文件不完整" },
  { value: "unmatched", label: "未匹配样本" },
  { value: "changed", label: "文件变化" },
  { value: "missing", label: "路径缺失" },
  { value: "archived", label: "归档" },
];

export function statusTag(status: string, kind: "sample" | "sequencing" = "sample") {
  const label = STATUS_LABELS[status] ?? status;
  const colorMap: Record<string, string> = {
    in_storage: "green",
    not_stored: "default",
    sequencing: "blue",
    checked_out: "orange",
    return_pending: "gold",
    consumed: "default",
    lost: "red",
    discarded: "red",
    archived: "default",
    none: "default",
    available: "cyan",
    incomplete: "orange",
    unmatched: "gold",
    changed: "purple",
    missing: "red",
  };
  return <Tag color={colorMap[status] ?? (kind === "sample" ? "blue" : "cyan")}>{label}</Tag>;
}

export function getBarToneClass(name: string) {
  if (["in_storage", "available"].includes(name)) {
    return "bar-fill-green";
  }
  if (["checked_out", "return_pending", "sequencing", "unmatched", "incomplete", "missing"].includes(name)) {
    return "bar-fill-amber";
  }
  if (["consumed", "lost", "discarded"].includes(name)) {
    return "bar-fill-red";
  }
  if (name === "none") {
    return "bar-fill-muted";
  }
  return "bar-fill-blue";
}
