import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Search, Trash2 } from "lucide-react";
import { Card, Drawer, Input, Modal, Select, Space, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";

import {
  fetchImportBatchDetail,
  fetchImportBatches,
  confirmImportBatchStorage,
  downloadImportBatchErrors,
  inspectExcelSheets,
  removeCreatedSamplesFromBatch,
  uploadExcelImport,
  type ImportBatchDetail,
  type ImportBatchItem,
  type ImportMode,
  type ImportStatus,
  type ImportUploadResult,
} from "../api/imports";
import { fetchFreezers, type FreezerItem } from "../api/freezers";
import {
  DuplicateCodePreview,
  FieldMappingGrid,
  ImportBatchDescriptions,
  ImportErrorDownloadButton,
  ImportErrorsCard,
  ImportStatusTag,
  importTypeLabel,
} from "../components/ImportDisplay";
import {
  GenomeInfoImportPanel,
  SampleInfoImportPanel,
} from "../components/ExcelImportPanels";
import { DnaPlateImportPanel } from "../components/DnaPlateImportPanel";
import { saveBlob } from "../utils/download";
import { formatFullDateTime, valueText } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
  createTablePagination,
} from "../ui";

const IMPORT_STATUS_OPTIONS = [
  { value: "imported", label: "已导入" },
  { value: "partial", label: "部分成功" },
  { value: "failed", label: "失败" },
  { value: "previewed", label: "已预览" },
  { value: "cancelled", label: "已取消" },
];

function getDuplicateSampleCodes(error: unknown): string[] | null {
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
    error.response.data.detail.code === "duplicate_sample_code" &&
    "duplicate_codes" in error.response.data.detail &&
    Array.isArray(error.response.data.detail.duplicate_codes)
  ) {
    return error.response.data.detail.duplicate_codes.map(String);
  }
  return null;
}

export function ExcelImportPage() {
  const [activeImportType, setActiveImportType] = useState<
    "sample" | "dna_plate" | "genome"
  >("sample");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [sheetName, setSheetName] = useState("汇总数据");
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [hasSampleCodeColumn, setHasSampleCodeColumn] = useState(false);
  const [sampleCodeColumns, setSampleCodeColumns] = useState<string[]>([]);
  const [detectedCenterCode, setDetectedCenterCode] = useState<string | null>(null);
  const [detectedCenterName, setDetectedCenterName] = useState<string | null>(null);
  const [detectedSpecimenType, setDetectedSpecimenType] = useState<string | null>(null);
  const [detectedSpecimenTypeLabel, setDetectedSpecimenTypeLabel] = useState<string | null>(null);
  const [specimenTypeCounts, setSpecimenTypeCounts] = useState<Record<string, number>>({});
  const [inspectingSheets, setInspectingSheets] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState("not_stored");
  const [importMode, setImportMode] = useState<ImportMode>("atomic");
  const [freezerOptions, setFreezerOptions] = useState<FreezerItem[]>([]);
  const [freezerOptionsLoading, setFreezerOptionsLoading] = useState(false);
  const [freezerNo, setFreezerNo] = useState("");
  const [shelfNo, setShelfNo] = useState<string | undefined>();
  const [boxNo, setBoxNo] = useState("");
  const [storagePosition, setStoragePosition] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [lastResult, setLastResult] = useState<ImportUploadResult | null>(null);

  const [keyword, setKeyword] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ImportBatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);

  const selectedFileName = fileList[0]?.name ?? "";
  const isCsvFile = selectedFileName.toLowerCase().endsWith(".csv");
  const specimenTypeCountText = useMemo(() => {
    return Object.entries(specimenTypeCounts)
      .map(([type, count]) => `${type} ${count}`)
      .join("，");
  }, [specimenTypeCounts]);

  const loadBatches = () => {
    setLoading(true);
    fetchImportBatches({
      keyword: keyword.trim() || undefined,
      import_status: importStatus,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => message.error("导入批次加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBatches();
  }, [page, pageSize, importStatus]);

  useEffect(() => {
    setFreezerOptionsLoading(true);
    fetchFreezers()
      .then(setFreezerOptions)
      .catch(() => message.error("冰箱列表加载失败"))
      .finally(() => setFreezerOptionsLoading(false));
  }, []);

  const summary = useMemo(() => {
    return {
      success: items.reduce((count, item) => count + item.success_rows, 0),
      failed: items.reduce((count, item) => count + item.failed_rows, 0),
      files: items.length,
    };
  }, [items]);

  const doUpload = async (file: File, duplicateStrategy: "error" | "overwrite" = "error") => {
    const normalizedSheetName = sheetName.trim();
    setUploading(true);
    setUploadPercent(0);
    setUploadStage("正在上传文件");
    setLastResult(null);
    try {
      const result = await uploadExcelImport(
        file,
        normalizedSheetName || "汇总数据",
        defaultStatus,
        duplicateStrategy,
        importMode,
        {
          freezer_no: freezerNo.trim() || undefined,
          shelf_no: shelfNo,
          box_no: boxNo.trim() || undefined,
          storage_position: storagePosition.trim() || undefined,
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
      setPage(1);
      loadBatches();
    } catch (error) {
      const duplicateCodes = getDuplicateSampleCodes(error);
      if (duplicateStrategy === "error" && duplicateCodes?.length) {
        setUploadStage("");
        Modal.confirm({
          title: "发现重复样本编码",
          content: (
            <div>
              <p>
                当前文件中有 {duplicateCodes.length} 个样本编码已存在。继续导入将覆盖这些样本的基础信息、敏感信息、原始记录和本次填写的冰箱位置，但保留当前库存状态。
                如需将“未入库”样本转为“在库”，请在导入批次中使用“确认入库”。
              </p>
              <DuplicateCodePreview codes={duplicateCodes} />
            </div>
          ),
          okText: "覆盖已有样本",
          cancelText: "取消导入",
          okButtonProps: { danger: true },
          centered: true,
          onOk: () => doUpload(file, "overwrite"),
        });
        return;
      }
      setUploadStage("导入失败");
      message.error(getApiErrorMessage(error, "Excel 导入失败"));
    } finally {
      setUploading(false);
    }
  };

  const submitUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.info("请先选择 Excel 或 CSV 文件");
      return;
    }
    if (!hasSampleCodeColumn) {
      Modal.warning({
        title: "未识别到样本编码列",
        content:
          "当前文件未找到样本编码列。请先在“批量打码”页面生成编码并写入 Excel，再进行导入。",
        okText: "知道了",
        centered: true,
      });
      return;
    }
    await doUpload(file);
  };

  const clearUploadState = () => {
    setUploadPercent(0);
    setUploadStage("");
    setLastResult(null);
  };

  const clearSelectedFile = () => {
    setFileList([]);
    setSheetOptions([]);
    setSheetName("汇总数据");
    setHasSampleCodeColumn(false);
    setSampleCodeColumns([]);
    setDetectedCenterCode(null);
    setDetectedCenterName(null);
    setDetectedSpecimenType(null);
    setDetectedSpecimenTypeLabel(null);
    setSpecimenTypeCounts({});
    clearUploadState();
  };

  const handleFileChange = async (nextFileList: UploadFile[]) => {
    const normalizedList = nextFileList.slice(-1);
    setFileList(normalizedList);
    setLastResult(null);
    setUploadPercent(0);
    setUploadStage("");
    if (normalizedList.length === 0) {
      clearSelectedFile();
      return;
    }

    const file = normalizedList[0].originFileObj;
    if (!file) return;
    const nextIsCsv = normalizedList[0].name.toLowerCase().endsWith(".csv");

    setInspectingSheets(true);
    try {
      const result = await inspectExcelSheets(file);
      setSheetOptions(result.sheet_names);
      setHasSampleCodeColumn(result.has_sample_code_column);
      setSampleCodeColumns(result.sample_code_columns);
      setDetectedCenterCode(result.detected_center_code ?? null);
      setDetectedCenterName(result.detected_center_name ?? null);
      setDetectedSpecimenType(result.detected_specimen_type ?? null);
      setDetectedSpecimenTypeLabel(result.detected_specimen_type_label ?? null);
      setSpecimenTypeCounts(result.specimen_type_counts ?? {});
      if (result.suggested_sheet_name) {
        setSheetName(result.suggested_sheet_name);
        const codeTip = result.has_sample_code_column
          ? `，发现编码列：${result.sample_code_columns.join("、")}`
          : "，未发现编码列";
        message.success(nextIsCsv ? `已识别 CSV 文件${codeTip}` : `已识别工作表：${result.suggested_sheet_name}${codeTip}`);
      }
    } catch (error) {
      setSheetOptions([]);
      setHasSampleCodeColumn(false);
      setSampleCodeColumns([]);
      setDetectedCenterCode(null);
      setDetectedCenterName(null);
      setDetectedSpecimenType(null);
      setDetectedSpecimenTypeLabel(null);
      setSpecimenTypeCounts({});
      message.warning(getApiErrorMessage(error, "工作表自动识别失败，将按默认“汇总数据”尝试导入"));
    } finally {
      setInspectingSheets(false);
    }
  };

  const handleSheetNameChange = async (nextSheetName: string) => {
    if (nextSheetName === sheetName) return;
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    const previousSheetName = sheetName;
    setSheetName(nextSheetName);
    setInspectingSheets(true);
    try {
      const result = await inspectExcelSheets(file, nextSheetName);
      setSheetOptions(result.sheet_names);
      setSheetName(result.suggested_sheet_name || nextSheetName);
      setHasSampleCodeColumn(result.has_sample_code_column);
      setSampleCodeColumns(result.sample_code_columns);
      setDetectedCenterCode(result.detected_center_code ?? null);
      setDetectedCenterName(result.detected_center_name ?? null);
      setDetectedSpecimenType(result.detected_specimen_type ?? null);
      setDetectedSpecimenTypeLabel(result.detected_specimen_type_label ?? null);
      setSpecimenTypeCounts(result.specimen_type_counts ?? {});
      clearUploadState();
      message.success(`已切换到工作表：${result.suggested_sheet_name || nextSheetName}`);
    } catch (error) {
      setSheetName(previousSheetName);
      message.error(getApiErrorMessage(error, "工作表切换失败"));
    } finally {
      setInspectingSheets(false);
    }
  };

  const openDetail = (batchId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    fetchImportBatchDetail(batchId)
      .then(setDetail)
      .catch(() => message.error("导入批次详情加载失败"))
      .finally(() => setDetailLoading(false));
  };

  const downloadBatchErrors = async (batchId: number) => {
    try {
      const blob = await downloadImportBatchErrors(batchId);
      saveBlob(blob, `import_batch_${batchId}_errors.csv`);
    } catch {
      message.error("失败报告导出失败");
    }
  };

  const confirmRemoveCreatedSamples = (record: ImportBatchItem) => {
    let reason = "";
    Modal.confirm({
      title: `清理批次 #${record.id} 的新增样本？`,
      content: (
        <div>
          <p>
            将清理本批新建的 {record.created_count} 个样本；本批更新的 {record.updated_count} 个已有样本不受影响。
            如果这些样本已有出入库记录、再次导入记录或基因组信息，将无法清理。
            {record.import_type === "dna_plate"
              ? " 本批新建样本对应的板孔会一并清除，清空后的板记录也会删除。"
              : ""}
          </p>
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="请输入清理原因，例如：误导入了错误文件"
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        </div>
      ),
      okText: "确认清理新增样本",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        if (reason.trim().length < 2) {
          message.warning("请输入清理原因");
          return Promise.reject();
        }
        try {
          const result = await removeCreatedSamplesFromBatch(record.id, reason.trim());
          message.success(`已清理本批新增的 ${result.removed_count} 个样本`);
          loadBatches();
          if (detail?.batch.id === record.id) {
            setDetailOpen(false);
            setDetail(null);
          }
        } catch (error) {
          message.error(getApiErrorMessage(error, "清理新增样本失败"));
          return Promise.reject();
        }
      },
    });
  };

  const confirmBatchStorage = (record: ImportBatchItem) => {
    Modal.confirm({
      title: `确认批次 #${record.id} 的样本已入库？`,
      content: (
        <div>
          <p>
            将该批次中当前仍为“未入库”的 {record.pending_storage_count} 个样本统一改为“在库”，并记录完整流转日志。
          </p>
          <p>已出库、待归还复核、已用完等其他状态不会被修改。此操作不用于撤销入库。</p>
        </div>
      ),
      okText: "确认入库",
      cancelText: "取消",
      centered: true,
      onOk: async () => {
        try {
          const result = await confirmImportBatchStorage(record.id);
          message.success(`已确认 ${result.stored_count} 个样本入库`);
          loadBatches();
          if (detail?.batch.id === record.id) {
            fetchImportBatchDetail(record.id).then(setDetail).catch(() => undefined);
          }
        } catch (error) {
          message.error(getApiErrorMessage(error, "批量确认入库失败"));
          return Promise.reject();
        }
      },
    });
  };

  const columns: ColumnsType<ImportBatchItem> = [
    {
      title: "批次",
      dataIndex: "id",
      width: 88,
      fixed: "left",
      render: (value: number) => <strong>#{value}</strong>,
    },
    { title: "文件名", dataIndex: "file_name", width: 240, ellipsis: true },
    {
      title: "类型",
      dataIndex: "import_type",
      width: 120,
      render: (value: string) => importTypeLabel(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 96,
      render: (status: ImportStatus) => <ImportStatusTag status={status} />,
    },
    { title: "总行数", dataIndex: "total_rows", width: 90 },
    {
      title: "成功",
      dataIndex: "success_rows",
      width: 90,
      render: (value: number) => <Tag color="green">{value}</Tag>,
    },
    {
      title: "失败",
      dataIndex: "failed_rows",
      width: 90,
      render: (value: number) => <Tag color={value > 0 ? "red" : "default"}>{value}</Tag>,
    },
    {
      title: "本批变更",
      width: 170,
      render: (_, record) => (
        <Space size={4} wrap>
          <Tag color="blue">新建 {record.created_count}</Tag>
          <Tag>覆盖 {record.updated_count}</Tag>
          {record.removed_count > 0 ? <Tag>已清理 {record.removed_count}</Tag> : null}
        </Space>
      ),
    },
    { title: "上传人", dataIndex: "uploaded_by_name", width: 120, render: valueText },
    { title: "上传时间", dataIndex: "uploaded_at", width: 160, render: formatFullDateTime },
    {
      title: "操作",
      width: 300,
      fixed: "right",
      render: (_, record) => (
        <Space size={4}>
          <AppButton tone="quiet" size="small" onClick={() => openDetail(record.id)}>
            详情
          </AppButton>
          {(record.import_type === "sample" || record.import_type === "dna_plate") &&
          record.pending_storage_count > 0 ? (
            <AppButton
              tone="primary"
              size="small"
              icon={<PackageCheck />}
              onClick={() => confirmBatchStorage(record)}
            >
              确认入库
            </AppButton>
          ) : null}
          {(record.import_type === "sample" || record.import_type === "dna_plate") &&
          record.created_count > 0 &&
          record.removed_count < record.created_count ? (
            <AppButton
              tone="danger"
              size="small"
              icon={<Trash2 />}
              onClick={() => confirmRemoveCreatedSamples(record)}
            >
              清理新增
            </AppButton>
          ) : null}
        </Space>
      ),
    },
  ];

  const detailBatch = detail?.batch;
  const detailErrors = detail?.error_report ?? [];
  const fieldMapping = detail?.field_mapping ? Object.entries(detail.field_mapping) : [];

  return (
    <div className="excel-import-page">
      <div className="page-toolbar">
        <div>
          <h2>Excel 导入</h2>
          <span>共 {total} 个批次</span>
        </div>
      </div>

      <AppSummaryGrid
        items={[
          { key: "files", label: "本页批次", value: summary.files },
          { key: "success", label: "本页成功行", value: summary.success },
          { key: "failed", label: "本页失败行", value: summary.failed },
        ]}
      />

      <Card className="excel-import-tabs-card">
        <Tabs
          activeKey={activeImportType}
          onChange={(key) =>
            setActiveImportType(key as "sample" | "dna_plate" | "genome")
          }
          items={[
            { key: "sample", label: "样本信息导入" },
            { key: "dna_plate", label: "DNA 板位导入" },
            { key: "genome", label: "基因组信息导入" },
          ]}
        />
      </Card>

      {activeImportType === "sample" ? (
        <SampleInfoImportPanel
          fileList={fileList}
          isCsvFile={isCsvFile}
          inspectingSheets={inspectingSheets}
          sheetName={sheetName}
          sheetOptions={sheetOptions}
          hasSampleCodeColumn={hasSampleCodeColumn}
          sampleCodeColumns={sampleCodeColumns}
          detectedCenterCode={detectedCenterCode}
          detectedCenterName={detectedCenterName}
          detectedSpecimenType={detectedSpecimenType}
          detectedSpecimenTypeLabel={detectedSpecimenTypeLabel}
          specimenTypeCountText={specimenTypeCountText}
          defaultStatus={defaultStatus}
          importMode={importMode}
          freezerOptions={freezerOptions}
          freezerOptionsLoading={freezerOptionsLoading}
          freezerNo={freezerNo}
          shelfNo={shelfNo}
          boxNo={boxNo}
          storagePosition={storagePosition}
          uploading={uploading}
          uploadStage={uploadStage}
          uploadPercent={uploadPercent}
          lastResult={lastResult}
          onFileChange={(nextFileList) => void handleFileChange(nextFileList)}
          onClearSelectedFile={clearSelectedFile}
          onSheetNameChange={(value) => void handleSheetNameChange(value)}
          onDefaultStatusChange={setDefaultStatus}
          onImportModeChange={setImportMode}
          onFreezerNoChange={setFreezerNo}
          onShelfNoChange={setShelfNo}
          onBoxNoChange={setBoxNo}
          onStoragePositionChange={setStoragePosition}
          onSubmitUpload={() => void submitUpload()}
          onClearUploadState={clearUploadState}
          onDownloadBatchErrors={(batchId) => void downloadBatchErrors(batchId)}
        />
      ) : activeImportType === "dna_plate" ? (
        <DnaPlateImportPanel
          freezerOptions={freezerOptions}
          freezerOptionsLoading={freezerOptionsLoading}
          onImported={() => {
            setPage(1);
            loadBatches();
          }}
        />
      ) : (
        <GenomeInfoImportPanel
          onImported={() => {
            setPage(1);
            loadBatches();
          }}
          onDownloadBatchErrors={(batchId) => void downloadBatchErrors(batchId)}
        />
      )}

      <AppFilterCard>
        <div className="audit-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索文件名或上传人"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadBatches();
            }}
          />
          <Select
            allowClear
            placeholder="导入状态"
            options={IMPORT_STATUS_OPTIONS}
            value={importStatus}
            onChange={(value) => {
              setPage(1);
              setImportStatus(value);
            }}
          />
          <Space>
            <AppButton tone="primary" icon={<Search />} onClick={() => {
              setPage(1);
              loadBatches();
            }}>
              查询
            </AppButton>
            <AppButton tone="secondary" onClick={() => {
              setKeyword("");
              setImportStatus(undefined);
              setPage(1);
            }}>
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard className="samples-table-card" title="导入批次" total={total} totalLabel="个批次">
        <AppTable<ImportBatchItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1160}
          pagination={createTablePagination({
            page,
            pageSize,
            total,
            unit: "个批次",
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          })}
        />
      </AppTableCard>

      <Drawer
        title={detailBatch ? `导入批次 #${detailBatch.id}` : "导入批次详情"}
        width={760}
        open={detailOpen}
        loading={detailLoading}
        onClose={() => setDetailOpen(false)}
      >
        {detailBatch ? (
          <div className="sample-detail">
            <ImportBatchDescriptions batch={detailBatch} />

            <ImportErrorsCard
              title="错误报告"
              errors={detailErrors}
              extra={detailErrors.length > 0 ? (
                <ImportErrorDownloadButton onClick={() => void downloadBatchErrors(detailBatch.id)} />
              ) : null}
            />

            <Card className="detail-sub-card" title="字段映射">
              <FieldMappingGrid fieldMapping={fieldMapping} />
            </Card>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
