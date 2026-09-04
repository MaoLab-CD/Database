import { useState } from "react";
import { Upload as UploadIcon } from "lucide-react";
import { Package, Server, X } from "lucide-react";
import {
  AutoComplete,
  Card,
  DatePicker,
  Input,
  Modal,
  Progress,
  Select,
  Switch,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { Dayjs } from "dayjs";

import {
  inspectExcelSheets,
  uploadGenomeInfoImport,
  type ImportMode,
  type ImportUploadResult,
} from "../api/imports";
import type { FreezerItem } from "../api/freezers";
import { getApiErrorMessage } from "../utils/http";
import { AppAlert, AppButton } from "../ui";
import {
  DuplicateCodePreview,
  ImportErrorDownloadButton,
  ImportErrorsCard,
} from "./ImportDisplay";

const SAMPLE_INITIAL_STATUS_OPTIONS = [
  { value: "not_stored", label: "未入库" },
  { value: "in_storage", label: "在库" },
  { value: "sequencing", label: "测序中" },
];

const SHELF_OPTIONS = [
  { value: "I", label: "I层" },
  { value: "II", label: "II层" },
  { value: "III", label: "III层" },
  { value: "IV", label: "IV层" },
  { value: "V", label: "V层" },
  { value: "VI", label: "VI层" },
];

type SampleInfoImportPanelProps = {
  fileList: UploadFile[];
  isCsvFile: boolean;
  inspectingSheets: boolean;
  sheetName: string;
  sheetOptions: string[];
  hasSampleCodeColumn: boolean;
  sampleCodeColumns: string[];
  detectedCenterCode: string | null;
  detectedCenterName: string | null;
  detectedSpecimenType: string | null;
  detectedSpecimenTypeLabel: string | null;
  specimenTypeCountText: string;
  defaultStatus: string;
  importMode: ImportMode;
  freezerOptions: FreezerItem[];
  freezerOptionsLoading: boolean;
  freezerNo: string;
  shelfNo?: string;
  boxNo: string;
  storagePosition: string;
  uploading: boolean;
  uploadStage: string;
  uploadPercent: number;
  lastResult: ImportUploadResult | null;
  onFileChange: (nextFileList: UploadFile[]) => void;
  onClearSelectedFile: () => void;
  onSheetNameChange: (value: string) => void;
  onDefaultStatusChange: (value: string) => void;
  onImportModeChange: (value: ImportMode) => void;
  onFreezerNoChange: (value: string) => void;
  onShelfNoChange: (value: string | undefined) => void;
  onBoxNoChange: (value: string) => void;
  onStoragePositionChange: (value: string) => void;
  onSubmitUpload: () => void;
  onClearUploadState: () => void;
  onDownloadBatchErrors: (batchId: number) => void;
};

export function SampleInfoImportPanel({
  fileList,
  isCsvFile,
  inspectingSheets,
  sheetName,
  sheetOptions,
  hasSampleCodeColumn,
  sampleCodeColumns,
  detectedCenterCode,
  detectedCenterName,
  detectedSpecimenType,
  detectedSpecimenTypeLabel,
  specimenTypeCountText,
  defaultStatus,
  importMode,
  freezerOptions,
  freezerOptionsLoading,
  freezerNo,
  shelfNo,
  boxNo,
  storagePosition,
  uploading,
  uploadStage,
  uploadPercent,
  lastResult,
  onFileChange,
  onClearSelectedFile,
  onSheetNameChange,
  onDefaultStatusChange,
  onImportModeChange,
  onFreezerNoChange,
  onShelfNoChange,
  onBoxNoChange,
  onStoragePositionChange,
  onSubmitUpload,
  onClearUploadState,
  onDownloadBatchErrors,
}: SampleInfoImportPanelProps) {
  return (
    <Card className="excel-upload-card">
      <div className="excel-upload-grid">
        <Upload.Dragger
          accept=".xls,.xlsx,.xlsm,.csv"
          maxCount={1}
          fileList={fileList}
          showUploadList={false}
          beforeUpload={() => false}
          onChange={({ fileList: nextFileList }) => onFileChange(nextFileList)}
          onRemove={onClearSelectedFile}
        >
          <p className="ant-upload-drag-icon">
            <Package />
          </p>
          <p className="ant-upload-text">选择或拖拽 Excel / CSV 文件到这里</p>
          <p className="ant-upload-hint">支持 .xls / .xlsx / .xlsm / .csv；多工作表 Excel 可在右侧选择实际导入表。</p>
        </Upload.Dragger>

        <div className="excel-upload-options">
          {fileList[0] ? (
            <div className="excel-selected-file">
              <div>
                <span>已选择文件</span>
                <strong>{fileList[0].name}</strong>
              </div>
              <button type="button" disabled={uploading} onClick={onClearSelectedFile}>
                <X />
              </button>
            </div>
          ) : null}
          <div className="excel-selected-sheet">
            <span>{isCsvFile ? "文件类型" : "导入工作表"}</span>
            <strong>{isCsvFile ? "CSV 文件" : inspectingSheets ? "正在识别..." : sheetName || "汇总数据"}</strong>
          </div>
          <div className="excel-selected-sheet">
            <span>编码列</span>
            <strong>
              {fileList[0]
                ? hasSampleCodeColumn
                  ? sampleCodeColumns.join("、")
                  : "未识别，无法导入"
                : "选择文件后识别"}
            </strong>
          </div>
          <div className="excel-selected-sheet">
            <span>样本中心</span>
            <strong>{fileList[0] ? detectedCenterName || detectedCenterCode || "未识别" : "选择文件后识别"}</strong>
            {fileList[0] && detectedCenterName && detectedCenterCode ? <small>{detectedCenterCode}</small> : null}
          </div>
          <div className="excel-selected-sheet">
            <span>样本类型</span>
            <strong>{fileList[0] ? detectedSpecimenTypeLabel || "未识别" : "选择文件后识别"}</strong>
            {fileList[0] && detectedSpecimenType && specimenTypeCountText ? <small>{specimenTypeCountText}</small> : null}
          </div>
          <div className="excel-selected-sheet">
            <span>新样本初始状态</span>
            <Select
              value={defaultStatus}
              options={SAMPLE_INITIAL_STATUS_OPTIONS}
              onChange={onDefaultStatusChange}
              disabled={uploading}
            />
            <small>只用于新建样本；覆盖已有样本时保留当前库存状态</small>
          </div>
          <div className="excel-selected-sheet">
            <span>导入方式</span>
            <Select
              value={importMode}
              options={[
                { value: "atomic", label: "全部成功才导入（推荐）" },
                { value: "best_effort", label: "跳过错误行" },
              ]}
              onChange={onImportModeChange}
              disabled={uploading}
            />
            <small>{importMode === "atomic" ? "有一行错误则全部不导入" : "只导入检查通过的行"}</small>
          </div>
          <div className="excel-selected-sheet">
            <span>冰箱</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={freezerNo}
              options={freezerOptions.map((item) => ({
                value: item.freezer_code,
                label: item.display_name,
              }))}
              loading={freezerOptionsLoading}
              placeholder="可选，请选择冰箱"
              onChange={(value) => onFreezerNoChange(value || "")}
              disabled={uploading}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>冰箱层数（罗马数字）</span>
            <AutoComplete
              allowClear
              value={shelfNo}
              options={SHELF_OPTIONS}
              placeholder="可选，如 VI"
              onChange={(value) => onShelfNoChange(value.toUpperCase())}
              disabled={uploading}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>盒号（数字）</span>
            <Input
              value={boxNo}
              inputMode="numeric"
              placeholder="可选，如 1"
              onChange={(event) => onBoxNoChange(event.target.value.replace(/\D/g, ""))}
              disabled={uploading}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>位置备注</span>
            <Input
              value={storagePosition}
              placeholder="可选"
              onChange={(event) => onStoragePositionChange(event.target.value)}
              disabled={uploading}
            />
          </div>
          {!isCsvFile && sheetOptions.length > 0 ? (
            <div className="excel-sheet-options">
              <span>选择导入工作表</span>
              <div>
                {sheetOptions.map((name) => (
                  <button
                    type="button"
                    className={name === sheetName ? "active" : ""}
                    key={name}
                    disabled={uploading || inspectingSheets}
                    onClick={() => onSheetNameChange(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <AppButton
            tone="primary"
            icon={<UploadIcon />}
            loading={uploading}
            disabled={inspectingSheets}
            onClick={onSubmitUpload}
          >
            {uploading ? "导入中" : "上传并导入"}
          </AppButton>
          {uploadStage ? (
            <div className="excel-upload-progress">
              <Progress
                percent={uploadPercent}
                size="small"
                status={uploadStage === "导入失败" ? "exception" : uploadPercent === 100 ? "success" : "active"}
              />
              <div>
                <span>{uploadStage}</span>
                {!uploading ? (
                  <button type="button" onClick={onClearUploadState}>
                    清除状态
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {lastResult ? (
        <AppAlert
          className="excel-import-result"
          type={lastResult.failed_rows > 0 ? "warning" : "success"}
          message={`最近导入：成功 ${lastResult.success_rows} 行，失败 ${lastResult.failed_rows} 行`}
          description={
            lastResult.errors.length > 0
              ? "下方已汇总失败行，请按行号和原因检查原始文件。"
              : `批次 #${lastResult.import_batch_id} 导入完成`
          }
        />
      ) : null}
      {lastResult?.scan_message ? (
        <AppAlert
          className="excel-import-result"
          type={lastResult.scan_triggered ? "success" : "warning"}
          icon={<Server />}
          message={lastResult.scan_message}
        />
      ) : null}
      {lastResult?.errors.length ? (
        <ImportErrorsCard
          title="本次导入失败样本"
          errors={lastResult.errors}
          extra={
            <ImportErrorDownloadButton
              onClick={() => onDownloadBatchErrors(lastResult.import_batch_id)}
            />
          }
        />
      ) : null}
    </Card>
  );
}

type GenomeDuplicatePrompt = {
  file: File;
  codes: string[];
};

function getDuplicateGenomeCodes(error: unknown): string[] | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 409 &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "detail" in error.response.data &&
    typeof error.response.data.detail === "object" &&
    error.response.data.detail !== null &&
    "code" in error.response.data.detail &&
    error.response.data.detail.code === "duplicate_genome_status" &&
    "duplicate_codes" in error.response.data.detail &&
    Array.isArray(error.response.data.detail.duplicate_codes)
  ) {
    return error.response.data.detail.duplicate_codes.map(String);
  }
  return null;
}

export function GenomeInfoImportPanel({
  onImported,
  onDownloadBatchErrors,
}: {
  onImported: () => void;
  onDownloadBatchErrors: (batchId: number) => void;
}) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [syncReturn, setSyncReturn] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("atomic");
  const [sequencingCompany, setSequencingCompany] = useState("");
  const [sequencingInstrument, setSequencingInstrument] = useState("");
  const [returnedAt, setReturnedAt] = useState<Dayjs | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [lastResult, setLastResult] = useState<ImportUploadResult | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<GenomeDuplicatePrompt | null>(null);
  const [sheetName, setSheetName] = useState("汇总数据");
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [inspectingSheets, setInspectingSheets] = useState(false);
  const [hasSampleCodeColumn, setHasSampleCodeColumn] = useState(false);
  const selectedFileName = fileList[0]?.name ?? "";
  const isCsvFile = selectedFileName.toLowerCase().endsWith(".csv");

  const clearUploadState = () => {
    setUploadPercent(0);
    setUploadStage("");
    setLastResult(null);
  };

  const clearSelectedFile = () => {
    setFileList([]);
    setSheetName("汇总数据");
    setSheetOptions([]);
    setHasSampleCodeColumn(false);
    clearUploadState();
  };

  const handleFileChange = async (nextFileList: UploadFile[]) => {
    const normalizedList = nextFileList.slice(-1);
    setFileList(normalizedList);
    clearUploadState();
    setSheetOptions([]);
    setHasSampleCodeColumn(false);
    if (normalizedList.length === 0) {
      setSheetName("汇总数据");
      return;
    }

    const file = normalizedList[0].originFileObj;
    if (!file) {
      return;
    }
    const nextIsCsv = normalizedList[0].name.toLowerCase().endsWith(".csv");

    setInspectingSheets(true);
    try {
      const result = await inspectExcelSheets(file);
      setSheetOptions(result.sheet_names);
      setHasSampleCodeColumn(result.has_sample_code_column);
      setSheetName(result.suggested_sheet_name || (nextIsCsv ? "CSV" : "汇总数据"));
      message.success(nextIsCsv ? "已识别 CSV 文件" : "已识别工作表");
    } catch (error) {
      setSheetName("汇总数据");
      setSheetOptions([]);
      setHasSampleCodeColumn(false);
      message.warning(getApiErrorMessage(error, "工作表识别失败"));
    } finally {
      setInspectingSheets(false);
    }
  };

  const doUpload = async (
    file: File,
    duplicateStrategy: "error" | "overwrite" = "error",
  ) => {
    setUploading(true);
    setUploadPercent(0);
    setUploadStage("正在上传文件");
    setLastResult(null);
    try {
      const result = await uploadGenomeInfoImport(
        file,
        isCsvFile ? "CSV" : sheetName,
        {
          sequencing_company: sequencingCompany.trim() || undefined,
          sequencing_instrument: sequencingInstrument.trim() || undefined,
          sequencing_returned_at: returnedAt?.toISOString(),
          sync_return: syncReturn,
          duplicate_strategy: duplicateStrategy,
          import_mode: importMode,
        },
        (event) => {
          if (!event.total) return;
          const percent = Math.round((event.loaded / event.total) * 85);
          setUploadPercent(Math.min(percent, 85));
          if (percent >= 85) {
            setUploadStage("上传完成，正在导入数据");
          }
        },
      );
      setUploadPercent(100);
      setUploadStage("导入完成");
      setLastResult(result);
      message.success(`导入完成：成功 ${result.success_rows} 行，失败 ${result.failed_rows} 行`);
      setFileList([]);
      setDuplicatePrompt(null);
      onImported();
    } catch (error) {
      const duplicateCodes = getDuplicateGenomeCodes(error);
      if (duplicateStrategy === "error" && duplicateCodes?.length) {
        setUploadStage("");
        setDuplicatePrompt({ file, codes: duplicateCodes });
        return;
      }
      setUploadStage("导入失败");
      message.error(getApiErrorMessage(error, "基因组信息导入失败"));
    } finally {
      setUploading(false);
    }
  };

  const submitUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.info("请先选择基因组 / 测序信息 Excel");
      return;
    }

    if (!hasSampleCodeColumn) {
      Modal.warning({
        title: "未识别到样本编码列",
        content: "当前文件或工作表未找到样本编码列。",
        okText: "知道了",
        centered: true,
      });
      return;
    }

    if (!syncReturn) {
      await doUpload(file, "error");
      return;
    }

    Modal.confirm({
      title: "确认本批实体样本已经返还？",
      content:
        "开启“同时回库”后，本次成功匹配且当前为“测序中”的样本会改为“在库”。仅收到测序数据或 QC 表、但实体样本尚未返还时，请取消并关闭该选项。",
      okText: "确认实体已返还并导入",
      cancelText: "取消",
      centered: true,
      onOk: () => doUpload(file, "error"),
    });
  };

  return (
    <Card className="excel-upload-card genome-import-card">
      <div className="excel-upload-grid">
        <Upload.Dragger
          accept=".xls,.xlsx,.xlsm,.csv"
          maxCount={1}
          fileList={fileList}
          showUploadList={false}
          beforeUpload={() => false}
          onChange={({ fileList: nextFileList }) => {
            void handleFileChange(nextFileList);
          }}
          onRemove={clearSelectedFile}
        >
          <p className="ant-upload-drag-icon">
            <Package />
          </p>
          <p className="ant-upload-text">选择或拖拽基因组 / 测序信息 Excel</p>
          <p className="ant-upload-hint">支持 .xls / .xlsx / .xlsm / .csv，文件需包含“样本编码”列。</p>
        </Upload.Dragger>

        <div className="excel-upload-options">
          {fileList[0] ? (
            <div className="excel-selected-file">
              <div>
                <span>已选择文件</span>
                <strong>{fileList[0].name}</strong>
              </div>
              <button type="button" disabled={uploading} onClick={clearSelectedFile}>
                <X />
              </button>
            </div>
          ) : null}
          <div className="excel-selected-sheet">
            <span>{isCsvFile ? "文件类型" : "导入工作表"}</span>
            {isCsvFile ? (
              <strong>CSV 文件</strong>
            ) : (
              <Select
                value={sheetName}
                options={sheetOptions.map((name) => ({ value: name, label: name }))}
                onChange={setSheetName}
                loading={inspectingSheets}
                disabled={uploading || inspectingSheets || sheetOptions.length === 0}
              />
            )}
          </div>
          <div className="excel-selected-sheet">
            <span>编码列</span>
            <strong>{fileList[0] ? (hasSampleCodeColumn ? "已识别" : "未识别，无法导入") : "选择文件后识别"}</strong>
          </div>
          <div className="excel-selected-sheet">
            <span>导入对象</span>
            <strong>基因组测序信息</strong>
          </div>
          <div className="excel-selected-sheet">
            <span>导入方式</span>
            <Select
              value={importMode}
              options={[
                { value: "atomic", label: "全部成功才更新（推荐）" },
                { value: "best_effort", label: "跳过错误行" },
              ]}
              onChange={setImportMode}
              disabled={uploading}
            />
            <small>{importMode === "atomic" ? "有一行错误则全部不更新" : "只更新检查通过的行"}</small>
          </div>
          <div className="excel-selected-sheet">
            <span>测序公司</span>
            <Input
              value={sequencingCompany}
              placeholder="可选，Excel 为空时作为默认值"
              onChange={(event) => setSequencingCompany(event.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>测序仪器</span>
            <Input
              value={sequencingInstrument}
              placeholder="可选，如 DNBSEQ-T7"
              onChange={(event) => setSequencingInstrument(event.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="excel-selected-sheet">
            <span>回库时间</span>
            <DatePicker
              showTime
              value={returnedAt}
              placeholder="选择回库时间"
              onChange={(value) => setReturnedAt(value)}
              disabled={uploading}
            />
          </div>
          <div className="genome-return-option">
            <div>
              <span>同时回库</span>
              <Switch checked={syncReturn} onChange={setSyncReturn} disabled={uploading} />
              <small>仅更新当前为“测序中”的样本</small>
            </div>
          </div>
          <AppButton
            tone="primary"
            icon={<UploadIcon />}
            loading={uploading}
            disabled={!fileList[0]}
            onClick={() => void submitUpload()}
          >
            {uploading ? "导入中" : "上传并导入"}
          </AppButton>
          {uploadStage ? (
            <div className="excel-upload-progress">
              <Progress
                percent={uploadPercent}
                size="small"
                status={uploadStage === "导入失败" ? "exception" : uploadPercent === 100 ? "success" : "active"}
              />
              <div>
                <span>{uploadStage}</span>
                {!uploading ? (
                  <button type="button" onClick={clearUploadState}>
                    清除状态
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {lastResult ? (
        <AppAlert
          className="excel-import-result"
          type={lastResult.failed_rows > 0 ? "warning" : "success"}
          message={`最近导入：成功 ${lastResult.success_rows} 行，失败 ${lastResult.failed_rows} 行`}
          description={lastResult.return_message || `批次 #${lastResult.import_batch_id} 导入完成`}
        />
      ) : null}
      {lastResult?.errors.length ? (
        <ImportErrorsCard
          title="本次导入失败样本"
          errors={lastResult.errors}
          extra={
            <ImportErrorDownloadButton
              onClick={() => onDownloadBatchErrors(lastResult.import_batch_id)}
            />
          }
        />
      ) : null}
      <Modal
        title="发现已有基因组信息"
        open={Boolean(duplicatePrompt)}
        onCancel={() => setDuplicatePrompt(null)}
        footer={[
          <AppButton key="cancel" tone="secondary" onClick={() => setDuplicatePrompt(null)}>
            取消导入
          </AppButton>,
          <AppButton
            key="overwrite"
            tone="danger"
            loading={uploading}
            onClick={() => {
              if (duplicatePrompt) void doUpload(duplicatePrompt.file, "overwrite");
            }}
          >
            覆盖已有记录
          </AppButton>,
        ]}
        centered
      >
        <p>
          当前文件中有 {duplicatePrompt?.codes.length ?? 0} 个样本已有基因组测序信息。
          继续导入将覆盖这些样本的测序公司、仪器、QC、最终状态等字段。
        </p>
        <DuplicateCodePreview codes={duplicatePrompt?.codes ?? []} />
      </Modal>
    </Card>
  );
}
