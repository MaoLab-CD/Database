import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Search, Trash2, UploadCloud } from "lucide-react";
import { Form, Input, Progress, Select, Space, Tag, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import { fetchCenters, type CenterItem } from "../api/centers";
import {
  deleteSecureDocument,
  downloadSecureDocument,
  fetchSecureDocuments,
  SECURE_DOCUMENT_MAX_BYTES,
  uploadSecureDocument,
  type SecureDocumentItem,
} from "../api/documents";
import { SecureDocumentPreviewModal } from "../components/SecureDocumentPreviewModal";
import {
  AppAlert,
  AppButton,
  AppFilterCard,
  AppInput,
  AppTable,
  AppTableCard,
  confirmAction,
  createTablePagination,
} from "../ui";
import { saveBlob } from "../utils/download";
import { formatFullDateTime, valueText } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";

type UploadFormValues = {
  title: string;
  center_code?: string;
  coverage_note?: string;
};

function fileSizeText(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SecureDocumentsPage() {
  const [form] = Form.useForm<UploadFormValues>();
  const [file, setFile] = useState<File | null>(null);
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const [items, setItems] = useState<SecureDocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadFailed, setUploadFailed] = useState(false);
  const [previewItem, setPreviewItem] = useState<SecureDocumentItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  const loadDocuments = () => {
    setLoading(true);
    fetchSecureDocuments({
      scope_type: "collection",
      keyword: keyword.trim() || undefined,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((error) => message.error(getApiErrorMessage(error, "资料档案加载失败")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCenters({ active_status: "active", page_size: 1000 })
      .then((data) => setCenters(data.items))
      .catch(() => message.error("中心列表加载失败"));
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [page, pageSize]);

  const centerOptions = useMemo(() => centers.map((center) => ({
    value: center.center_code,
    label: `${center.center_name}（${center.center_code}）`,
  })), [centers]);

  const submitUpload = async () => {
    const values = await form.validateFields();
    if (!file) {
      message.warning("请选择知情同意书 PDF");
      return;
    }
    setUploadPercent(0);
    setUploadStage("正在上传 PDF");
    setUploadFailed(false);
    setUploading(true);
    try {
      await uploadSecureDocument({
        file,
        document_type: "informed_consent_bundle",
        scope_type: "collection",
        title: values.title,
        center_code: values.center_code,
        coverage_note: values.coverage_note,
      }, (event) => {
        const total = event.total || file.size;
        const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
        setUploadPercent(percent);
        setUploadStage(percent >= 100 ? "文件已上传，正在保存" : "正在上传 PDF");
      });
      setUploadPercent(100);
      setUploadStage("上传完成");
      message.success("知情同意书已保存");
      form.resetFields();
      setFile(null);
      setPage(1);
      loadDocuments();
    } catch (error) {
      setUploadStage("上传失败");
      setUploadFailed(true);
      message.error(getApiErrorMessage(error, "知情同意书上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const preview = (item: SecureDocumentItem) => {
    if (item.file_size >= 50 * 1024 * 1024) {
      message.info("文件较大，预览窗口会显示实时加载进度");
    }
    setPreviewItem(item);
  };

  const download = async (item: SecureDocumentItem) => {
    if (downloadingId !== null) return;
    setDownloadingId(item.id);
    setDownloadPercent(0);
    try {
      saveBlob(await downloadSecureDocument(item.id, (event) => {
        const total = event.total || item.file_size;
        setDownloadPercent(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
      }), item.original_file_name);
    } catch (error) {
      message.error(getApiErrorMessage(error, "PDF 下载失败"));
    } finally {
      setDownloadingId(null);
      setDownloadPercent(0);
    }
  };

  const remove = (item: SecureDocumentItem) => {
    confirmAction({
      title: "删除这份资料？",
      content: "删除后文件无法恢复，操作记录仍会保留。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteSecureDocument(item.id);
          message.success("资料已删除");
          loadDocuments();
        } catch (error) {
          message.error(getApiErrorMessage(error, "资料删除失败"));
        }
      },
    });
  };

  const columns: ColumnsType<SecureDocumentItem> = [
    {
      title: "资料名称",
      dataIndex: "title",
      width: 260,
      render: (value: string) => <strong>{valueText(value)}</strong>,
    },
    {
      title: "类型",
      dataIndex: "document_type",
      width: 150,
      render: () => <Tag color="purple">知情同意书（合并）</Tag>,
    },
    {
      title: "中心",
      dataIndex: "center_name",
      width: 220,
      render: (value: string | null, item) => valueText(value || item.center_code || "未指定"),
    },
    { title: "资料范围", dataIndex: "coverage_note", width: 320, render: valueText },
    { title: "原文件", dataIndex: "original_file_name", width: 240, render: valueText },
    { title: "大小", dataIndex: "file_size", width: 100, render: fileSizeText },
    { title: "上传人", dataIndex: "uploaded_by_name", width: 120, render: valueText },
    { title: "上传时间", dataIndex: "created_at", width: 170, render: formatFullDateTime },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 230,
      render: (_, item) => (
        <Space>
          <AppButton
            tone="quiet"
            size="small"
            icon={<Eye />}
            disabled={previewItem !== null}
            onClick={() => preview(item)}
          >
            预览
          </AppButton>
          <AppButton
            tone="quiet"
            size="small"
            icon={<Download />}
            loading={downloadingId === item.id}
            disabled={downloadingId !== null && downloadingId !== item.id}
            onClick={() => download(item)}
          >
            {downloadingId === item.id ? `下载 ${downloadPercent}%` : "下载"}
          </AppButton>
          <AppButton tone="danger" size="small" icon={<Trash2 />} onClick={() => remove(item)}>删除</AppButton>
        </Space>
      ),
    },
  ];

  return (
    <div className="secure-documents-page">
      <div className="page-toolbar">
        <div>
          <h2>资料档案</h2>
          <span>统一保存知情同意书等项目资料</span>
        </div>
      </div>

      <AppAlert
        type="info"
        message="合并文件按批次保存"
        description="当前文件未与单个样本关联。如需按患者查询，可在整理人员清单后补充对应关系。"
      />

      <AppFilterCard className="secure-document-upload-card">
        <Form form={form} layout="vertical">
          <div className="secure-document-upload-grid">
            <Form.Item name="title" label="资料名称" rules={[{ required: true, message: "请输入资料名称" }]}>
              <Input placeholder="例如：2025年8月样本研究知情同意书汇总" maxLength={255} />
            </Form.Item>
            <Form.Item name="center_code" label="相关中心（可选）">
              <Select allowClear showSearch optionFilterProp="label" options={centerOptions} placeholder="选择医院或中心" />
            </Form.Item>
            <Form.Item name="coverage_note" label="资料范围">
              <Input.TextArea rows={2} maxLength={2000} placeholder="例如：2025年8月，共3位受试者，当前为合并扫描件" />
            </Form.Item>
            <Form.Item label="PDF 文件" required>
              <Upload
                accept=".pdf,application/pdf"
                maxCount={1}
                fileList={file ? [{ uid: "selected", name: file.name, status: "done" }] : []}
                beforeUpload={(selected) => {
                  if (selected.size > SECURE_DOCUMENT_MAX_BYTES) {
                    message.error("PDF 文件不能超过 200 MB");
                    setFile(null);
                    return Upload.LIST_IGNORE;
                  }
                  setFile(selected);
                  setUploadPercent(0);
                  setUploadStage("");
                  setUploadFailed(false);
                  return false;
                }}
                onRemove={() => {
                  setFile(null);
                  return true;
                }}
              >
                <AppButton icon={<UploadCloud />}>选择 PDF</AppButton>
              </Upload>
              <div className="form-tip">仅支持 PDF，单个文件最大 200 MB</div>
            </Form.Item>
          </div>
          <AppButton tone="primary" icon={<UploadCloud />} loading={uploading} onClick={submitUpload}>
            加密上传
          </AppButton>
          {uploadStage ? (
            <div className="secure-document-transfer-progress">
              <Progress
                percent={uploadPercent}
                status={uploadFailed ? "exception" : uploadPercent === 100 && !uploading ? "success" : "active"}
                size="small"
              />
              <span>{uploadStage}</span>
            </div>
          ) : null}
        </Form>
      </AppFilterCard>

      <AppFilterCard>
        <div className="audit-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索资料名称、文件名、中心或资料范围"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadDocuments();
            }}
          />
          <AppButton tone="primary" icon={<Search />} onClick={() => {
            setPage(1);
            loadDocuments();
          }}>查询</AppButton>
        </div>
      </AppFilterCard>

      <AppTableCard title="资料列表" total={total}>
        <AppTable<SecureDocumentItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1810}
          pagination={createTablePagination({
            page,
            pageSize,
            total,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          })}
        />
      </AppTableCard>
      <SecureDocumentPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}
