import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Send, Trash2, UploadCloud } from "lucide-react";
import {
  Alert,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Space,
  Tabs,
  Tag,
  Upload,
  message,
  type UploadFile,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import type { LoginResult } from "../api/auth";
import {
  cancelHospitalUpload,
  downloadHospitalTemplate,
  downloadHospitalUploadErrors,
  fetchHospitalUploadDetail,
  fetchHospitalSubmissionPreview,
  fetchMyHospitalUploads,
  submitHospitalUpload,
  uploadHospitalFile,
  type HospitalUploadDetail,
  type HospitalUploadItem,
  type HospitalUploadStatus,
  type HospitalReviewPreviewRow,
  type HospitalSubmissionPreview,
} from "../api/hospitalUploads";
import { saveBlob } from "../utils/download";
import { formatFullDateTime } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";
import { AppButton, AppTable, AppTableCard, createTablePagination } from "../ui";

const STATUS_META: Record<HospitalUploadStatus, { label: string; color?: string }> = {
  validation_failed: { label: "校验未通过", color: "red" },
  validated: { label: "校验通过", color: "green" },
  submitted: { label: "待审核", color: "gold" },
  approved: { label: "审核通过", color: "cyan" },
  rejected: { label: "已驳回", color: "orange" },
  imported: { label: "已导入", color: "blue" },
  import_failed: { label: "入库失败", color: "red" },
  cancelled: { label: "已撤销" },
};

function statusTag(status: HospitalUploadStatus) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

type HospitalUploadPageProps = {
  currentUser: LoginResult;
};

export function HospitalUploadPage({ currentUser }: HospitalUploadPageProps) {
  const [items, setItems] = useState<HospitalUploadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [sheetName, setSheetName] = useState("样本数据");
  const [detail, setDetail] = useState<HospitalUploadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewing, setPreviewing] = useState<HospitalUploadItem | null>(null);
  const [submissionPreview, setSubmissionPreview] = useState<HospitalSubmissionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const centerCode = currentUser.center_codes[0] ?? "未绑定";
  const centerName =
    currentUser.center_names?.[centerCode]
    ?? items.find((item) => item.center_code === centerCode)?.center_name
    ?? null;

  const renderCenter = (code: string, name?: string | null) => (
    <div className="hospital-center-display">
      <strong>{name || code}</strong>
      {name ? <span>{code}</span> : null}
    </div>
  );

  const loadItems = () => {
    setLoading(true);
    fetchMyHospitalUploads({ page, page_size: pageSize })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((error) => message.error(getApiErrorMessage(error, "上传记录加载失败")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadItems();
  }, [page, pageSize]);

  const openDetail = async (batchId: number) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchHospitalUploadDetail(batchId));
    } catch (error) {
      message.error(getApiErrorMessage(error, "批次详情加载失败"));
    } finally {
      setDetailLoading(false);
    }
  };

  const openSubmissionPreview = async (record: HospitalUploadItem) => {
    setPreviewing(record);
    setSubmissionPreview(null);
    setPreviewLoading(true);
    try {
      setSubmissionPreview(await fetchHospitalSubmissionPreview(record.id));
    } catch (error) {
      setPreviewing(null);
      message.error(getApiErrorMessage(error, "上传数据预览失败"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTemplateDownload = async () => {
    try {
      saveBlob(await downloadHospitalTemplate(), "医院样本数据上传模板_V1.xlsx");
    } catch (error) {
      message.error(getApiErrorMessage(error, "模板下载失败"));
    }
  };

  const handleUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning("请先选择 .xls、.xlsx、.xlsm 或 .csv 文件");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadHospitalFile(file, sheetName.trim() || "样本数据");
      setFileList([]);
      setDetail(result);
      if (result.batch.status === "validated") {
        message.success("文件校验通过，请确认内容后提交审核");
        await openSubmissionPreview(result.batch);
      } else {
        message.warning(`发现 ${result.batch.error_rows} 行错误，请下载错误报告后修正重传`);
      }
      setPage(1);
      loadItems();
    } catch (error) {
      message.error(getApiErrorMessage(error, "文件上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!previewing || !submissionPreview) return;
    setSubmitting(true);
    try {
      await submitHospitalUpload(previewing.id);
      message.success("已提交审核");
      setPreviewing(null);
      setSubmissionPreview(null);
      setDetail(null);
      loadItems();
    } catch (error) {
      message.error(getApiErrorMessage(error, "提交审核失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = (record: HospitalUploadItem) => {
    Modal.confirm({
      title: "确认撤销该批次？",
      content: "撤销后，该文件将不再进入审核流程。",
      okText: "确认撤销",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await cancelHospitalUpload(record.id);
          message.success("批次已撤销");
          loadItems();
        } catch (error) {
          message.error(getApiErrorMessage(error, "撤销失败"));
        }
      },
    });
  };

  const handleErrorsDownload = async (batchId: number) => {
    try {
      saveBlob(await downloadHospitalUploadErrors(batchId), `医院上传批次_${batchId}_错误报告.csv`);
    } catch (error) {
      message.error(getApiErrorMessage(error, "错误报告下载失败"));
    }
  };

  const columns = useMemo<ColumnsType<HospitalUploadItem>>(
    () => [
      { title: "批次", dataIndex: "id", width: 82, render: (value) => `#${value}` },
      { title: "文件名", dataIndex: "file_name", width: 240, ellipsis: true },
      {
        title: "医院 / 中心",
        width: 240,
        render: (_, record) => renderCenter(record.center_code, record.center_name),
      },
      {
        title: "校验结果",
        width: 190,
        render: (_, record) => (
          <Space size={4} wrap>
            <Tag color="green">有效 {record.valid_rows}</Tag>
            {record.error_rows ? <Tag color="red">错误 {record.error_rows}</Tag> : null}
          </Space>
        ),
      },
      { title: "状态", dataIndex: "status", width: 125, render: statusTag },
      { title: "上传时间", dataIndex: "created_at", width: 170, render: formatFullDateTime },
      {
        title: "审核意见",
        dataIndex: "review_comment",
        width: 220,
        ellipsis: true,
        render: (value: string | null) => value || "-",
      },
      {
        title: "操作",
        width: 270,
        fixed: "right",
        render: (_, record) => (
          <Space wrap>
            <AppButton tone="quiet" size="small" icon={<Eye />} onClick={() => openDetail(record.id)}>
              详情
            </AppButton>
            {record.error_rows > 0 ? (
              <AppButton tone="quiet" size="small" icon={<Download />} onClick={() => handleErrorsDownload(record.id)}>
                错误报告
              </AppButton>
            ) : null}
            {record.status === "validated" ? (
              <AppButton tone="primary" size="small" icon={<Send />} onClick={() => openSubmissionPreview(record)}>
                预览并提交
              </AppButton>
            ) : null}
            {["validated", "validation_failed"].includes(record.status) ? (
              <AppButton tone="danger" size="small" icon={<Trash2 />} onClick={() => handleCancel(record)}>
                撤销
              </AppButton>
            ) : null}
            {record.status === "rejected" ? (
              <span style={{ color: "#64748b", fontSize: 13 }}>请修改文件后重新上传</span>
            ) : null}
          </Space>
        ),
      },
    ],
    [],
  );

  const previewColumns = useMemo<ColumnsType<HospitalReviewPreviewRow>>(() => {
    const sensitiveColumns = new Set(submissionPreview?.sensitive_columns ?? []);
    return [
      {
        title: "Excel 行",
        dataIndex: "row_number",
        key: "row_number",
        width: 86,
        fixed: "left",
      },
      ...(submissionPreview?.headers ?? []).map((header, index) => ({
        title: sensitiveColumns.has(index) ? (
          <Space size={4}>
            <span>{header}</span>
            <Tag color="red">敏感</Tag>
          </Space>
        ) : header,
        key: `submission-preview-${index}-${header}`,
        width: Math.min(Math.max(header.length * 18 + 60, 120), 220),
        ellipsis: true,
        render: (_: unknown, record: HospitalReviewPreviewRow) => {
          const value = record.values[index];
          return value === null || value === undefined || value === "" ? "-" : String(value);
        },
      })),
    ];
  }, [submissionPreview]);

  return (
    <div className="hospital-upload-page">
      <div className="page-toolbar">
        <div>
          <h2>医院数据上传</h2>
          <div className="hospital-authorized-center">
            <span>所属医院</span>
            {renderCenter(centerCode, centerName)}
          </div>
        </div>
        <AppButton tone="secondary" icon={<Download />} onClick={handleTemplateDownload}>
          下载标准模板
        </AppButton>
      </div>

      <Alert
        type="info"
        showIcon
        message="上传后需提交审核"
        description="请提供原始序号、采集时间和样本类型，其他字段可保留原表结构。样本编码将在审核时生成。"
      />

      <div className="hospital-upload-panel">
        <div className="hospital-upload-fields">
          <div>
            <label>数据工作表（单工作表文件可自动识别）</label>
            <Input value={sheetName} onChange={(event) => setSheetName(event.target.value)} placeholder="默认：样本数据" />
          </div>
          <div>
            <label>选择 Excel</label>
            <Upload
              accept=".xls,.xlsx,.xlsm,.csv"
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: next }) => setFileList(next.slice(-1))}
              onRemove={() => {
                setFileList([]);
                return true;
              }}
            >
              <AppButton tone="secondary" icon={<UploadCloud />}>选择 Excel / CSV 文件</AppButton>
            </Upload>
            <div className="hospital-upload-file-hint">支持 .xls / .xlsx / .xlsm / .csv</div>
          </div>
        </div>
        <AppButton tone="primary" icon={<UploadCloud />} loading={uploading} onClick={handleUpload}>
          上传并校验
        </AppButton>
      </div>

      <AppTableCard title="我的提交" total={total}>
        <AppTable<HospitalUploadItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1400}
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

      <Modal
        title={`上传数据预览${previewing ? ` · 批次 #${previewing.id}` : ""}`}
        open={Boolean(previewing)}
        width="96vw"
        okText="确认无误，提交审核"
        cancelText="暂不提交"
        confirmLoading={submitting}
        okButtonProps={{ disabled: !submissionPreview || previewLoading }}
        onOk={handleSubmit}
        onCancel={() => {
          setPreviewing(null);
          setSubmissionPreview(null);
        }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="请核对上传内容后再提交审核"
            description="此处仅预览原始文件，不生成样本编码。如有错误，请撤销批次，修改文件后重新上传。"
          />
          <Descriptions bordered size="small" column={4}>
            <Descriptions.Item label="文件" span={2}>{previewing?.file_name || "-"}</Descriptions.Item>
            <Descriptions.Item label="总数据">{submissionPreview?.total_rows ?? previewing?.total_rows ?? 0} 行</Descriptions.Item>
            <Descriptions.Item label="页面预览">{submissionPreview?.displayed_rows ?? 0} 行</Descriptions.Item>
          </Descriptions>
          <Tabs
            defaultActiveKey="data"
            items={[
              {
                key: "data",
                label: "数据预览",
                children: (
                  <>
                    <AppTable<HospitalReviewPreviewRow>
                      rowKey="row_number"
                      size="small"
                      loading={previewLoading}
                      pagination={false}
                      dataSource={submissionPreview?.rows ?? []}
                      columns={previewColumns}
                      scroll={{
                        x: Math.max((submissionPreview?.headers.length ?? 0) * 150 + 86, 1200),
                        y: 420,
                      }}
                    />
                    {submissionPreview && submissionPreview.total_rows > submissionPreview.displayed_rows ? (
                      <div style={{ marginTop: 8, color: "#64748b" }}>
                        共 {submissionPreview.total_rows} 行，页面展示前 {submissionPreview.displayed_rows} 行。
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                key: "summary",
                label: "校验结果",
                children: (
                  <Alert
                    type="success"
                    showIcon
                    message={`校验通过，共 ${previewing?.valid_rows ?? 0} 行有效数据`}
                    description="提交审核时将再次检查必填字段、日期、样本类型和重复数据。"
                  />
                ),
              },
            ]}
          />
        </Space>
      </Modal>

      <Drawer
        title={detail ? `上传批次 #${detail.batch.id}` : "上传批次详情"}
        width={760}
        open={Boolean(detail)}
        loading={detailLoading}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="状态">{statusTag(detail.batch.status)}</Descriptions.Item>
              <Descriptions.Item label="医院 / 中心">
                {renderCenter(detail.batch.center_code, detail.batch.center_name)}
              </Descriptions.Item>
              <Descriptions.Item label="文件">{detail.batch.file_name}</Descriptions.Item>
              <Descriptions.Item label="大小">{formatFileSize(detail.batch.file_size)}</Descriptions.Item>
              <Descriptions.Item label="文件校验值" span={2}>
                <span style={{ wordBreak: "break-all" }}>{detail.batch.file_hash}</span>
              </Descriptions.Item>
              <Descriptions.Item label="总行数">{detail.batch.total_rows}</Descriptions.Item>
              <Descriptions.Item label="错误行">{detail.batch.error_rows}</Descriptions.Item>
              <Descriptions.Item label="审核人">{detail.batch.reviewed_by_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="审核意见">{detail.batch.review_comment || "-"}</Descriptions.Item>
            </Descriptions>
            {detail.errors.length ? (
              <AppTable
                rowKey={(record) => `${record.row_number}-${record.error_type}-${record.reason}`}
                size="small"
                pagination={false}
                dataSource={detail.errors}
                columns={[
                  { title: "行号", dataIndex: "row_number", width: 72 },
                  { title: "医院原始序号", dataIndex: "sample_id", width: 180 },
                  { title: "原因", dataIndex: "reason" },
                ]}
                scroll={{ y: 360 }}
              />
            ) : (
              <Alert type="success" showIcon message="文件校验通过" />
            )}
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
