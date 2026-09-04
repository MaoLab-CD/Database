import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  Database,
  QrCode,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Card, Spin, Tag, message } from "antd";
import type { EChartsOption } from "echarts";

import { fetchDashboardSummary, type CountItem, type DashboardSummary } from "../api/dashboard";
import { StatCard } from "../components/StatCard";
import { STATUS_LABELS } from "../constants/status";
import { formatDateTime } from "../utils/format";
import { AppAlert } from "../ui";

const CHART_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#06b6d4", "#ef4444", "#8b5cf6", "#64748b", "#14b8a6"];
const ReactECharts = lazy(() => import("echarts-for-react"));

const STATUS_COLORS: Record<string, string> = {
  not_stored: "#64748B",
  sequencing: "#06B6D4",
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

function displayName(name: string) {
  return STATUS_LABELS[name] ?? name;
}

function statusColor(name: string) {
  return STATUS_COLORS[name] ?? CHART_COLORS[Object.keys(STATUS_COLORS).indexOf(name) % CHART_COLORS.length] ?? "#64748b";
}

function chartData(items: CountItem[]) {
  return items.map((item) => ({
    name: displayName(item.name),
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
  const names = items.map((item) => displayName(item.name));
  const values = items.map((item) => item.count);
  const hasData = values.some((value) => value > 0);
  const maxVal = Math.max(...values, 1);

  return {
    grid: { left: 12, right: 20, top: 20, bottom: 24, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#e6edf6" } },
    },
    yAxis: {
      type: "category",
      data: hasData ? names : ["暂无数据"],
      axisLabel: { color: "#334155", width: 92, overflow: "truncate" },
      axisTick: { show: false },
    },
    series: [
      {
        name: title,
        type: "bar",
        data: hasData
          ? values.map((val) => ({
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
                    { offset: Math.max(0.15, val / maxVal), color: "#6366F1" },
                    { offset: 1, color: "#8B5CF6" },
                  ],
                },
              },
            }))
          : [0],
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
        barWidth: 28,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: "#172033" },
      },
    ],
  };
}

function ActionItem({
  label,
  value,
  note,
  tone = "blue",
}: {
  label: string;
  value: number;
  note: string;
  tone?: "blue" | "amber" | "red" | "cyan";
}) {
  return (
    <div className={`dashboard-action-item dashboard-action-${tone}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{note}</small>
    </div>
  );
}

export function DashboardPage() {
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
          setError("首页统计数据暂时无法加载，请稍后重试或联系系统管理员。");
          message.error("首页统计数据加载失败");
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
    const unlinkedSamples = Math.max(0, summary.total_samples - summary.sequencing_available_count);
    return { sequencingRate, unlinkedSamples };
  }, [summary]);

  if (loading) {
    return (
      <Card className="dashboard-loading">
        <Spin />
        <span>正在加载首页概览</span>
      </Card>
    );
  }

  if (error || !summary || !derived) {
    return <AppAlert type="error" message={error || "首页统计数据不可用"} />;
  }

  return (
    <div className="dashboard-page">
      <section className="dashboard-stats-grid">
        <StatCard label="样本总数" value={summary.total_samples} note="当前系统登记样本" icon={<Database />} />
        <StatCard label="在库样本" value={summary.in_storage_count} note="当前可出库样本" icon={<ShieldCheck />} tone="green" />
        <StatCard
          label="流转中"
          value={summary.checked_out_count + summary.return_pending_count}
          note="已出库或待归还"
          icon={<QrCode />}
          tone="amber"
        />
        <StatCard label="测序数据完整" value={summary.sequencing_available_count} note="已匹配完整测序目录" icon={<Server />} tone="cyan" />
      </section>

      <section className="dashboard-main-grid">
        <Card className="dashboard-panel" title="样本库存状态" extra={<Tag color="blue">实体样本管理</Tag>}>
          <Suspense fallback={<div className="dashboard-chart-loading dashboard-chart-loading-tall">正在加载图表</div>}>
            <ReactECharts option={donutOption("样本状态", summary.sample_status_counts)} style={{ height: 340 }} />
          </Suspense>
        </Card>
        <Card className="dashboard-panel" title="测序数据状态" extra={<Tag color="cyan">完整率 {derived.sequencingRate}%</Tag>}>
          <div className="panel-hint">
            仍有 {derived.unlinkedSamples.toLocaleString()} 个样本暂无完整测序目录
          </div>
          <Suspense fallback={<div className="dashboard-chart-loading dashboard-chart-loading-tall">正在加载图表</div>}>
            <ReactECharts option={donutOption("数据状态", summary.sequencing_status_counts)} style={{ height: 320 }} />
          </Suspense>
        </Card>
      </section>

      <section className="dashboard-main-grid dashboard-bottom-grid">
        <Card className="dashboard-panel" title="待处理事项" extra={<Tag color="orange">运营状态</Tag>}>
          <div className="dashboard-action-list">
            <ActionItem
              label="归还待复核"
              value={summary.return_pending_count}
              note="需要管理员确认入库、用完、丢失或废弃"
              tone="amber"
            />
            <ActionItem
              label="测序待补充"
              value={derived.unlinkedSamples}
              note="当前样本中暂无完整测序目录"
              tone="cyan"
            />
            <ActionItem
              label="扫盘未匹配"
              value={summary.latest_scan_batch?.unmatched_count ?? 0}
              note="最近一次扫盘中未匹配样本库的目录"
              tone="amber"
            />
            <ActionItem
              label="最近导入失败"
              value={summary.latest_import_batch?.failed_rows ?? 0}
              note="最近一次 Excel / CSV 导入失败行数"
              tone={(summary.latest_import_batch?.failed_rows ?? 0) > 0 ? "red" : "blue"}
            />
          </div>
        </Card>

        <div className="dashboard-side-stack">
          <Card className="dashboard-panel dashboard-mini-panel" title="最近 Excel / CSV 导入">
            <div className="mini-summary">
              <div>
                <strong>{summary.latest_import_batch?.file_name ?? "暂无导入记录"}</strong>
                <div className="mini-tags">
                  <Tag color="green">成功 {summary.latest_import_batch?.success_rows ?? 0}</Tag>
                  <Tag color={(summary.latest_import_batch?.failed_rows ?? 0) > 0 ? "red" : "default"}>
                    失败 {summary.latest_import_batch?.failed_rows ?? 0}
                  </Tag>
                  <Tag>总计 {summary.latest_import_batch?.total_rows ?? 0}</Tag>
                </div>
                <small>{formatDateTime(summary.latest_import_batch?.uploaded_at)}</small>
              </div>
            </div>
          </Card>

          <Card className="dashboard-panel dashboard-mini-panel" title="最近测序扫盘">
            <div className="mini-summary">
              <div>
                <strong>扫描到 {summary.latest_scan_batch?.total_sample_dirs ?? 0} 个样本目录</strong>
                <div className="mini-tags">
                  <Tag color="blue">新增 {summary.latest_scan_batch?.new_count ?? 0}</Tag>
                  <Tag color="orange">未匹配 {summary.latest_scan_batch?.unmatched_count ?? 0}</Tag>
                  <Tag color={(summary.latest_scan_batch?.incomplete_count ?? 0) > 0 ? "red" : "default"}>
                    不完整 {summary.latest_scan_batch?.incomplete_count ?? 0}
                  </Tag>
                </div>
                <small>{formatDateTime(summary.latest_scan_batch?.finished_at)}</small>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="dashboard-main-grid dashboard-chart-grid">
        <Card className="dashboard-panel dashboard-chart-panel" title="民族分布">
          <Suspense fallback={<div className="dashboard-chart-loading">正在加载图表</div>}>
            <ReactECharts option={barOption("民族分布", summary.ethnicity_counts)} style={{ height: 360 }} />
          </Suspense>
        </Card>
        <Card
          className="dashboard-panel dashboard-chart-panel"
          title="最近测序扫盘"
        >
          <Suspense fallback={<div className="dashboard-chart-loading">正在加载图表</div>}>
            <ReactECharts option={scanOption(summary)} style={{ height: 260 }} />
          </Suspense>
          <div className="dashboard-chart-note">
            <span>{summary.latest_scan_batch?.scan_root_path ?? "暂无扫描目录"}</span>
            <small>{formatDateTime(summary.latest_scan_batch?.finished_at)}</small>
          </div>
        </Card>
      </section>
    </div>
  );
}
