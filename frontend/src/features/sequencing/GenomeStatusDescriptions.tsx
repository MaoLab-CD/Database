import { Descriptions } from "antd";

import { formatFullDateTime, valueText } from "../../utils/format";

export const GENOME_STATUS_KEYS = [
  "genome_data_status",
  "data_type",
  "sequencing_company",
  "sequencing_platform",
  "sequencing_instrument",
  "sequencing_returned_at",
  "sequencing_depth",
  "genome_qc",
  "final_status",
  "missing_reason",
] as const;

export type GenomeStatusRecord = Partial<Record<(typeof GENOME_STATUS_KEYS)[number], unknown>>;

export function hasGenomeStatus(status: Record<string, unknown>) {
  return GENOME_STATUS_KEYS.some((key) => Boolean(status[key]));
}

export function GenomeStatusDescriptions({
  status,
}: {
  status: GenomeStatusRecord;
}) {
  return (
    <Descriptions column={2} bordered size="small">
      <Descriptions.Item label="测序公司">{valueText(status.sequencing_company)}</Descriptions.Item>
      <Descriptions.Item label="测序平台">{valueText(status.sequencing_platform)}</Descriptions.Item>
      <Descriptions.Item label="测序仪器">{valueText(status.sequencing_instrument)}</Descriptions.Item>
      <Descriptions.Item label="回库时间">{formatFullDateTime(status.sequencing_returned_at)}</Descriptions.Item>
      <Descriptions.Item label="测序深度">{valueText(status.sequencing_depth)}</Descriptions.Item>
      <Descriptions.Item label="基因组QC">{valueText(status.genome_qc)}</Descriptions.Item>
      <Descriptions.Item label="最终状态">{valueText(status.final_status)}</Descriptions.Item>
      <Descriptions.Item label="数据类型">{valueText(status.data_type)}</Descriptions.Item>
      <Descriptions.Item label="数据状态">{valueText(status.genome_data_status)}</Descriptions.Item>
      <Descriptions.Item label="不可用原因" span={2}>{valueText(status.missing_reason)}</Descriptions.Item>
    </Descriptions>
  );
}
