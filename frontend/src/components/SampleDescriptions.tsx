import type { ReactNode } from "react";
import { Card, Descriptions } from "antd";

import type { SamplePrivateInfo } from "../api/samples";
import { statusTag } from "../constants/status";
import { formatFullDateTime, valueText } from "../utils/format";

type SampleBaseDescriptionsProps = {
  sample: Record<string, unknown>;
  extra?: ReactNode;
  title?: ReactNode;
  showVisitType?: boolean;
  showSampleStatus?: boolean;
};

export function SampleBaseDescriptions({
  sample,
  extra,
  title = "基础信息",
  showVisitType = true,
  showSampleStatus = true,
}: SampleBaseDescriptionsProps) {
  const relatedSamples = Array.isArray(sample.related_samples)
    ? sample.related_samples as Array<Record<string, unknown>>
    : [];
  const plateLocation = [
    [
      sample.plate_freezer_code,
      sample.plate_temperature_c !== null && sample.plate_temperature_c !== undefined
        ? `${sample.plate_temperature_c} °C`
        : null,
    ].filter(Boolean).join(" "),
    sample.plate_layer_no,
    sample.plate_container_no ? `${sample.plate_container_no}号板架` : null,
    sample.plate_code ? `${sample.plate_code}板` : null,
    sample.well_code ? `${sample.well_code}孔` : null,
    sample.plate_location_note,
  ].filter(Boolean).join(" / ");

  return (
    <Descriptions title={title} column={2} bordered size="small" extra={extra}>
      <Descriptions.Item label="样本编码" span={2}>{valueText(sample.sample_code)}</Descriptions.Item>
      <Descriptions.Item label="原始序号">{valueText(sample.sample_id)}</Descriptions.Item>
      <Descriptions.Item label="中心名称">{valueText(sample.center_name || sample.center_code)}</Descriptions.Item>
      <Descriptions.Item label="样本流水">{valueText(sample.sample_seq)}</Descriptions.Item>
      <Descriptions.Item label="条码号">{valueText(sample.barcode_no)}</Descriptions.Item>
      <Descriptions.Item label="实验号">{valueText(sample.experiment_no)}</Descriptions.Item>
      <Descriptions.Item label="病人号">{valueText(sample.patient_no)}</Descriptions.Item>
      <Descriptions.Item label="民族">{valueText(sample.ethnicity)}</Descriptions.Item>
      <Descriptions.Item label="性别">{valueText(sample.sex)}</Descriptions.Item>
      <Descriptions.Item label="年龄">{valueText(sample.age)}</Descriptions.Item>
      {showVisitType ? <Descriptions.Item label="类型">{valueText(sample.visit_type)}</Descriptions.Item> : null}
      <Descriptions.Item label="科室">{valueText(sample.department)}</Descriptions.Item>
      <Descriptions.Item label="样本类型">{valueText(sample.specimen_type)}</Descriptions.Item>
      <Descriptions.Item label="诊断" span={2}>{valueText(sample.diagnosis)}</Descriptions.Item>
      <Descriptions.Item label="申请项目" span={2}>{valueText(sample.request_items)}</Descriptions.Item>
      {showSampleStatus ? (
        <Descriptions.Item label="样本状态">{statusTag(String(sample.sample_status ?? ""))}</Descriptions.Item>
      ) : null}
      <Descriptions.Item label="测序数据">
        {statusTag(String(sample.sequencing_status ?? ""), "sequencing")}
      </Descriptions.Item>
      <Descriptions.Item label={sample.plate_code ? "DNA 板位" : "冰箱位置"} span={2}>
        {valueText(plateLocation || sample.storage_location)}
      </Descriptions.Item>
      {sample.plate_code && relatedSamples.length === 0 ? (
        <Descriptions.Item label="来源血样" span={2}>
          {valueText(sample.source_sample_code || sample.source_sample_id)}
        </Descriptions.Item>
      ) : null}
      {relatedSamples.length > 0 ? (
        <Descriptions.Item label="同源样本" span={2}>
          {relatedSamples.map((related) => (
            `${valueText(related.sample_code || related.sample_id)}（${valueText(related.specimen_type)}）`
          )).join("；")}
        </Descriptions.Item>
      ) : null}
      {sample.note ? (
        <Descriptions.Item label="备注" span={2}>
          {valueText(sample.note)}
        </Descriptions.Item>
      ) : null}
      <Descriptions.Item label="采集时间">{formatFullDateTime(sample.collection_time)}</Descriptions.Item>
      <Descriptions.Item label="审核时间">{formatFullDateTime(sample.review_time)}</Descriptions.Item>
    </Descriptions>
  );
}

export function SensitiveInfoDescriptions({
  privateInfo,
}: {
  privateInfo: SamplePrivateInfo;
}) {
  return (
    <Descriptions title="敏感信息" column={2} bordered size="small">
      <Descriptions.Item label="姓名">{valueText(privateInfo.name)}</Descriptions.Item>
      <Descriptions.Item label="身份证号">{valueText(privateInfo.id_card_no)}</Descriptions.Item>
      <Descriptions.Item label="电话">{valueText(privateInfo.phone)}</Descriptions.Item>
      <Descriptions.Item label="地址" span={2}>{valueText(privateInfo.address)}</Descriptions.Item>
      <Descriptions.Item label="查看时间" span={2}>
        {formatFullDateTime(privateInfo.accessed_at)}
      </Descriptions.Item>
    </Descriptions>
  );
}

const ORGANOID_FIELD_LABELS: Array<[string, string]> = [
  ["样本描述", "样本描述"],
  ["类器官编号", "类器官编号"],
  ["建模日期", "建模日期"],
  ["类器官类型", "类器官类型"],
  ["交付日期", "交付日期"],
  ["当前代次", "当前代次"],
  ["冻存日期", "冻存日期"],
  ["冻存代次", "冻存代次"],
  ["冻存管数", "冻存管数"],
  ["每管规格", "每管规格"],
  ["存储位置", "原表存储位置"],
  ["样本状态", "原表样本状态"],
];

export function OrganoidInfoDescriptions({
  sample,
  visibleData,
}: {
  sample: Record<string, unknown>;
  visibleData: Record<string, unknown>;
}) {
  if (sample.specimen_type !== "类器官") {
    return null;
  }
  const fields = ORGANOID_FIELD_LABELS.filter(([key]) => {
    const value = visibleData[key];
    return value !== null && value !== undefined && value !== "";
  });

  return (
    <Descriptions title="类器官信息" column={2} bordered size="small">
      <Descriptions.Item label="样本来源" span={2}>
        {valueText(sample.source_batch)}
      </Descriptions.Item>
      {fields.map(([key, label]) => (
        <Descriptions.Item
          key={key}
          label={label}
          span={key === "样本描述" || key === "类器官类型" || key === "存储位置" ? 2 : 1}
        >
          {valueText(visibleData[key])}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

export function LabResultOverview({
  labResults,
  maxItems = 30,
}: {
  labResults: Record<string, unknown>;
  maxItems?: number;
}) {
  const labEntries = Object.entries(labResults)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, maxItems);

  return (
    <Card className="detail-sub-card" title="检验指标概览">
      {labEntries.length > 0 ? (
        <div className="lab-result-grid">
          {labEntries.map(([key, value]) => (
            <div className="lab-result-item" key={key}>
              <span>{key}</span>
              <strong>{valueText(value)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-small">暂无检验指标</div>
      )}
    </Card>
  );
}
