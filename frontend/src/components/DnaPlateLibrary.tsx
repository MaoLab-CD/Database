import { useEffect, useState } from "react";
import { Download, Eye, Search } from "lucide-react";
import { Drawer, Empty, Space, Spin, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  downloadPlateExport,
  fetchPlateDetail,
  fetchPlates,
  type PlateDetailResponse,
  type PlateListItem,
} from "../api/plates";
import { saveBlob } from "../utils/download";
import { formatFullDateTime, valueText } from "../utils/format";
import { DnaPlateView, formatPlateLocation } from "./DnaPlateView";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppTable,
  AppTableCard,
  EllipsisCell,
  createTablePagination,
} from "../ui";

export function DnaPlateLibrary() {
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PlateListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PlateDetailResponse | null>(null);
  const [exportingPlateCode, setExportingPlateCode] = useState<string | null>(null);

  const loadPlates = () => {
    setLoading(true);
    fetchPlates({
      keyword: keyword.trim() || undefined,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => message.error("DNA 板列表加载失败，请稍后重试"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPlates();
  }, [page, pageSize]);

  const openPlate = (plateCode: string) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    fetchPlateDetail(plateCode)
      .then(setDetail)
      .catch(() => message.error("DNA 板详情加载失败"))
      .finally(() => setDetailLoading(false));
  };

  const exportPlate = async (plateCode: string) => {
    setExportingPlateCode(plateCode);
    try {
      const blob = await downloadPlateExport(plateCode);
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:T]/g, "");
      saveBlob(blob, `DNA板_${plateCode}_${timestamp}.xlsx`);
      message.success(`DNA 板 ${plateCode} 导出已开始下载`);
    } catch {
      message.error("DNA 板样本导出失败");
    } finally {
      setExportingPlateCode(null);
    }
  };

  const columns: ColumnsType<PlateListItem> = [
    {
      title: "板号",
      dataIndex: "plate_code",
      width: 190,
      render: (value: string) => (
        <EllipsisCell value={value} copyable strong copyLabel="DNA 板号" />
      ),
    },
    {
      title: "存储位置",
      width: 260,
      ellipsis: true,
      render: (_, record) => valueText(formatPlateLocation(record)),
    },
    {
      title: "孔位占用",
      width: 110,
      render: (_, record) => (
        <strong>
          {record.occupied_count}/{record.row_count * record.column_count}
        </strong>
      ),
    },
    { title: "在库", dataIndex: "in_storage_count", width: 76 },
    { title: "已出库", dataIndex: "checked_out_count", width: 82 },
    { title: "待归还", dataIndex: "return_pending_count", width: 82 },
    { title: "不可用", dataIndex: "unavailable_count", width: 82 },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 82,
      render: (active: boolean) =>
        active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 160,
      render: formatFullDateTime,
    },
    {
      title: "操作",
      width: 176,
      render: (_, record) => (
        <Space size={4}>
          <AppButton
            tone="quiet"
            size="small"
            icon={<Eye />}
            onClick={() => openPlate(record.plate_code)}
          >
            查看
          </AppButton>
          <AppButton
            tone="quiet"
            size="small"
            icon={<Download />}
            loading={exportingPlateCode === record.plate_code}
            disabled={exportingPlateCode !== null}
            onClick={() => void exportPlate(record.plate_code)}
          >
            导出
          </AppButton>
        </Space>
      ),
    },
  ];

  return (
    <div className="dna-plate-library">
      <AppFilterCard>
        <div className="dna-plate-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索板号、冰箱、层或板架"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadPlates();
            }}
          />
          <Space>
            <AppButton
              tone="primary"
              icon={<Search />}
              onClick={() => {
                setPage(1);
                loadPlates();
              }}
            >
              查询
            </AppButton>
            <AppButton
              tone="secondary"
              onClick={() => {
                setKeyword("");
                setPage(1);
              }}
            >
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card dna-plate-table-card"
        title="DNA 板库"
        total={total}
        totalLabel="块板"
      >
        {items.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无 DNA 板数据"
          />
        ) : (
          <AppTable<PlateListItem>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            scrollX={1300}
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
        )}
      </AppTableCard>

      <Drawer
        title={detail ? `DNA 板 ${detail.plate.plate_code}` : "DNA 板详情"}
        width={980}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        <Spin spinning={detailLoading}>
          {detail ? <DnaPlateView detail={detail} /> : null}
        </Spin>
      </Drawer>
    </div>
  );
}
