import { useEffect, useState } from "react";
import { Modal, Progress, message } from "antd";

import { fetchSecureDocumentPreview, type SecureDocumentItem } from "../api/documents";
import { getApiErrorMessage } from "../utils/http";

type Props = {
  item: SecureDocumentItem | null;
  onClose: () => void;
};

export function SecureDocumentPreviewModal({ item, onClose }: Props) {
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setProgress(0);
      setPreviewUrl(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setProgress(0);
    setPreviewUrl(null);
    setLoading(true);

    void fetchSecureDocumentPreview(item.id, (event) => {
      const total = event.total || item.file_size;
      setProgress(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
    }, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = window.URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setProgress(100);
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code !== "ERR_CANCELED") {
          message.error(getApiErrorMessage(error, "PDF 预览失败"));
          onClose();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [item]);

  return (
    <Modal
      open={Boolean(item)}
      title={item ? `预览：${item.title}` : "PDF 预览"}
      footer={null}
      width="92vw"
      centered
      onCancel={onClose}
      styles={{ body: { height: "82vh", padding: 0, overflow: "hidden" } }}
    >
      {loading || !previewUrl ? (
        <div className="secure-document-preview-loading">
          <Progress type="circle" percent={progress} status="active" />
          <strong>{progress >= 100 ? "文件已接收，正在打开 PDF" : "正在加载 PDF"}</strong>
          <span>文件较大时需要等待，关闭窗口可取消加载。</span>
        </div>
      ) : (
        <iframe className="secure-document-preview-frame" src={previewUrl} title={item?.title || "PDF 预览"} />
      )}
    </Modal>
  );
}
