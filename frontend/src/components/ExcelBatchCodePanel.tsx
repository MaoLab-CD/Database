/*
 * @Author: 袁瑞 && 2502099390@qq.com
 * @Date: 2026-07-09 09:13:35
 * @LastEditors: 袁瑞 && 2502099390@qq.com
 * @LastEditTime: 2026-08-14 10:20:57
 * @FilePath: \sample_admin\frontend\src\components\ExcelBatchCodePanel.tsx
 * @Description: Excel 批量生成样本编号面板
 */
import { useState } from "react";
import { Download, Eye, FileSpreadsheet, Upload as UploadIcon, X } from "lucide-react";
import { Card, Form, Select, Space, Table, Tag, Upload, message } from "antd";
import type { UploadFile } from "antd/es/upload/interface";

import type { CenterItem, DistrictItem } from "../api/centers";
import {
  generateCodesForExcel,
  previewCodesForExcel,
  type ExcelCodePreview,
} from "../api/batchCodes";
import { inspectExcelSheets } from "../api/imports";
import type { SpecimenTypeItem } from "../api/specimenTypes";
import { AppButton, EllipsisCell } from "../ui";


type Props = {
  districts: DistrictItem[];
  centers: CenterItem[];
  districtsLoading: boolean;
  centersLoading: boolean;
  specimenTypes: SpecimenTypeItem[];
  onDistrictChange: (districtCode: string) => void;
};

type FormValues = {
  district_code: string;
  center_code: string;
  sheet_name: string;
  sample_type: string;
};

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExcelBatchCodePanel({
  districts,
  centers,
  districtsLoading,
  centersLoading,
  specimenTypes,
  onDistrictChange,
}: Props) {
  const [form] = Form.useForm<FormValues>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<ExcelCodePreview | null>(null);

  const clearPreview = () => setPreview(null);

  const handleFileChange = async (nextFiles: UploadFile[]) => {
    const next = nextFiles.slice(-1);
    setFileList(next);
    setSheetNames([]);
    clearPreview();
    form.setFieldValue("sheet_name", undefined);
    const file = next[0]?.originFileObj;
    if (!file) return;

    setInspecting(true);
    try {
      const result = await inspectExcelSheets(file);
      setSheetNames(result.sheet_names);
      form.setFieldValue(
        "sheet_name",
        result.suggested_sheet_name || result.sheet_names[0],
      );
    } catch {
      message.error("读取 Excel 工作表失败");
      setFileList([]);
    } finally {
      setInspecting(false);
    }
  };

  const handlePreview = async () => {
    const values = await form.validateFields().catch(() => null);
    const file = fileList[0]?.originFileObj;
    if (!values || !file) {
      if (!file) message.warning("请先选择Excel文件");
      return;
    }

    setPreviewing(true);
    try {
      const result = await previewCodesForExcel(file, values);
      setPreview(result);
      message.success(`预览已生成，共 ${result.total_count} 条编码`);
    } catch (error: any) {
      setPreview(null);
      message.error(error?.response?.data?.detail || "生成预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!preview) {
      message.warning("请先生成预览，确认编码后再下载 Excel");
      return;
    }
    const values = await form.validateFields().catch(() => null);
    const file = fileList[0]?.originFileObj;
    if (!values || !file) {
      if (!file) message.warning("请先选择 Excel 文件");
      return;
    }

    setGenerating(true);
    try {
      const result = await generateCodesForExcel(file, values);
      const suffix = file.name.toLowerCase().endsWith(".xlsm") ? ".xlsm" : ".xlsx";
      const stem = file.name.slice(0, -suffix.length);
      downloadBlob(result.blob, `${stem}_filled${suffix}`);
      message.success(
        `已写入 ${result.totalCount} 条编码：新增 ${result.newCount}，` +
        `数据库复用 ${result.reusedCount}，表内保留 ${result.preservedCount}`,
      );
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "生成编码失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className="samples-filter-card">
      <div className="batch-code-hint">
      上传包含“序”和“采集时间”的 Excel。表内已有合法编码会保留，数据库中同一条样本会复用原编码，
      只有新样本才接续当天最大序号；结果仅写入下载文件，不会自动保存。
      </div>

      <Upload.Dragger
        accept=".xls,.xlsx,.xlsm"
        maxCount={1}
        fileList={fileList}
        showUploadList={false}
        beforeUpload={() => false}
        onChange={({ fileList: next }) => void handleFileChange(next)}
        disabled={inspecting || previewing || generating}
      >
        <UploadIcon size={28} />
        <p className="ant-upload-text">选择或拖入样本 Excel</p>
        <p className="ant-upload-hint">支持 .xls / .xlsx / .xlsm，文件中需包含“序”和“采集时间”列</p>
      </Upload.Dragger>

      {fileList[0] ? (
        <div className="selected-upload-file">
          <FileSpreadsheet size={20} />
          <span>{fileList[0].name}</span>
          <Tag color="blue">{sheetNames.length} 个工作表</Tag>
          <button
            type="button"
            aria-label="清除文件"
            title="清除文件"
            onClick={() => {
              setFileList([]);
              setSheetNames([]);
              clearPreview();
              form.setFieldValue("sheet_name", undefined);
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <Form
        form={form}
        layout="vertical"
        initialValues={{ sample_type: "全血" }}
        onFinish={() => void handleGenerate()}
        style={{ marginTop: 20 }}
      >
        <div className="batch-code-form-row">
          <Form.Item name="district_code" label="区县" rules={[{ required: true }]}>
            <Select
              loading={districtsLoading}
              options={districts.map((item) => ({
                value: item.district_code,
                label: `${item.district_code} ${item.district_name}`,
              }))}
              onChange={(value) => {
                form.setFieldValue("center_code", undefined);
                clearPreview();
                onDistrictChange(value);
              }}
            />
          </Form.Item>
          <Form.Item name="center_code" label="医院" rules={[{ required: true }]}>
            <Select
              loading={centersLoading}
              disabled={!Form.useWatch("district_code", form)}
              options={centers.map((item) => ({
                value: item.center_code,
                label: item.center_name,
              }))}
              showSearch
              optionFilterProp="label"
              onChange={clearPreview}
            />
          </Form.Item>
          <Form.Item name="sheet_name" label="工作表" rules={[{ required: true }]}>
            <Select
              loading={inspecting}
              disabled={!fileList.length}
              options={sheetNames.map((name) => ({ value: name, label: name }))}
              onChange={clearPreview}
            />
          </Form.Item>
          <Form.Item name="sample_type" label="样本类型" rules={[{ required: true }]}>
            <Select
              options={specimenTypes.map((item) => ({
                value: item.name,
                label: item.code_suffix === ""
                  ? `${item.name}（无后缀）`
                  : `${item.name}（后缀 ${item.code_suffix}）`,
              }))}
              onChange={clearPreview}
            />
          </Form.Item>
        </div>
        <Space>
          <AppButton
            tone="secondary"
            icon={<Eye />}
            loading={previewing}
            disabled={!fileList.length || inspecting}
            onClick={() => void handlePreview()}
          >
            生成预览
          </AppButton>
          <AppButton
            tone="primary"
            icon={<Download />}
            htmlType="submit"
            loading={generating}
            disabled={inspecting}
          >
            生成并下载 Excel
          </AppButton>
        </Space>
      </Form>

      {preview ? (
        <div style={{ marginTop: 20 }}>
          <Space style={{ marginBottom: 12 }} wrap>
            <strong>编码预览</strong>
            <Tag color="blue">共 {preview.total_count} 条</Tag>
            <Tag color="green">新增 {preview.generated_count}</Tag>
            <Tag color="blue">数据库复用 {preview.reused_count}</Tag>
            <Tag>表内保留 {preview.provided_count}</Tag>
            {Object.entries(preview.date_counts).map(([date, count]) => (
              <Tag key={date}>{date}：{count} 条</Tag>
            ))}
          </Space>
          <Table
            rowKey="row_number"
            size="small"
            pagination={false}
            scroll={{ y: 320 }}
            dataSource={preview.rows}
            columns={[
              { title: "Excel 行号", dataIndex: "row_number", width: 110 },
              { title: "采集日期", dataIndex: "collection_date", width: 140 },
              {
                title: "处理方式",
                dataIndex: "assignment_source",
                width: 120,
                render: (value: ExcelCodePreview["rows"][number]["assignment_source"]) => {
                  if (value === "reused") return <Tag color="blue">数据库复用</Tag>;
                  if (value === "provided") return <Tag>表内保留</Tag>;
                  return <Tag color="green">新增编码</Tag>;
                },
              },
              {
                title: "样本编码",
                dataIndex: "sample_code",
                render: (value: string) => (
                  <EllipsisCell value={value} copyable strong copyLabel="样本编码" />
                ),
              },
            ]}
          />
          {preview.total_count > preview.rows.length ? (
            <div className="batch-code-suggestion" style={{ marginTop: 10 }}>
              当前展示前 {preview.rows.length} 条，下载文件将包含全部 {preview.total_count} 条。
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
