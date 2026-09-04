import { useEffect, useMemo, useState } from "react";
import { Database, Download, Eye, Search, X } from "lucide-react";
import { Alert, Descriptions, Drawer, Form, Input, Modal, Select, Space, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  downloadHospitalReviewPreview,
  downloadHospitalUploadErrors,
  fetchHospitalCodePreview,
  fetchHospitalReviewPreview,
  fetchHospitalUploadDetail,
  fetchHospitalUploadsForReview,
  importApprovedHospitalUpload,
  reviewHospitalUpload,
  type HospitalCodePreview,
  type HospitalReviewPreview,
  type HospitalReviewPreviewRow,
  type HospitalUploadDetail,
  type HospitalUploadItem,
  type HospitalUploadStatus,
} from "../api/hospitalUploads";
import { saveBlob } from "../utils/download";
import { formatFullDateTime } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";
import { AppButton, AppFilterCard, AppTable, AppTableCard, createTablePagination } from "../ui";

const STATUS_OPTIONS = [
  { value: "submitted", label: "待审核" },
  { value: "approved", label: "审核通过" },
  { value: "imported", label: "已入库" },
  { value: "rejected", label: "已驳回" },
  { value: "import_failed", label: "入库失败" },
  { value: "validation_failed", label: "校验未通过" },
  { value: "validated", label: "校验通过未提交" },
  { value: "cancelled", label: "已撤销" },
];

const STATUS_LABELS: Record<HospitalUploadStatus, string> = {
  validation_failed: "校验未通过",
  validated: "校验通过",
  submitted: "待审核",
  approved: "审核通过",
  rejected: "已驳回",
  imported: "已入库",
  import_failed: "入库失败",
  cancelled: "已撤销",
};

const STATUS_COLORS: Partial<Record<HospitalUploadStatus, string>> = {
  validation_failed: "red",
  validated: "green",
  submitted: "gold",
  approved: "cyan",
  rejected: "orange",
  imported: "blue",
  import_failed: "red",
};

const INITIAL_STATUS_LABELS: Record<string, string> = {
  not_stored: "未入库",
  in_storage: "在库",
  sequencing: "送测中",
};

const REVIEW_STATUS_STORAGE_KEY = "hospital-review-status-filter";

function loadInitialStatusFilter(): HospitalUploadStatus | undefined {
  const stored = window.sessionStorage.getItem(REVIEW_STATUS_STORAGE_KEY);
  if (!stored || stored === "all") return undefined;
  return STATUS_OPTIONS.some((option) => option.value === stored)
    ? stored as HospitalUploadStatus
    : undefined;
}

type ReviewForm = {
  action: "approve" | "reject";
  comment?: string;
};

export function HospitalReviewPage() {
  const [items, setItems] = useState<HospitalUploadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<HospitalUploadStatus | undefined>(loadInitialStatusFilter);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<HospitalUploadDetail | null>(null);
  const [reviewing, setReviewing] = useState<HospitalUploadItem | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | null>(null);
  const [reviewPreview, setReviewPreview] = useState<HospitalReviewPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState<HospitalUploadItem | null>(null);
  const [importPreview, setImportPreview] = useState<HospitalCodePreview | null>(null);
  const [importStatus, setImportStatus] = useState("not_stored");
  const [importLoading, setImportLoading] = useState(false);
  const [form] = Form.useForm<ReviewForm>();

  const loadItems = () => {
    setLoading(true);
    fetchHospitalUploadsForReview({ upload_status: statusFilter, page, page_size: pageSize })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((error) => message.error(getApiErrorMessage(error, "审核列表加载失败")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadItems();
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    window.sessionStorage.setItem(REVIEW_STATUS_STORAGE_KEY, statusFilter ?? "all");
  }, [statusFilter]);

  const openDetail = async (batchId: number) => {
    try {
      setDetail(await fetchHospitalUploadDetail(batchId));
    } catch (error) {
      message.error(getApiErrorMessage(error, "批次详情加载失败"));
    }
  };

  const openReview = async (record: HospitalUploadItem) => {
    setReviewing(record);
    setReviewPreview(null);
    form.setFieldsValue({ action: "approve", comment: "" });
    setPreviewLoading(true);
    try {
      setReviewPreview(await fetchHospitalReviewPreview(record.id));
    } catch (error) {
      message.error(getApiErrorMessage(error, "审核数据预览生成失败"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitReview = async (action: "approve" | "reject") => {
    if (!reviewing) return;
    if (action === "approve" && !reviewPreview) {
      message.warning("请等待审核预览生成完成");
      return;
    }
    const values = form.getFieldsValue();
    if (action === "reject" && (values.comment || "").trim().length < 2) {
      message.warning("驳回时请填写至少 2 个字的原因");
      return;
    }
    setSubmittingAction(action);
    try {
      await reviewHospitalUpload(reviewing.id, {
        action,
        comment: values.comment,
      });
      message.success(action === "approve" ? "审核已通过" : "批次已驳回");
      setReviewing(null);
      setReviewPreview(null);
      form.resetFields();
      if (action === "approve") {
        setPage(1);
        setStatusFilter("approved");
      } else {
        loadItems();
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, "审核处理失败"));
    } finally {
      setSubmittingAction(null);
    }
  };

  const downloadErrors = async (batchId: number) => {
    try {
      saveBlob(await downloadHospitalUploadErrors(batchId), `医院上传批次_${batchId}_错误报告.csv`);
    } catch (error) {
      message.error(getApiErrorMessage(error, "错误报告下载失败"));
    }
  };

  const downloadReviewPreview = async (batchId: number) => {
    try {
      saveBlob(await downloadHospitalReviewPreview(batchId), `医院上传批次_${batchId}_审核预览.xlsx`);
    } catch (error) {
      message.error(getApiErrorMessage(error, "审核预览下载失败"));
    }
  };

  const openImport = async (record: HospitalUploadItem) => {
    setImporting(record);
    setImportPreview(null);
    setImportStatus(record.default_status && INITIAL_STATUS_LABELS[record.default_status] ? record.default_status : "not_stored");
    setPreviewLoading(true);
    try {
      setImportPreview(await fetchHospitalCodePreview(record.id));
    } catch (error) {
      setImporting(null);
      message.error(getApiErrorMessage(error, "样本编码预览生成失败"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitImport = async () => {
    if (!importing || !importPreview) return;
    setImportLoading(true);
    try {
      await importApprovedHospitalUpload(importing.id, importStatus);
      message.success("批次已导入系统");
      setImporting(null);
      setImportPreview(null);
      loadItems();
    } catch (error) {
      message.error(getApiErrorMessage(error, "正式导入失败"));
      loadItems();
    } finally {
      setImportLoading(false);
    }
  };

  const reviewColumns = useMemo<ColumnsType<HospitalReviewPreviewRow>>(() => {
    const sensitiveColumns = new Set(reviewPreview?.sensitive_columns ?? []);
    return [
      {
        title: "Excel 行",
        dataIndex: "row_number",
        key: "row_number",
        width: 86,
        fixed: "left",
      },
      ...(reviewPreview?.headers ?? []).map((header, index) => ({
        title: sensitiveColumns.has(index) ? (
          <Space size={4}>
            <span>{header}</span>
            <Tag color="red">敏感</Tag>
          </Space>
        ) : header,
        key: `preview-${index}-${header}`,
        width: header === "sample_code" ? 250 : Math.min(Math.max(header.length * 18 + 60, 120), 220),
        ellipsis: true,
        render: (_: unknown, record: HospitalReviewPreviewRow) => {
          const value = record.values[index];
          return value === null || value === undefined || value === "" ? "-" : String(value);
        },
      })),
    ];
  }, [reviewPreview]);

  const columns = useMemo<ColumnsType<HospitalUploadItem>>(
    () => [
      { title: "批次", dataIndex: "id", width: 80, render: (value) => `#${value}` },
      { title: "医院/中心", width: 250, render: (_, record) => `${record.center_name || "-"}（${record.center_code}）` },
      { title: "上传人", dataIndex: "uploaded_by_name", width: 120 },
      { title: "文件", dataIndex: "file_name", width: 220, ellipsis: true },
      {
        title: "数据量",
        width: 150,
        render: (_, record) => (
          <Space size={4}>
            <Tag>共 {record.total_rows}</Tag>
            <Tag color="green">新增 {record.new_rows}</Tag>
          </Space>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 110,
        render: (value: HospitalUploadStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>,
      },
      { title: "提交时间", dataIndex: "submitted_at", width: 170, render: formatFullDateTime },
      {
        title: "操作",
        width: 260,
        fixed: "right",
        render: (_, record) => (
          <Space wrap>
            <AppButton tone="quiet" size="small" icon={<Eye />} onClick={() => openDetail(record.id)}>详情</AppButton>
            {record.error_rows > 0 ? (
              <AppButton tone="quiet" size="small" icon={<Download />} onClick={() => downloadErrors(record.id)}>错误报告</AppButton>
            ) : null}
            {record.status === "submitted" ? (
              <AppButton tone="primary" size="small" icon={<Eye />} onClick={() => openReview(record)}>审核</AppButton>
            ) : null}
            {record.status === "approved" || record.status === "import_failed" ? (
              <>
                <AppButton tone="quiet" size="small" icon={<Download />} onClick={() => downloadReviewPreview(record.id)}>
                  下载审核预览
                </AppButton>
                <AppButton tone="primary" size="small" icon={<Database />} onClick={() => openImport(record)}>
                  {record.status === "import_failed" ? "重试导入" : "导入系统（可选）"}
                </AppButton>
              </>
            ) : null}
          </Space>
        ),
      },
    ],
    [],
  );

  return (
    <div className="hospital-review-page">
      <div className="page-toolbar">
        <div>
          <h2>医院数据审核</h2>
          <span>查看并审核医院提交的数据</span>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message="审核通过后不会自动导入"
        description="审核通过后可以下载留档；需要入库时，再点击“导入系统”。"
      />

      <AppFilterCard>
        <div className="samples-filter-bar">
          <Select
            allowClear
            placeholder="批次状态"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(value) => {
              setPage(1);
              setStatusFilter(value);
            }}
            style={{ width: 190 }}
          />
          <AppButton tone="primary" icon={<Search />} onClick={loadItems}>刷新</AppButton>
        </div>
      </AppFilterCard>

      <AppTableCard title="上传审核批次" total={total}>
        <AppTable<HospitalUploadItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1450}
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
        title={detail ? `医院上传批次 #${detail.batch.id}` : "批次详情"}
        width={780}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="中心">{detail.batch.center_name}（{detail.batch.center_code}）</Descriptions.Item>
              <Descriptions.Item label="上传人">{detail.batch.uploaded_by_name}</Descriptions.Item>
              <Descriptions.Item label="文件">{detail.batch.file_name}</Descriptions.Item>
              <Descriptions.Item label="文件校验值">{detail.batch.file_hash}</Descriptions.Item>
              <Descriptions.Item label="有效行">{detail.batch.valid_rows}</Descriptions.Item>
              <Descriptions.Item label="错误行">{detail.batch.error_rows}</Descriptions.Item>
              <Descriptions.Item label="审核意见" span={2}>{detail.batch.review_comment || "-"}</Descriptions.Item>
              <Descriptions.Item label="导入人">{detail.batch.imported_by_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="导入时间">{formatFullDateTime(detail.batch.imported_at)}</Descriptions.Item>
              {detail.batch.import_error ? (
                <Descriptions.Item label="导入失败原因" span={2}>{detail.batch.import_error}</Descriptions.Item>
              ) : null}
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
                scroll={{ y: 320 }}
              />
            ) : (
              <Alert type="success" showIcon message="校验通过" />
            )}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={`审核医院上传批次 #${reviewing?.id ?? ""}`}
        open={Boolean(reviewing)}
        onCancel={() => {
          setReviewing(null);
          setReviewPreview(null);
          form.resetFields();
        }}
        width="96vw"
        footer={[
          <AppButton
            key="cancel"
            tone="quiet"
            onClick={() => {
              setReviewing(null);
              setReviewPreview(null);
              form.resetFields();
            }}
          >
            取消
          </AppButton>,
          <AppButton
            key="reject"
            tone="danger"
            icon={<X />}
            loading={submittingAction === "reject"}
            disabled={Boolean(submittingAction && submittingAction !== "reject")}
            onClick={() => submitReview("reject")}
          >
            驳回
          </AppButton>,
          <AppButton
            key="approve"
            tone="primary"
            loading={submittingAction === "approve"}
            disabled={!reviewPreview || previewLoading || Boolean(submittingAction && submittingAction !== "approve")}
            onClick={() => submitReview("approve")}
          >
            审核通过
          </AppButton>,
        ]}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="请核对数据后再选择审核结果"
            description="预览表已在原始序号后增加样本编码。正式导入时，系统会再次校验编码。"
          />
          <Descriptions bordered size="small" column={4}>
            <Descriptions.Item label="医院 / 中心" span={2}>
              {reviewing?.center_name || "-"}（{reviewing?.center_code || "-"}）
            </Descriptions.Item>
            <Descriptions.Item label="上传人">{reviewing?.uploaded_by_name || "-"}</Descriptions.Item>
            <Descriptions.Item label="文件">{reviewing?.file_name || "-"}</Descriptions.Item>
            <Descriptions.Item label="总数据">{reviewPreview?.total_rows ?? reviewing?.total_rows ?? 0} 行</Descriptions.Item>
            <Descriptions.Item label="有效数据">{reviewing?.valid_rows ?? 0} 行</Descriptions.Item>
            <Descriptions.Item label="敏感字段">
              {reviewPreview?.sensitive_columns.length ?? 0} 列
            </Descriptions.Item>
            <Descriptions.Item label="页面预览">
              {reviewPreview?.displayed_rows ?? 0} 行
            </Descriptions.Item>
          </Descriptions>
          <div>
            <AppButton
              tone="quiet"
              size="small"
              icon={<Download />}
              disabled={!reviewPreview}
              onClick={() => reviewing && downloadReviewPreview(reviewing.id)}
            >
              下载完整审核预览 Excel
            </AppButton>
          </div>
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
                      dataSource={reviewPreview?.rows ?? []}
                      columns={reviewColumns}
                      scroll={{
                        x: Math.max((reviewPreview?.headers.length ?? 0) * 150 + 86, 1200),
                        y: 360,
                      }}
                    />
                    {reviewPreview && reviewPreview.total_rows > reviewPreview.displayed_rows ? (
                      <div style={{ marginTop: 8, color: "#64748b" }}>
                        共 {reviewPreview.total_rows} 行，页面展示前 {reviewPreview.displayed_rows} 行；完整内容请下载审核预览 Excel。
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                key: "summary",
                label: "校验概览",
                children: (
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="采集日期分布">
                      <Space wrap>
                        {Object.entries(reviewPreview?.date_counts ?? {}).map(([day, count]) => (
                          <Tag key={day}>{day}：{count}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="样本类型分布">
                      <Space wrap>
                        {Object.entries(reviewPreview?.specimen_type_counts ?? {}).map(([type, count]) => (
                          <Tag key={type} color="blue">{type}：{count}</Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="自动校验" span={2}>
                      <Tag color="green">已通过</Tag>
                      文件完整性、必填字段、日期、样本类型和文件内重复均已重新检查
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
            ]}
          />
          <Form form={form} layout="vertical">
            <Form.Item name="comment" label="审核意见；驳回时必须填写原因">
              <Input.TextArea rows={3} maxLength={1000} showCount />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title={`正式导入批次 #${importing?.id ?? ""}`}
        open={Boolean(importing)}
        okText="确认正式导入"
        cancelText="取消"
        confirmLoading={importLoading}
        okButtonProps={{ disabled: !importPreview || previewLoading }}
        onOk={submitImport}
        onCancel={() => {
          setImporting(null);
          setImportPreview(null);
        }}
        centered
        width={900}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="确认导入后才会新增样本"
            description="此操作可以稍后进行。确认导入后，系统会重新校验全部数据；如有一行不符合要求，本批数据均不会写入。"
          />
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="有效数据">{importing?.valid_rows ?? 0} 行</Descriptions.Item>
            <Descriptions.Item label="初始状态">
              <Select
                value={importStatus}
                style={{ width: 180 }}
                onChange={setImportStatus}
                options={[
                  { value: "not_stored", label: "未入库" },
                  { value: "in_storage", label: "在库" },
                  { value: "sequencing", label: "送测中" },
                ]}
              />
            </Descriptions.Item>
          </Descriptions>
          <div>
            <AppButton
              tone="quiet"
              size="small"
              icon={<Download />}
              onClick={() => importing && downloadReviewPreview(importing.id)}
            >
              下载完整审核预览
            </AppButton>
          </div>
          <AppTable
            rowKey="row_number"
            size="small"
            loading={previewLoading}
            pagination={false}
            dataSource={importPreview?.rows ?? []}
            columns={[
              { title: "Excel 行", dataIndex: "row_number", width: 85 },
              { title: "医院原始序号", dataIndex: "sample_id", width: 150 },
              { title: "采集日期", dataIndex: "collection_date", width: 120 },
              { title: "样本类型", dataIndex: "specimen_type", width: 100 },
              { title: "样本编码", dataIndex: "sample_code", width: 250 },
            ]}
            scroll={{ y: 300 }}
          />
          {importPreview && importPreview.total_rows > importPreview.rows.length ? (
            <div style={{ color: "#64748b" }}>
              共 {importPreview.total_rows} 行，页面展示前 {importPreview.rows.length} 行；可下载完整预览。
            </div>
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}
