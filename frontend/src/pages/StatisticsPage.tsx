import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import {
  BarChart3,
  Database,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Card, Spin, Tag, message } from "antd";
import type { EChartsOption } from "echarts";

import { fetchDashboardSummary, type CountItem, type DashboardSummary } from "../api/dashboard";
import { STATUS_LABELS } from "../constants/status";
import { formatDateTime } from "../utils/format";
import { AppAlert } from "../ui";

const CHART_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#06b6d4", "#ef4444", "#8b5cf6", "#64748b", "#14b8a6"];

const STATUS_COLORS: Record<string, string> = {
  in_storage: "#3B82F6",
  checked_out: "#F59E0B",
  return_pending: "#EF4444",
  consumed: "#8B5CF6",
  lost: "#94A3B8",
  discarded: "#DC2626",
  archived: "#64748B",
  pending: "#06B6D4",
  available: "#10B981",
  incomplete: "#F59E0B",
  changed: "#3B82F6",
  missing: "#EF4444",
  unmatched: "#94A3B8",
};

function statusColor(name: string) {
  return STATUS_COLORS[name] ?? CHART_COLORS[Object.keys(STATUS_COLORS).indexOf(name) % CHART_COLORS.length] ?? "#64748b";
}

function statusName(name: string) {
  return STATUS_LABELS[name] ?? name;
}

function chartData(items: CountItem[]) {
  return items.map((item) => ({
    name: statusName(item.name),
    value: item.count,
  }));
}

function donutOption(title: string, items: CountItem[]): EChartsOption {
  const data = chartData(items);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = items.map((item) => statusColor(item.name));
  return {
    color: colors,
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: {
      type: "scroll",
      bottom: 0,
      left: "center",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: "#475569", fontSize: 12 },
    },
    graphic: {
      type: "text",
      left: "center",
      top: "36%",
      style: {
        text: total.toLocaleString(),
        fill: "#172033",
        fontSize: 26,
        fontWeight: "bold" as const,
      },
    } as EChartsOption["graphic"],
    series: [
      {
        name: title,
        type: "pie",
        radius: ["48%", "70%"],
        center: ["50%", "43%"],
        avoidLabelOverlap: true,
        label: { formatter: "{b}\n{d}%", color: "#334155" },
        labelLine: { length: 10, length2: 8 },
        data,
      },
    ],
  };
}

function barOption(title: string, items: CountItem[]): EChartsOption {
  const names = items.map((item) => statusName(item.name));
  const values = items.map((item) => item.count);
  const maxVal = Math.max(...values, 1);
  return {
    grid: { left: 12, right: 20, top: 20, bottom: 20, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#e6edf6" } },
    },
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { color: "#334155", width: 90, overflow: "truncate" },
      axisTick: { show: false },
    },
    series: [
      {
        name: title,
        type: "bar",
        data: values.map((val) => ({
          value: val,
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: "#3B82F6" },
                { offset: val / maxVal, color: "#6366F1" },
                { offset: 1, color: "#8B5CF6" },
              ],
            },
          },
        })),
        barWidth: 14,
        label: { show: true, position: "right", color: "#172033" },
      },
    ],
  };
}

function scanOption(summary: DashboardSummary): EChartsOption {
  const batch = summary.latest_scan_batch;
  const items = [
    { name: "新增", value: batch?.new_count ?? 0 },
    { name: "未匹配", value: batch?.unmatched_count ?? 0 },
    { name: "不完整", value: batch?.incomplete_count ?? 0 },
  ];
  return {
    color: ["#2563eb", "#f59e0b", "#ef4444"],
    grid: { left: 12, right: 20, top: 20, bottom: 24, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: items.map((item) => item.name),
      axisLabel: { color: "#334155" },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#e6edf6" } },
    },
    series: [
      {
        name: "最近扫盘",
        type: "bar",
        data: items.map((item) => item.value),
        barWidth: 30,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: "#172033" },
      },
    ],
  };
}

function MetricTile({
  label,
  value,
  note,
  icon,
  tone = "blue",
}: {
  label: string;
  value: number | string;
  note: string;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "cyan";
}) {
  return (
    <Card className={`stats-metric stats-metric-${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
        <em>{note}</em>
      </div>
    </Card>
  );
}

export function StatisticsPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchDashboardSummary()
      .then((data) => {
        if (mounted) {
          setSummary(data);
          setError("");
        }
      })
      .catch(() => {
        if (mounted) {
          setError("统计数据暂时无法加载，请稍后重试或联系系统管理员。");
          message.error("统计数据加载失败");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const derived = useMemo(() => {
    if (!summary) {
      return null;
    }
    const sequencingRate =
      summary.total_samples > 0
        ? Math.round((summary.sequencing_available_count / summary.total_samples) * 1000) / 10
        : 0;
    const storageRate =
      summary.total_samples > 0
        ? Math.round((summary.in_storage_count / summary.total_samples) * 1000) / 10
        : 0;
    return { sequencingRate, storageRate };
  }, [summary]);

  if (loading) {
    return (
      <Card className="dashboard-loading">
        <Spin />
        <span>正在加载统计图表</span>
      </Card>
    );
  }

  if (error || !summary || !derived) {
    return <AppAlert type="error" message={error || "统计数据不可用"} />;
  }

  return (
    <div className="statistics-page">
      <section className="stats-metric-grid">
        <MetricTile label="样本总数" value={summary.total_samples} note="当前系统登记样本" icon={<Database />} />
        <MetricTile
          label="在库比例"
          value={`${derived.storageRate}%`}
          note={`${summary.in_storage_count.toLocaleString()} 个样本可出库`}
          icon={<ShieldCheck />}
          tone="green"
        />
        <MetricTile
          label="测序完整率"
          value={`${derived.sequencingRate}%`}
          note={`${summary.sequencing_available_count.toLocaleString()} 个样本数据完整`}
          icon={<Server />}
          tone="cyan"
        />
        <MetricTile
          label="流转与异常"
          value={summary.unavailable_count}
          note="出库、待归还、用完、丢失、废弃"
          icon={<BarChart3 />}
          tone="amber"
        />
      </section>

      <section className="stats-chart-grid">
        <Card className="stats-chart-card" title="样本库存结构">
          <ReactECharts option={donutOption("样本状态", summary.sample_status_counts)} style={{ height: 360 }} />
        </Card>
        <Card className="stats-chart-card" title="测序数据结构">
          <ReactECharts option={donutOption("数据状态", summary.sequencing_status_counts)} style={{ height: 360 }} />
        </Card>
      </section>

      <section className="stats-wide-grid">
        <Card className="stats-chart-card" title="民族分布">
          <ReactECharts option={barOption("民族分布", summary.ethnicity_counts)} style={{ height: 380 }} />
        </Card>
        <Card className="stats-chart-card" title="最近测序扫盘">
          <ReactECharts option={scanOption(summary)} style={{ height: 280 }} />
          <div className="stats-card-note">
            <Tag color={summary.latest_scan_batch?.status === "completed" ? "green" : "default"}>
              {summary.latest_scan_batch?.status ?? "暂无"}
            </Tag>
            <span>{summary.latest_scan_batch?.scan_root_path ?? "暂无扫描目录"}</span>
            <small>{formatDateTime(summary.latest_scan_batch?.finished_at)}</small>
          </div>
        </Card>
      </section>

      <section>
        <Card className="stats-chart-card" title="最近 Excel / CSV 导入">
          <div className="stats-import-summary">
            <strong>{summary.latest_import_batch?.file_name ?? "暂无导入记录"}</strong>
            <p>
              成功 {summary.latest_import_batch?.success_rows ?? 0} 行，失败{" "}
              {summary.latest_import_batch?.failed_rows ?? 0} 行，总计 {summary.latest_import_batch?.total_rows ?? 0} 行
            </p>
            <small>{formatDateTime(summary.latest_import_batch?.uploaded_at)}</small>
          </div>
        </Card>
      </section>
    </div>
  );
}
