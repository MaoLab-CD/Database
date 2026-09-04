import type { ReactNode } from "react";
import { Card, Descriptions, Tag } from "antd";
import { Download } from "lucide-react";

import type { ImportBatchItem, ImportErrorItem, ImportStatus } from "../api/imports";
import { formatFullDateTime, valueText } from "../utils/format";
import { AppButton } from "../ui";

const IMPORT_TYPE_LABELS: Record<string, string> = {
  sample: "样本信息",
  dna_plate: "DNA 板位",
  genome: "基因组信息",
  sequencing_send: "送测",
  sequencing_return: "测序返还",
  qc_feedback: "QC 反馈",
};

export function importTypeLabel(importType: string) {
  return IMPORT_TYPE_LABELS[importType] ?? importType;
}

export function ImportStatusTag({ status }: { status: ImportStatus }) {
  const colorMap: Record<ImportStatus, string> = {
    imported: "green",
    partial: "orange",
    failed: "red",
    previewed: "blue",
    cancelled: "default",
  };
  const labelMap: Record<ImportStatus, string> = {
    imported: "已导入",
    partial: "部分成功",
    failed: "失败",
    previewed: "已预览",
    cancelled: "已取消",
  };
  return <Tag color={colorMap[status]}>{labelMap[status] ?? status}</Tag>;
}

function normalizeImportError(error: unknown): ImportErrorItem {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const item = error as Partial<ImportErrorItem>;
    return {
      row_number: item.row_number ?? null,
      sample_id: item.sample_id ?? null,
      reason: item.reason ?? "未知错误",
    };
  }
  return {
    row_number: null,
    sample_id: null,
    reason: String(error),
  };
}

export function ImportErrorList({ errors }: { errors: unknown[] }) {
  const normalized = errors.map(normalizeImportError);
  if (normalized.length === 0) {
    return <div className="empty-small">暂无错误</div>;
  }

  return (
    <div className="excel-error-table">
      <div className="excel-error-table-head">
        <span>行号</span>
        <span>样本编号</span>
        <span>失败原因</span>
      </div>
      {normalized.map((error, index) => (
        <div className="excel-error-table-row" key={`${error.row_number}-${error.sample_id}-${index}`}>
          <span>{error.row_number ?? "-"}</span>
          <span>{error.sample_id ?? "-"}</span>
          <strong>{error.reason}</strong>
        </div>
      ))}
    </div>
  );
}

export function ImportErrorsCard({
  title,
  errors,
  extra,
}: {
  title: ReactNode;
  errors: unknown[];
  extra?: ReactNode;
}) {
  return (
    <Card className="detail-sub-card excel-inline-errors" title={title} extra={extra}>
      <ImportErrorList errors={errors} />
    </Card>
  );
}

export function ImportErrorDownloadButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <AppButton tone="secondary" size="small" icon={<Download />} onClick={onClick}>
      导出 CSV
    </AppButton>
  );
}

export function DuplicateCodePreview({ codes }: { codes: string[] }) {
  return (
    <div className="duplicate-code-preview">
      {codes.slice(0, 8).map((code) => (
        <Tag key={code}>{code}</Tag>
      ))}
      {codes.length > 8 ? <span>等 {codes.length} 个</span> : null}
    </div>
  );
}

export function ImportBatchDescriptions({
  batch,
}: {
  batch: ImportBatchItem;
}) {
  return (
    <Descriptions title="批次信息" column={2} bordered size="small">
      <Descriptions.Item label="文件名" span={2}>{batch.file_name}</Descriptions.Item>
      <Descriptions.Item label="状态"><ImportStatusTag status={batch.status} /></Descriptions.Item>
      <Descriptions.Item label="导入类型">{importTypeLabel(batch.import_type)}</Descriptions.Item>
      <Descriptions.Item label="上传人">{valueText(batch.uploaded_by_name)}</Descriptions.Item>
      <Descriptions.Item label="总行数">{batch.total_rows}</Descriptions.Item>
      <Descriptions.Item label="成功">{batch.success_rows}</Descriptions.Item>
      <Descriptions.Item label="失败">{batch.failed_rows}</Descriptions.Item>
      <Descriptions.Item label="上传时间">{formatFullDateTime(batch.uploaded_at)}</Descriptions.Item>
      <Descriptions.Item label="文件路径" span={2}>{valueText(batch.file_path)}</Descriptions.Item>
    </Descriptions>
  );
}

export function FieldMappingGrid({
  fieldMapping,
}: {
  fieldMapping: [string, unknown][];
}) {
  return (
    <div className="excel-mapping-grid">
      {fieldMapping.map(([excelName, columnName]) => (
        <div key={excelName}>
          <span>{excelName}</span>
          <strong>{String(columnName)}</strong>
        </div>
      ))}
    </div>
  );
}
