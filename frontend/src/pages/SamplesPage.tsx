import { useEffect, useState } from "react";
import { Download, Eye, EyeOff, Search } from "lucide-react";
import { Drawer, Select, Space, Spin, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { LoginResult } from "../api/auth";
import { fetchCenters } from "../api/centers";
import { fetchSpecimenTypes } from "../api/specimenTypes";
import {
  fetchSamplePrivateInfo,
  fetchSampleDetail,
  fetchSamples,
  downloadSamplesExport,
  type SampleDetail,
  type SampleListItem,
  type SamplePrivateInfo,
} from "../api/samples";
import {
  SAMPLE_STATUS_OPTIONS,
  SEQUENCING_STATUS_OPTIONS,
  statusTag,
} from "../constants/status";
import {
  LabResultOverview,
  OrganoidInfoDescriptions,
  SampleBaseDescriptions,
  SensitiveInfoDescriptions,
} from "../components/SampleDescriptions";
import { SampleDocumentsPanel } from "../components/SampleDocumentsPanel";
import { DnaPlateLibrary } from "../components/DnaPlateLibrary";
import { saveBlob } from "../utils/download";
import { formatFullDateTime, valueText } from "../utils/format";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppTable,
  AppTableCard,
  EllipsisCell,
  createTablePagination,
} from "../ui";

type SamplesPageProps = {
  currentUser: LoginResult;
};

export function SamplesPage({ currentUser }: SamplesPageProps) {
  const [activeSection, setActiveSection] = useState<"samples" | "dna-plates">("samples");
  const [keyword, setKeyword] = useState("");
  const [centerCode, setCenterCode] = useState<string | undefined>();
  const [centerOptions, setCenterOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [specimenType, setSpecimenType] = useState<string | undefined>();
  const [specimenTypeOptions, setSpecimenTypeOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [sampleStatus, setSampleStatus] = useState<string | undefined>();
  const [sequencingStatus, setSequencingStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SampleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [privateInfo, setPrivateInfo] = useState<SamplePrivateInfo | null>(null);
  const [privateInfoLoading, setPrivateInfoLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const currentFilters = {
    keyword: keyword.trim() || undefined,
    center_code: centerCode,
    specimen_type: specimenType,
    sample_status: sampleStatus,
    sequencing_status: sequencingStatus,
  };

  const loadSamples = () => {
    setLoading(true);
    fetchSamples({
      ...currentFilters,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        message.error("样本列表加载失败");
      })
      .finally(() => setLoading(false));
  };

  const exportSamples = async () => {
    setExporting(true);
    try {
      const blob = await downloadSamplesExport(currentFilters);
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:T]/g, "");
      saveBlob(blob, `样本导出_${timestamp}.xlsx`);
      message.success("样本导出已开始下载");
    } catch {
      message.error("样本导出失败");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadSamples();
  }, [page, pageSize, centerCode, specimenType, sampleStatus, sequencingStatus]);

  useEffect(() => {
    fetchCenters({ page: 1, page_size: 100 })
      .then((data) => setCenterOptions(data.items.map((center) => ({
        value: center.center_code,
        label: `${center.center_name}（${center.center_code}）`,
      }))))
      .catch(() => setCenterOptions([]));

    fetchSpecimenTypes(false)
      .then((rows) => setSpecimenTypeOptions(rows.map((item) => ({
        value: item.name,
        label: item.is_active ? item.name : `${item.name}（已停用）`,
      }))))
      .catch(() => setSpecimenTypeOptions([]));
  }, []);

  const openDetail = (sampleKey: string) => {
    setDetailOpen(true);
    setPrivateInfo(null);
    setDetailLoading(true);
    fetchSampleDetail(sampleKey)
      .then(setDetail)
      .catch(() => message.error("样本详情加载失败"))
      .finally(() => setDetailLoading(false));
  };

  const loadPrivateInfo = () => {
    const sampleKey = String(sample.sample_code || sample.sample_id || "");
    if (!sampleKey) {
      return;
    }

    setPrivateInfoLoading(true);
    fetchSamplePrivateInfo(sampleKey)
      .then((data) => {
        setPrivateInfo(data);
        message.success("敏感信息已解密显示，并已记录审计日志");
      })
      .catch(() => message.error("敏感信息加载失败"))
      .finally(() => setPrivateInfoLoading(false));
  };

  const columns: ColumnsType<SampleListItem> = [
    {
      title: "样本编码",
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
    {
      title: "原始序号",
      dataIndex: "sample_id",
      width: 90,
      render: valueText,
    },
    {
      title: "样本中心",
      dataIndex: "center_name",
      width: 180,
      render: (value: string | null, record) => (
        <EllipsisCell value={value ? `${value}（${record.center_code || "-"}）` : record.center_code} />
      ),
    },
    { title: "条码号", dataIndex: "barcode_no", width: 140, ellipsis: true, render: valueText },
    { title: "病人号", dataIndex: "patient_no", width: 150, ellipsis: true, render: valueText },
    { title: "就诊类型", dataIndex: "visit_type", width: 90, render: valueText },
    { title: "民族", dataIndex: "ethnicity", width: 80, render: valueText },
    { title: "性别", dataIndex: "sex", width: 64, render: valueText },
    { title: "年龄", dataIndex: "age", width: 72, render: valueText },
    { title: "科室", dataIndex: "department", width: 130, ellipsis: true, render: valueText },
    {
      title: "样本类型",
      dataIndex: "specimen_type",
      width: 86,
      render: (value: string | null) =>
        value === "DNA" ? <Tag color="purple">DNA</Tag> : valueText(value),
    },
    { title: "冰箱位置", dataIndex: "storage_location", width: 150, ellipsis: true, render: valueText },
    {
      title: "样本状态",
      dataIndex: "sample_status",
      width: 104,
      render: (value: string) => statusTag(value, "sample"),
    },
    {
      title: "数据状态",
      dataIndex: "sequencing_status",
      width: 104,
      render: (value: string) => statusTag(value, "sequencing"),
    },
    {
      title: "采集时间",
      dataIndex: "collection_time",
      width: 145,
      render: formatFullDateTime,
    },
    {
      title: "操作",
      width: 76,
      render: (_, record) => (
        <AppButton
          tone="quiet"
          size="small"
          icon={<Eye />}
          onClick={() => openDetail(record.sample_code || record.sample_id)}
        >
          详情
        </AppButton>
      ),
    },
  ];

  const sample = detail?.sample ?? {};

  return (
    <div className="samples-page">
      <Tabs
        className="samples-section-tabs"
        activeKey={activeSection}
        onChange={(key) => setActiveSection(key as "samples" | "dna-plates")}
        items={[
          { key: "samples", label: "样本列表" },
          { key: "dna-plates", label: "DNA 板库" },
        ]}
      />

      {activeSection === "samples" ? (
        <>
          <AppFilterCard>
            <div className="samples-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索样本编码、原始序号、条码号、病人号、就诊类型、民族、科室"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadSamples();
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="样本中心"
            options={centerOptions}
            value={centerCode}
            onChange={(value) => {
              setPage(1);
              setCenterCode(value);
            }}
          />
          <Select
            allowClear
            placeholder="样本类型"
            options={specimenTypeOptions}
            value={specimenType}
            onChange={(value) => {
              setPage(1);
              setSpecimenType(value);
            }}
          />
          <Select
            allowClear
            placeholder="样本状态"
            options={SAMPLE_STATUS_OPTIONS}
            value={sampleStatus}
            onChange={(value) => {
              setPage(1);
              setSampleStatus(value);
            }}
          />
          <Select
            allowClear
            placeholder="数据状态"
            options={SEQUENCING_STATUS_OPTIONS}
            value={sequencingStatus}
            onChange={(value) => {
              setPage(1);
              setSequencingStatus(value);
            }}
          />
          <Space>
            <AppButton
              tone="primary"
              icon={<Search />}
              onClick={() => {
                setPage(1);
                loadSamples();
              }}
            >
              查询
            </AppButton>
            <AppButton
              tone="secondary"
              onClick={() => {
                setKeyword("");
                setCenterCode(undefined);
                setSpecimenType(undefined);
                setSampleStatus(undefined);
                setSequencingStatus(undefined);
                setPage(1);
              }}
            >
              重置
            </AppButton>
            <AppButton
              tone="secondary"
              icon={<Download />}
              loading={exporting}
              onClick={exportSamples}
            >
              导出
            </AppButton>
          </Space>
            </div>
          </AppFilterCard>

          <AppTableCard
            className="samples-table-card"
            title="样本列表"
            total={total}
          >
            <AppTable<SampleListItem>
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={items}
              scrollX={1910}
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
        </>
      ) : (
        <DnaPlateLibrary />
      )}

      <Drawer
        title={`样本详情 ${valueText(sample.sample_code || sample.sample_id)}`}
        width={720}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setPrivateInfo(null);
        }}
      >
        <Spin spinning={detailLoading}>
          <div className="sample-detail">
            <SampleBaseDescriptions
              sample={sample}
              extra={
                currentUser.role === "admin" ? (
                  <AppButton
                    tone={privateInfo ? "secondary" : "primary"}
                    size="small"
                    icon={privateInfo ? <Eye /> : <EyeOff />}
                    loading={privateInfoLoading}
                    onClick={loadPrivateInfo}
                  >
                    {privateInfo ? "重新查看敏感信息" : "查看敏感信息"}
                  </AppButton>
                ) : null
              }
            />

            <OrganoidInfoDescriptions
              sample={sample}
              visibleData={detail?.visible_data ?? {}}
            />

            {currentUser.role === "admin" && sample.specimen_type === "类器官" && sample.id ? (
              <SampleDocumentsPanel samplePk={Number(sample.id)} />
            ) : null}

            {privateInfo ? <SensitiveInfoDescriptions privateInfo={privateInfo} /> : null}

            <LabResultOverview labResults={detail?.lab_results ?? {}} />
          </div>
        </Spin>
      </Drawer>
    </div>
  );
}
