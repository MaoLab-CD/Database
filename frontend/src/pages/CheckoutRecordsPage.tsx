import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Search,
} from "lucide-react";
import { Select, Space, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  fetchMovementRecords,
  type MovementActionType,
  type MovementRecordItem,
} from "../api/records";
import { statusTag } from "../constants/status";
import { formatFullDateTime, valueText } from "../utils/format";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
  EllipsisCell,
  createTablePagination,
} from "../ui";

const ACTION_META: Record<
  MovementActionType,
  { label: string; color: string }
> = {
  checkout: { label: "扫码出库", color: "blue" },
  return_request: { label: "提交归还", color: "gold" },
  return_confirm: { label: "归还复核", color: "green" },
};

const ACTION_OPTIONS = Object.entries(ACTION_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function CheckoutRecordsPage() {
  const [keyword, setKeyword] = useState("");
  const [actionType, setActionType] = useState<MovementActionType | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MovementRecordItem[]>([]);
  const [total, setTotal] = useState(0);

  const loadRecords = () => {
    setLoading(true);
    fetchMovementRecords({
      keyword: keyword.trim() || undefined,
      action_type: actionType,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => message.error("出入库记录加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecords();
  }, [page, pageSize, actionType]);

  const actionSummary = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.action_type] = (acc[item.action_type] ?? 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const columns: ColumnsType<MovementRecordItem> = [
    {
      title: "样本编码",
      dataIndex: "sample_code",
      width: 220,
      fixed: "left",
      render: (value: string | null, record) => (
        <EllipsisCell
          value={value || record.sample_id}
          copyable
          strong
          copyLabel="样本编码"
        />
      ),
    },
    { title: "原始序号", dataIndex: "sample_id", width: 90, render: valueText },
    { title: "条码号", dataIndex: "barcode_no", width: 145, render: valueText },
    { title: "病人号", dataIndex: "patient_no", width: 130, render: valueText },
    {
      title: "操作类型",
      dataIndex: "action_type",
      width: 122,
      render: (value: MovementActionType) => {
        const meta = ACTION_META[value];
        return (
          <Tag color={meta.color}>
            {meta.label}
          </Tag>
        );
      },
    },
    {
      title: "状态变化",
      width: 210,
      render: (_, record) => (
        <Space size={6} className="movement-status-flow">
          {record.before_status ? statusTag(record.before_status, "sample") : <Tag>-</Tag>}
          <ArrowRight size={14} className="movement-arrow" />
          {record.after_status ? statusTag(record.after_status, "sample") : <Tag>-</Tag>}
        </Space>
      ),
    },
    { title: "操作人", dataIndex: "operator_name", width: 110, render: valueText },
    {
      title: "操作时间",
      dataIndex: "created_at",
      width: 160,
      render: formatFullDateTime,
      sorter: false,
    },
    { title: "民族", dataIndex: "ethnicity", width: 90, render: valueText },
    { title: "科室", dataIndex: "department", width: 150, render: valueText },
    { title: "样本类型", dataIndex: "specimen_type", width: 100, render: valueText },
    {
      title: "关联记录",
      dataIndex: "related_record_id",
      width: 100,
      render: (value: number | null) => (value ? `#${value}` : "-"),
    },
    {
      title: "备注",
      dataIndex: "note",
      width: 180,
      ellipsis: true,
      render: valueText,
    },
  ];

  return (
    <div className="checkout-records-page">
      <div className="page-toolbar">
        <div>
          <h2>出入库记录</h2>
          <span>共 {total} 条</span>
        </div>
      </div>

      <AppSummaryGrid
        items={(Object.keys(ACTION_META) as MovementActionType[]).map((key) => ({
          key,
          label: ACTION_META[key].label,
          value: actionSummary[key] ?? 0,
        }))}
      />

      <AppFilterCard>
        <div className="samples-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索样本编码、原始序号、条码号、病人号、民族、科室、操作人"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadRecords();
            }}
          />
          <Select
            allowClear
            placeholder="操作类型"
            options={ACTION_OPTIONS}
            value={actionType}
            onChange={(value) => {
              setPage(1);
              setActionType(value);
            }}
          />
          <Space>
            <AppButton
              tone="primary"
              icon={<Search />}
              onClick={() => {
                setPage(1);
                loadRecords();
              }}
            >
              查询
            </AppButton>
            <AppButton
              tone="secondary"
              onClick={() => {
                setKeyword("");
                setActionType(undefined);
                setPage(1);
              }}
            >
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card records-table-card"
        title="流转记录"
        total={total}
      >
        <AppTable<MovementRecordItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1680}
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
    </div>
  );
}
