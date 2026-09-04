import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Trash2, UploadCloud } from "lucide-react";
import { Card, List, Progress, Space, Tag, Upload, message } from "antd";

import {
  deleteSecureDocument,
  downloadSecureDocument,
  fetchSecureDocuments,
  SECURE_DOCUMENT_MAX_BYTES,
  uploadSecureDocument,
  type SecureDocumentItem,
} from "../api/documents";
import { SecureDocumentPreviewModal } from "./SecureDocumentPreviewModal";
import { AppButton, confirmAction } from "../ui";
import { saveBlob } from "../utils/download";
import { formatFullDateTime, valueText } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";

function fileSizeText(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SampleDocumentsPanel({ samplePk }: { samplePk: number }) {
  const [items, setItems] = useState<SecureDocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadFailed, setUploadFailed] = useState(false);
  const [previewItem, setPreviewItem] = useState<SecureDocumentItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  const loadDocuments = useCallback(() => {
    setLoading(true);
    fetchSecureDocuments({ scope_type: "sample", sample_pk: samplePk, page_size: 100 })
      .then((data) => setItems(data.items))
      .catch((error) => message.error(getApiErrorMessage(error, "样本资料加载失败")))
      .finally(() => setLoading(false));
  }, [samplePk]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleUpload = async (file: File) => {
    setUploadPercent(0);
    setUploadStage("正在上传 PDF");
    setUploadFailed(false);
    setUploading(true);
    try {
      await uploadSecureDocument({
        file,
        document_type: "organoid_report",
        scope_type: "sample",
        sample_pk: samplePk,
      }, (event) => {
        const total = event.total || file.size;
        const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
        setUploadPercent(percent);
        setUploadStage(percent >= 100 ? "文件已上传，正在保存" : "正在上传 PDF");
      });
      setUploadPercent(100);
      setUploadStage("上传完成");
      message.success("类器官报告已保存");
      loadDocuments();
    } catch (error) {
      setUploadStage("上传失败");
      setUploadFailed(true);
      message.error(getApiErrorMessage(error, "报告上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = (item: SecureDocumentItem) => {
    if (item.file_size >= 50 * 1024 * 1024) {
      message.info("文件较大，预览窗口会显示实时加载进度");
    }
    setPreviewItem(item);
  };

  const handleDownload = async (item: SecureDocumentItem) => {
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

  const handleDelete = (item: SecureDocumentItem) => {
    confirmAction({
      title: "删除这份类器官报告？",
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

  return (
    <Card
      className="detail-sub-card"
      title="资料附件"
      extra={(
        <Upload
          accept=".pdf,application/pdf"
          showUploadList={false}
          beforeUpload={(file) => {
            if (file.size > SECURE_DOCUMENT_MAX_BYTES) {
              message.error("PDF 文件不能超过 200 MB");
              return Upload.LIST_IGNORE;
            }
            void handleUpload(file);
            return Upload.LIST_IGNORE;
          }}
        >
          <AppButton size="small" icon={<UploadCloud />} loading={uploading}>
            上传构建报告（最大 200 MB）
          </AppButton>
        </Upload>
      )}
    >
      <List
        loading={loading}
        locale={{ emptyText: "暂无类器官报告" }}
        dataSource={items}
        renderItem={(item) => (
          <List.Item
            actions={[
              <AppButton
                key="preview"
                tone="quiet"
                size="small"
                icon={<Eye />}
                disabled={previewItem !== null}
                onClick={() => handlePreview(item)}
              >
                预览
              </AppButton>,
              <AppButton
                key="download"
                tone="quiet"
                size="small"
                icon={<Download />}
                loading={downloadingId === item.id}
                disabled={downloadingId !== null && downloadingId !== item.id}
                onClick={() => handleDownload(item)}
              >
                {downloadingId === item.id ? `下载 ${downloadPercent}%` : "下载"}
              </AppButton>,
              <AppButton key="delete" tone="danger" size="small" icon={<Trash2 />} onClick={() => handleDelete(item)}>删除</AppButton>,
            ]}
          >
            <List.Item.Meta
              title={(
                <Space wrap>
                  <span>{valueText(item.title)}</span>
                  <Tag color="blue">类器官构建报告</Tag>
                </Space>
              )}
              description={`${item.original_file_name} · ${fileSizeText(item.file_size)} · ${formatFullDateTime(item.created_at)}`}
            />
          </List.Item>
        )}
      />
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
      <SecureDocumentPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </Card>
  );
}
