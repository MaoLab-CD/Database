import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
} from "lucide-react";
import { Modal, Space, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Key } from "react";

import {
  confirmReturn,
  confirmReturnsBatch,
  fetchPendingReturns,
  type FinalReturnStatus,
  type PendingReturnItem,
} from "../api/returns";
import { getApiErrorMessage } from "../utils/http";
import { formatFullDateTime, valueText } from "../utils/format";
import { AppAlert, AppButton, AppTable, AppTableCard, EllipsisCell } from "../ui";

const FINAL_STATUS_META: Record<
  FinalReturnStatus,
  { label: string; tagColor: string; className: string }
> = {
  in_storage: {
    label: "确认入库",
    tagColor: "blue",
    className: "return-action-in-storage",
  },
  consumed: {
    label: "已用完",
    tagColor: "green",
    className: "return-action-consumed",
  },
  lost: {
    label: "丢失",
    tagColor: "orange",
    className: "return-action-lost",
  },
  discarded: {
    label: "废弃",
    tagColor: "red",
    className: "return-action-discarded",
  },
};

type ReturnReviewPageProps = {
  onPendingCountChange?: (count: number) => void;
};

export function ReturnReviewPage({ onPendingCountChange }: ReturnReviewPageProps) {
  const [items, setItems] = useState<PendingReturnItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchConfirming, setBatchConfirming] = useState<FinalReturnStatus | null>(null);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedRowKeys.includes(item.id)),
    [items, selectedRowKeys],
  );

  const loadReturns = () => {
    setLoading(true);
    fetchPendingReturns()
      .then((rows) => {
        setItems(rows);
        onPendingCountChange?.(rows.length);
      })
      .catch(() => message.error("归还待确认列表加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReturns();
  }, []);

  const confirmFinalStatus = (record: PendingReturnItem, finalStatus: FinalReturnStatus) => {
    const meta = FINAL_STATUS_META[finalStatus];
    Modal.confirm({
      title: `确认将样本 ${record.sample_code || record.sample_id} 标记为“${meta.label}”？`,
      content:
        finalStatus === "in_storage"
          ? "确认后样本会回到在库状态，可再次出库。"
          : "确认后样本将不能再次出库，请核对无误后操作。",
      okText: meta.label,
      cancelText: "取消",
      centered: true,
      onOk: async () => {
        setConfirmingId(record.id);
        try {
          const result = await confirmReturn(record.id, finalStatus);
          message.success(result.message);
          await loadReturns();
        } catch (error: unknown) {
          message.error(getApiErrorMessage(error, "归还复核失败"));
        } finally {
          setConfirmingId(null);
        }
      },
    });
  };

  const confirmBatchFinalStatus = (finalStatus: FinalReturnStatus) => {
    if (selectedItems.length === 0) {
      message.warning("请先选择需要复核的归还申请");
      return;
    }

    const meta = FINAL_STATUS_META[finalStatus];
    const samplePreview = selectedItems
      .slice(0, 8)
      .map((item) => item.sample_code || item.sample_id)
      .join("、");
    const moreText = selectedItems.length > 8 ? ` 等 ${selectedItems.length} 个样本` : "";

    Modal.confirm({
      title: `确认批量标记为“${meta.label}”？`,
      content: (
        <div className="batch-review-confirm">
          <p>
            本次将复核 <strong>{selectedItems.length}</strong> 条归还申请：
            {samplePreview}
            {moreText}
          </p>
          <p>
            {finalStatus === "in_storage"
              ? "确认后这些样本会回到在库状态，可再次出库。"
              : "确认后这些样本将不能再次出库，请核对无误后操作。"}
          </p>
        </div>
      ),
      okText: `确认${meta.label}`,
      cancelText: "取消",
      centered: true,
      onOk: async () => {
        setBatchConfirming(finalStatus);
        try {
          const result = await confirmReturnsBatch(
            selectedItems.map((item) => item.id),
            finalStatus,
          );
          message.success(result.message);
          setSelectedRowKeys([]);
          await loadReturns();
        } catch (error: unknown) {
          message.error(
            getApiErrorMessage(error, "批量归还复核失败，本批数据未做修改"),
          );
        } finally {
          setBatchConfirming(null);
        }
      },
    });
  };

  const columns = useMemo<ColumnsType<PendingReturnItem>>(
    () => [
      {
        title: "样本编号",
        dataIndex: "sample_code",
        width: 220,
        render: (value: string | null, record) => (
          <EllipsisCell
            value={value || record.sample_id}
            copyable
            strong
            copyLabel="样本编码"
          />
        ),
      },
      { title: "条码号", dataIndex: "barcode_no", width: 150, render: valueText },
      { title: "病人号", dataIndex: "patient_no", width: 130, render: valueText },
      { title: "民族", dataIndex: "ethnicity", width: 90, render: valueText },
      { title: "科室", dataIndex: "department", width: 150, render: valueText },
      { title: "样本类型", dataIndex: "specimen_type", width: 100, render: valueText },
      {
        title: "出库人",
        dataIndex: "checkout_user_name",
        width: 110,
        render: valueText,
      },
      {
        title: "归还人",
        dataIndex: "returned_by_name",
        width: 110,
        render: valueText,
      },
      {
        title: "归还申请时间",
        dataIndex: "return_requested_at",
        width: 160,
        render: formatFullDateTime,
      },
      {
        title: "使用量",
        width: 100,
        render: (_, record) =>
          record.used_volume_ul != null
            ? `${record.used_volume_ul} ul`
            : record.used_amount
              ? `${record.used_amount}${record.unit ?? ""}`
              : "-",
      },
      {
        title: "用途",
        dataIndex: "purpose",
        width: 120,
        render: valueText,
      },
      {
        title: "状态",
        width: 110,
        render: () => <Tag color="gold">待归还复核</Tag>,
      },
      {
        title: "复核操作",
        width: 210,
        render: (_, record) => (
          <div className="return-action-grid">
            {(Object.keys(FINAL_STATUS_META) as FinalReturnStatus[]).map((status) => {
              const meta = FINAL_STATUS_META[status];
              return (
                <AppButton
                  key={status}
                  tone="secondary"
                  size="small"
                  className={`return-status-action ${meta.className}`}
                  loading={confirmingId === record.id}
                  onClick={() => confirmFinalStatus(record, status)}
                >
                  {meta.label}
                </AppButton>
              );
            })}
          </div>
        ),
      },
    ],
    [confirmingId],
  );

  return (
    <div className="return-review-page">
      <div className="page-toolbar">
        <div>
          <h2>归还待确认</h2>
          <span>待复核 {items.length} 条</span>
        </div>
        <AppButton tone="secondary" icon={<RefreshCw />} onClick={loadReturns}>
          刷新
        </AppButton>
      </div>

      <AppAlert
        type="info"
        message={`当前共有 ${items.length} 条待复核归还申请`}
      />

      <AppTableCard
        className="samples-table-card return-review-table-card"
        title="待复核列表"
        total={items.length}
        extra={
          <Space wrap className="return-review-batch-actions">
            <span className="table-total">
              已选 {selectedRowKeys.length} / 共 {items.length} 条
            </span>
            {(Object.keys(FINAL_STATUS_META) as FinalReturnStatus[]).map((status) => {
              const meta = FINAL_STATUS_META[status];
              return (
                <AppButton
                  key={status}
                  tone="secondary"
                  size="small"
                  className={`return-status-action return-batch-action ${meta.className}`}
                  loading={batchConfirming === status}
                  disabled={selectedRowKeys.length === 0 || batchConfirming !== null}
                  onClick={() => confirmBatchFinalStatus(status)}
                >
                  批量{meta.label}
                </AppButton>
              );
            })}
          </Space>
        }
      >
        <AppTable<PendingReturnItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          scrollX={1620}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
          }}
        />
      </AppTableCard>
    </div>
  );
}
