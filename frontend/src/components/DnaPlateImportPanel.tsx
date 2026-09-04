import { useState } from "react";
import { Eye, Package, Upload as UploadIcon, X } from "lucide-react";
import { AutoComplete, Card, Input, Modal, Select, Space, Tag, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";

import type { FreezerItem } from "../api/freezers";
import {
  inspectExcelSheets,
  previewDnaPlateImport,
  uploadDnaPlateImport,
  type DnaPlatePreviewResult,
  type DnaPlatePreviewRow,
} from "../api/imports";
import { getApiErrorMessage } from "../utils/http";
import { AppAlert, AppButton, AppTable, EllipsisCell } from "../ui";

const STATUS_OPTIONS = [
  { value: "in_storage", label: "在库" },
  { value: "not_stored", label: "未入库" },
];

const LAYER_OPTIONS = ["I", "II", "III", "IV", "V", "VI"].map((value) => ({
  value,
  label: `${value}层`,
}));

const previewColumns: ColumnsType<DnaPlatePreviewRow> = [
  { title: "Excel 行", dataIndex: "row_number", width: 88 },
  {
    title: "样本编码",
    dataIndex: "sample_code",
    width: 230,
    render: (value: string) => (
      <EllipsisCell value={value} copyable strong copyLabel="样本编码" />
    ),
  },
  { title: "原始序号", dataIndex: "sample_id", width: 110 },
  {
    title: "板号",
    dataIndex: "plate_code",
    width: 180,
    render: (value: string) => (
      <EllipsisCell value={value} copyable copyLabel="DNA 板号" />
    ),
  },
  { title: "孔位", dataIndex: "well_code", width: 90 },
  {
    title: "处理",
    dataIndex: "action",
    width: 110,
    render: (action: DnaPlatePreviewRow["action"]) =>
      action === "new" ? (
        <Tag color="blue">新建</Tag>
      ) : action === "existing" ? (
        <Tag color="green">更新</Tag>
      ) : (
        <Tag color="red">错误</Tag>
      ),
  },
  { title: "校验结果", dataIndex: "message", width: 260 },
];

export function DnaPlateImportPanel({
  freezerOptions,
  freezerOptionsLoading,
  onImported,
}: {
  freezerOptions: FreezerItem[];
  freezerOptionsLoading: boolean;
  onImported: () => void;
}) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [sheetName, setSheetName] = useState("汇总数据");
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<DnaPlatePreviewResult | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<"in_storage" | "not_stored">(
    "in_storage",
  );
  const [freezerCode, setFreezerCode] = useState("");
  const [layerNo, setLayerNo] = useState<string | undefined>();
  const [containerNo, setContainerNo] = useState("");

  const selectedFile = fileList[0]?.originFileObj;

  const clearFile = () => {
    setFileList([]);
    setSheetName("汇总数据");
    setSheetOptions([]);
    setPreview(null);
  };

  const handleFileChange = async (nextFiles: UploadFile[]) => {
    const normalized = nextFiles.slice(-1);
    setFileList(normalized);
    setPreview(null);
    setSheetOptions([]);
    const file = normalized[0]?.originFileObj;
    if (!file) {
      clearFile();
      return;
    }

    setInspecting(true);
    try {
      const result = await inspectExcelSheets(file);
      setSheetOptions(result.sheet_names);
      setSheetName(result.suggested_sheet_name || result.sheet_names[0] || "汇总数据");
    } catch (error) {
      message.error(getApiErrorMessage(error, "工作表识别失败"));
    } finally {
      setInspecting(false);
    }
  };

  const generatePreview = async () => {
    if (!selectedFile) {
      message.info("请先选择 DNA 板位 Excel");
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewDnaPlateImport(selectedFile, sheetName);
      setPreview(result);
      if (result.can_import) {
        message.success(`预览完成，共 ${result.valid_rows} 条可导入`);
      } else {
        message.warning(`预览发现 ${result.error_rows} 条错误`);
      }
    } catch (error) {
      setPreview(null);
      message.error(getApiErrorMessage(error, "DNA 板位预览失败"));
    } finally {
      setPreviewing(false);
    }
  };

  const doImport = async () => {
    if (!selectedFile || !preview?.can_import) return;
    setImporting(true);
    try {
      const result = await uploadDnaPlateImport(selectedFile, sheetName, {
        default_status: defaultStatus,
        freezer_code: freezerCode || undefined,
        layer_no: layerNo,
        container_no: containerNo || undefined,
      });
      message.success(`DNA 板位导入完成，共 ${result.success_rows} 条`);
      clearFile();
      onImported();
    } catch (error) {
      message.error(getApiErrorMessage(error, "DNA 板位导入失败"));
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = () => {
    if (!preview?.can_import) {
      message.warning("请先生成并通过预览");
      return;
    }
    Modal.confirm({
      title: "确认导入 DNA 板位？",
      content: `将处理 ${preview.valid_rows} 条 DNA 样本，涉及 ${preview.plate_count} 块板。`,
      okText: "确认导入",
      cancelText: "取消",
      centered: true,
      onOk: doImport,
    });
  };

  return (
    <Card className="excel-upload-card dna-plate-import-card">
      <div className="excel-upload-grid">
        <Upload.Dragger
          accept=".xls,.xlsx,.xlsm,.csv"
          maxCount={1}
          fileList={fileList}
          showUploadList={false}
          beforeUpload={() => false}
          onChange={({ fileList: nextFiles }) => void handleFileChange(nextFiles)}
          onRemove={clearFile}
        >
          <p className="ant-upload-drag-icon">
            <Package />
          </p>
          <p className="ant-upload-text">选择或拖入 DNA 板位 Excel</p>
          <p className="ant-upload-hint">需要样本编码、板号和孔位列</p>
        </Upload.Dragger>

        <div className="excel-upload-options">
          {fileList[0] ? (
            <div className="excel-selected-file">
              <div>
                <span>已选择文件</span>
                <strong>{fileList[0].name}</strong>
              </div>
              <button type="button" disabled={importing} onClick={clearFile}>
                <X />
              </button>
            </div>
          ) : null}
          <div className="excel-selected-sheet">
            <span>导入工作表</span>
            <Select
              value={sheetName}
              options={sheetOptions.map((name) => ({ value: name, label: name }))}
              onChange={(value) => {
                setSheetName(value);
                setPreview(null);
              }}
              loading={inspecting}
              disabled={inspecting || importing || sheetOptions.length === 0}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>初始状态</span>
            <Select
              value={defaultStatus}
              options={STATUS_OPTIONS}
              onChange={setDefaultStatus}
              disabled={importing}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>冰箱</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={freezerCode || undefined}
              options={freezerOptions.map((item) => ({
                value: item.freezer_code,
                label: item.display_name,
              }))}
              loading={freezerOptionsLoading}
              placeholder="可选"
              onChange={(value) => setFreezerCode(value || "")}
              disabled={importing}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>层数</span>
            <AutoComplete
              allowClear
              value={layerNo}
              options={LAYER_OPTIONS}
              placeholder="可选"
              onChange={(value) => setLayerNo(value.toUpperCase())}
              disabled={importing}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>盒号</span>
            <Input
              value={containerNo}
              inputMode="numeric"
              placeholder="可选"
              onChange={(event) => setContainerNo(event.target.value.replace(/\D/g, ""))}
              disabled={importing}
            />
          </div>
          <Space wrap>
            <AppButton
              tone="secondary"
              icon={<Eye />}
              loading={previewing}
              disabled={inspecting || importing}
              onClick={() => void generatePreview()}
            >
              生成预览
            </AppButton>
            <AppButton
              tone="primary"
              icon={<UploadIcon />}
              loading={importing}
              disabled={!preview?.can_import || previewing}
              onClick={confirmImport}
            >
              确认导入
            </AppButton>
          </Space>
        </div>
      </div>

      {preview ? (
        <div className="dna-import-preview">
          <div className="dna-import-preview-stats">
            <span>总计 <strong>{preview.total_rows}</strong></span>
            <span>新建 <strong>{preview.new_rows}</strong></span>
            <span>更新 <strong>{preview.existing_rows}</strong></span>
            <span>板数 <strong>{preview.plate_count}</strong></span>
            <span className={preview.error_rows ? "error" : ""}>
              错误 <strong>{preview.error_rows}</strong>
            </span>
          </div>
          {preview.error_rows > 0 ? (
            <AppAlert
              type="error"
              message="预览未通过"
              description={preview.errors
                .slice(0, 5)
                .map((error) => `第 ${error.row_number} 行：${error.reason}`)
                .join("；")}
            />
          ) : (
            <AppAlert type="success" message="预览校验通过，可以确认导入" />
          )}
          <AppTable<DnaPlatePreviewRow>
            rowKey="row_number"
            columns={previewColumns}
            dataSource={preview.rows}
            scrollX={1000}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        </div>
      ) : null}
    </Card>
  );
}
