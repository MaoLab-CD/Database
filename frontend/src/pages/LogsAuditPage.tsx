import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select, Space, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  fetchAuditSummary,
  fetchPrivateAccessLogs,
  type AuditSummary,
  type PrivateAccessLogItem,
  type PrivateAccessType,
} from "../api/audit";
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

const ACCESS_TYPE_OPTIONS = [
  { value: "view", label: "查看" },
  { value: "export", label: "导出" },
];

const FIELD_LABELS: Record<string, string> = {
  name: "姓名",
  id_card_no: "身份证号",
  phone: "电话",
  address: "地址",
};

function accessTypeTag(type: PrivateAccessType) {
  return type === "export" ? <Tag color="orange">导出</Tag> : <Tag color="blue">查看</Tag>;
}

function roleTag(role: string | null) {
  return role === "admin" ? <Tag color="blue">管理员</Tag> : <Tag>普通用户</Tag>;
}

function reasonText(reason: string | null) {
  const labels: Record<string, string> = {
    admin_sample_detail_view: "样本详情查看",
  };
  return reason ? labels[reason] ?? reason : "-";
}

function deviceText(value: string | null) {
  if (!value) {
    return "-";
  }
  return (
    <Tooltip title={value}>
      <span className="audit-device-cell">{value}</span>
    </Tooltip>
  );
}

export function LogsAuditPage() {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [keyword, setKeyword] = useState("");
  const [accessType, setAccessType] = useState<PrivateAccessType | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PrivateAccessLogItem[]>([]);
  const [total, setTotal] = useState(0);

  const loadSummary = () => {
    fetchAuditSummary()
      .then(setSummary)
      .catch(() => message.error("审计概览加载失败"));
  };

  const loadLogs = () => {
    setLoading(true);
    fetchPrivateAccessLogs({
      keyword: keyword.trim() || undefined,
      access_type: accessType,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => message.error("敏感信息访问日志加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, pageSize, accessType]);

  const pageFieldCount = useMemo(() => {
    return items.reduce((count, item) => count + item.viewed_fields.length, 0);
  }, [items]);

  const uniqueViewerCount = useMemo(() => {
    return new Set(items.map((item) => item.viewer_id)).size;
  }, [items]);

  const columns: ColumnsType<PrivateAccessLogItem> = [
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
    {
      title: "访问类型",
      dataIndex: "access_type",
      width: 96,
      render: accessTypeTag,
    },
    { title: "访问人", dataIndex: "viewer_name", width: 130, render: valueText },
    { title: "账号", dataIndex: "viewer_username", width: 120, render: valueText },
    {
      title: "角色",
      dataIndex: "viewer_role",
      width: 96,
      render: roleTag,
    },
    {
      title: "字段",
      dataIndex: "viewed_fields",
      width: 260,
      render: (fields: string[]) => (
        <Space wrap size={[4, 4]}>
          {fields.map((field) => (
            <Tag key={field} color="geekblue">
              {FIELD_LABELS[field] ?? field}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: "原因", dataIndex: "view_reason", width: 140, render: reasonText },
    { title: "IP", dataIndex: "ip_address", width: 126, render: valueText },
    {
      title: "设备",
      dataIndex: "device_info",
      width: 220,
      render: deviceText,
    },
    {
      title: "时间",
      dataIndex: "created_at",
      width: 160,
      render: formatFullDateTime,
    },
  ];

  return (
    <div className="logs-audit-page">
      <div className="page-toolbar">
        <div>
          <h2>隐私访问日志</h2>
          <span>共 {total} 条</span>
        </div>
      </div>

      <AppSummaryGrid
        items={[
          { key: "private_access", label: "敏感访问", value: summary?.private_access_count ?? 0 },
          { key: "page_access", label: "本页访问", value: items.length },
          { key: "page_viewers", label: "本页访问人", value: uniqueViewerCount },
          { key: "page_fields", label: "本页字段数", value: pageFieldCount },
        ]}
      />

      <AppFilterCard>
        <div className="audit-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索样本编号、访问人、账号、原因或 IP"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadLogs();
            }}
          />
          <Select
            allowClear
            placeholder="访问类型"
            options={ACCESS_TYPE_OPTIONS}
            value={accessType}
            onChange={(value) => {
              setPage(1);
              setAccessType(value);
            }}
          />
          <Space>
            <AppButton
              tone="primary"
              icon={<Search />}
              onClick={() => {
                setPage(1);
                loadLogs();
              }}
            >
              查询
            </AppButton>
            <AppButton
              tone="secondary"
              onClick={() => {
                setKeyword("");
                setAccessType(undefined);
                setPage(1);
              }}
            >
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card audit-table-card"
        title="敏感信息访问日志"
        total={total}
      >
        <AppTable<PrivateAccessLogItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1570}
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
