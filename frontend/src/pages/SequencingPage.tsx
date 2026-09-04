import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import {
  Card,
  Descriptions,
  Drawer,
  Form,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Input,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import {
  downloadSequencingRecordsExport,
  fetchSequencingRecordDetail,
  fetchSequencingRecords,
  fetchSequencingScanBatches,
  testRemoteSequencingConnection,
  triggerLocalSequencingScan,
  triggerRemoteSequencingScan,
  type ScanBatchItem,
  type SequencingRecordDetail,
  type SequencingRecordItem,
} from "../api/sequencing";
import { fetchCenters } from "../api/centers";
import { fetchAppConfig } from "../api/config";
import type { LoginResult } from "../api/auth";
import {
  GenomeStatusDescriptions,
  hasGenomeStatus,
} from "../features/sequencing/GenomeStatusDescriptions";
import { SEQUENCING_STATUS_OPTIONS, statusTag } from "../constants/status";
import { formatBytes, formatFullDateTime, valueText } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";
import { saveBlob } from "../utils/download";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppTable,
  AppTableCard,
  EllipsisCell,
  createTablePagination,
} from "../ui";

function scanStatusTag(status: string) {
  const colorMap: Record<string, string> = {
    running: "processing",
    completed: "green",
    confirmed: "blue",
    failed: "red",
  };
  const labelMap: Record<string, string> = {
    running: "运行中",
    completed: "已完成",
    confirmed: "已确认",
    failed: "失败",
  };
  return <Tag color={colorMap[status] ?? "default"}>{labelMap[status] ?? status}</Tag>;
}

type ScanFormValues = {
  root_path: string;
  scan_mode: "incremental" | "full";
  projects?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  backend_path?: string;
  python_command?: string;
};

type StoredScanConfig = Partial<ScanFormValues> & {
  scan_type?: "local" | "remote";
};

const SCAN_CONFIG_STORAGE_KEY = "sample_admin_sequencing_scan_config";

const DEFAULT_SCAN_CONFIG: ScanFormValues = {
  root_path: "/data/sequencing",
  scan_mode: "incremental",
  port: 22,
  backend_path: "/opt/sample-scan",
  python_command: "python",
};

function normalizePythonCommand(value?: string) {
  const command = (value ?? "").trim();
  if (
    !command ||
    command === "python" ||
    command === "python3" ||
    command === "source ~/.bashrc && conda activate rui01 && python"
  ) {
    return DEFAULT_SCAN_CONFIG.python_command;
  }
  return command;
}

function loadStoredScanConfig(): StoredScanConfig {
  const stored = localStorage.getItem(SCAN_CONFIG_STORAGE_KEY);
  if (!stored) {
    return {};
  }
  try {
    const parsed = JSON.parse(stored) as StoredScanConfig;
    parsed.python_command = normalizePythonCommand(parsed.python_command);
    return parsed;
  } catch {
    localStorage.removeItem(SCAN_CONFIG_STORAGE_KEY);
    return {};
  }
}

function saveStoredScanConfig(scanType: "local" | "remote", values: Partial<ScanFormValues>) {
  localStorage.setItem(
    SCAN_CONFIG_STORAGE_KEY,
    JSON.stringify({
      scan_type: scanType,
      root_path: values.root_path,
      scan_mode: values.scan_mode,
      projects: values.projects,
      host: values.host,
      port: values.port,
      username: values.username,
      backend_path: values.backend_path,
      python_command: values.python_command,
    }),
  );
}

function parseProjectText(value?: string) {
  return (value ?? "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SequencingPage({ currentUser }: { currentUser: LoginResult }) {
  const [scanForm] = Form.useForm<ScanFormValues>();
  const [storedScanConfig] = useState<StoredScanConfig>(() => loadStoredScanConfig());
  const [keyword, setKeyword] = useState("");
  const [dataStatus, setDataStatus] = useState<string | undefined>();
  const [centerCode, setCenterCode] = useState<string | undefined>();
  const [centerOptions, setCenterOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SequencingRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [batches, setBatches] = useState<ScanBatchItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SequencingRecordDetail | null>(null);
  const [scanType, setScanType] = useState<"local" | "remote">(storedScanConfig.scan_type ?? "local");
  const [sshEnabled, setSshEnabled] = useState(true);
  const [sequencingRoot, setSequencingRoot] = useState("/data/sequencing");
  const [sequencingNasRoot, setSequencingNasRoot] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testingSsh, setTestingSsh] = useState(false);
  const [exporting, setExporting] = useState(false);

  const latestBatch = batches[0];
  const canTriggerScan = currentUser.role === "admin";

  const currentFilters = {
    keyword: keyword.trim() || undefined,
    data_status: dataStatus,
    center_code: centerCode,
  };

  const loadRecords = () => {
    setLoading(true);
    fetchSequencingRecords({
      ...currentFilters,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
        setTotalSizeBytes(data.total_size_bytes);
      })
      .catch(() => message.error("测序数据列表加载失败"))
      .finally(() => setLoading(false));
  };

  const loadBatches = () => {
    setBatchLoading(true);
    fetchSequencingScanBatches(5)
      .then(setBatches)
      .catch(() => message.error("测序扫描批次加载失败"))
      .finally(() => setBatchLoading(false));
  };

  useEffect(() => {
    loadRecords();
  }, [page, pageSize, dataStatus, centerCode]);

  useEffect(() => {
    loadBatches();
    fetchCenters({ page: 1, page_size: 100 })
      .then((data) => setCenterOptions(data.items.map((center) => ({
        value: center.center_code,
        label: `${center.center_name}（${center.center_code}）`,
      }))))
      .catch(() => setCenterOptions([]));
  }, []);

  useEffect(() => {
    fetchAppConfig()
      .then((config) => {
        setSshEnabled(config.sequencing_ssh_enabled);
        setSequencingRoot(config.sequencing_root || "/data/sequencing");
        setSequencingNasRoot(config.sequencing_nas_root || null);
        if (!config.sequencing_ssh_enabled && scanType === "remote") {
          setScanType("local");
          saveStoredScanConfig("local", scanForm.getFieldsValue());
        }
        if (config.sequencing_root && !storedScanConfig.root_path) {
          scanForm.setFieldValue("root_path", config.sequencing_root);
        }
      })
      .catch(() => {
        setSshEnabled(true);
      });
  }, []);

  useEffect(() => {
    const currentCommand = scanForm.getFieldValue("python_command");
    const normalizedCommand = normalizePythonCommand(currentCommand);
    if (currentCommand !== normalizedCommand) {
      scanForm.setFieldValue("python_command", normalizedCommand);
      saveStoredScanConfig(scanType, { ...scanForm.getFieldsValue(), python_command: normalizedCommand });
    }
  }, [scanForm, scanType]);

  const openDetail = (recordId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    fetchSequencingRecordDetail(recordId)
      .then(setDetail)
      .catch(() => message.error("测序数据详情加载失败"))
      .finally(() => setDetailLoading(false));
  };

  const exportRecords = async () => {
    setExporting(true);
    try {
      const blob = await downloadSequencingRecordsExport(currentFilters);
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      saveBlob(blob, `测序数据导出_${timestamp}.xlsx`);
      message.success("测序数据导出已开始下载");
    } catch {
      message.error("测序数据导出失败");
    } finally {
      setExporting(false);
    }
  };

  const triggerScan = async () => {
    const values = await scanForm.validateFields();
    const projects = parseProjectText(values.projects);
    setScanning(true);
    try {
      if (scanType === "local") {
        const result = await triggerLocalSequencingScan({
          root_path: values.root_path,
          scan_mode: values.scan_mode,
          projects,
        });
        message.success(result.message);
      } else {
        const result = await triggerRemoteSequencingScan({
          host: values.host ?? "",
          port: values.port ?? 22,
          username: values.username ?? "",
          password: values.password || undefined,
          backend_path: values.backend_path ?? "/opt/sample-scan/backend",
          root_path: values.root_path,
          scan_mode: values.scan_mode,
          projects,
          python_command: normalizePythonCommand(values.python_command),
        });
        message.success(result.message);
      }
      setPage(1);
      loadRecords();
      loadBatches();
    } catch (error) {
      message.error(getApiErrorMessage(error, "测序扫描失败"));
    } finally {
      setScanning(false);
    }
  };

  const testSshConnection = async () => {
    const values = await scanForm.validateFields(["host", "port", "username", "password", "backend_path", "root_path", "scan_mode"]);
    setTestingSsh(true);
    try {
      const result = await testRemoteSequencingConnection({
        host: values.host ?? "",
        port: values.port ?? 22,
        username: values.username ?? "",
        password: values.password || undefined,
        backend_path: values.backend_path ?? "/opt/sample-scan/backend",
        root_path: values.root_path,
        scan_mode: values.scan_mode,
        projects: parseProjectText(values.projects),
        python_command: normalizePythonCommand(values.python_command),
      });
      if (result.ok) {
        message.success(result.message);
      } else {
        message.error(result.output ? `${result.message}：${result.output}` : result.message);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, "SSH 连接测试失败"));
    } finally {
      setTestingSsh(false);
    }
  };

  const columns: ColumnsType<SequencingRecordItem> = [
    {
      title: "样本编码",
      dataIndex: "sample_code",
      width: 220,
      render: (value: string | null, record) => (
        <div className="sequencing-sample-cell">
          <EllipsisCell
            value={value}
            copyable={Boolean(value)}
            strong
            copyLabel="样本编码"
          />
          {record.data_status === "unmatched" ? <Tag color="gold" style={{ marginLeft: 6 }}>未匹配</Tag> : null}
        </div>
      ),
    },
    {
      title: "原始序号",
      dataIndex: "sample_id",
      width: 100,
      render: (value: string) => valueText(value),
    },
    {
      title: "项目编号",
      dataIndex: "project_code",
      width: 220,
      render: (value: string) => <EllipsisCell value={value} />,
    },
    {
      title: "样本中心",
      dataIndex: "center_name",
      width: 180,
      render: (value: string | null, record) => (
        <EllipsisCell value={value ? `${value}（${record.center_code || "-"}）` : record.center_code} />
      ),
    },
    {
      title: "测序公司",
      dataIndex: "sequencing_company",
      width: 120,
      render: (value: string | null) => valueText(value),
    },
    {
      title: "平台",
      dataIndex: "sequencing_platform",
      width: 100,
      render: (value: string | null) => valueText(value),
    },
    {
      title: "仪器",
      dataIndex: "sequencing_instrument",
      width: 130,
      render: (value: string | null) => valueText(value),
    },
    {
      title: "回库时间",
      dataIndex: "sequencing_returned_at",
      width: 145,
      render: formatFullDateTime,
    },
    {
      title: "深度",
      dataIndex: "sequencing_depth",
      width: 80,
    },
    {
      title: "QC",
      dataIndex: "genome_qc",
      width: 70,
      render: (value: string | null) => {
        if (!value) return "-";
        const color =
          value === "合格" ? "green" : value === "不合格" ? "red" : "default";
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: "最终状态",
      dataIndex: "final_status",
      width: 90,
      render: (value: string | null) => {
        if (!value) return "-";
        const color = value === "可用" ? "green" : "orange";
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: "不可用原因",
      dataIndex: "missing_reason",
      width: 130,
      render: (value: string | null) => valueText(value),
    },
    {
      title: "RawData 路径",
      dataIndex: "raw_data_path",
      ellipsis: true,
      render: (value: string) => <EllipsisCell value={value} className="path-cell" />,
    },
    {
      title: "R1",
      dataIndex: "r1_file_name",
      width: 150,
      ellipsis: true,
      render: (value: string | null) => <EllipsisCell value={value} />,
    },
    {
      title: "R2",
      dataIndex: "r2_file_name",
      width: 150,
      ellipsis: true,
      render: (value: string | null) => <EllipsisCell value={value} />,
    },
    {
      title: "总大小",
      dataIndex: "total_size_bytes",
      width: 96,
      render: formatBytes,
    },
    {
      title: "状态",
      dataIndex: "data_status",
      width: 106,
      render: (value: string) => statusTag(value, "sequencing"),
    },
    {
      title: "最近扫描",
      dataIndex: "last_scanned_at",
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
          onClick={() => openDetail(record.id)}
        >
          详情
        </AppButton>
      ),
    },
  ];

  const record = detail?.record ?? {};
  const scanBatch = detail?.scan_batch ?? {};
  const genomeStatus = (record.genome_status ?? {}) as Record<string, unknown>;
  const md5Values =
    record.md5_values && typeof record.md5_values === "object"
      ? Object.entries(record.md5_values as Record<string, unknown>)
      : [];

  return (
    <div className="sequencing-page">
      <section className="sequencing-summary-grid">
        <Card className="sequencing-summary-card">
          <div>
            <span>测序目录</span>
            <strong>{total.toLocaleString()}</strong>
            <small>已入库测序目录</small>
          </div>
        </Card>
        <Card className="sequencing-summary-card">
          <div>
            <span>最近扫描目录</span>
            <strong>{latestBatch?.total_sample_dirs ?? 0}</strong>
            <small>{latestBatch?.scan_root_path ?? "暂无扫描记录"}</small>
          </div>
        </Card>
        <Card className="sequencing-summary-card">
          <div>
            <span>新增 / 未匹配</span>
            <strong>{latestBatch ? `${latestBatch.new_count} / ${latestBatch.unmatched_count}` : "0 / 0"}</strong>
            <small>{latestBatch ? formatFullDateTime(latestBatch.finished_at) : "暂无扫描时间"}</small>
          </div>
        </Card>
        <Card className="sequencing-summary-card">
          <div>
            <span>总文件大小</span>
            <strong>{formatBytes(totalSizeBytes)}</strong>
            <small>当前筛选结果中 R1 与 R2 的总量</small>
          </div>
        </Card>
      </section>

      {canTriggerScan ? (
        <Card className="sequencing-scan-card" title="手动测序扫盘">
          <Form<ScanFormValues>
            form={scanForm}
            layout="vertical"
            initialValues={{ ...DEFAULT_SCAN_CONFIG, ...storedScanConfig }}
            onValuesChange={(_, values) => saveStoredScanConfig(scanType, values)}
          >
            {sshEnabled ? (
              <Tabs
                activeKey={scanType}
                onChange={(key) => {
                  const nextScanType = key as "local" | "remote";
                  setScanType(nextScanType);
                  saveStoredScanConfig(nextScanType, scanForm.getFieldsValue());
                }}
                items={[
                  { key: "local", label: "本地路径扫描" },
                  { key: "remote", label: "SSH 远程扫描" },
                ]}
              />
            ) : null}
            <div className="sequencing-scan-form">
              {scanType === "remote" ? (
                <>
                  <Form.Item
                    label="SSH 主机"
                    name="host"
                    rules={[{ required: true, message: "请填写 SSH 主机" }]}
                  >
                    <AppInput placeholder="例如 VPN 内网地址或服务器域名" disabled={scanning} />
                  </Form.Item>
                  <Form.Item
                    label="端口"
                    name="port"
                    rules={[{ required: true, message: "请填写 SSH 端口" }]}
                  >
                    <InputNumber min={1} max={65535} disabled={scanning} />
                  </Form.Item>
                  <Form.Item
                    label="用户名"
                    name="username"
                    rules={[{ required: true, message: "请填写 SSH 用户名" }]}
                  >
                    <AppInput placeholder="例如 ryuan" disabled={scanning} />
                  </Form.Item>
                  <Form.Item label="密码" name="password">
                    <Input.Password placeholder="仅本次使用，不会保存" disabled={scanning} />
                  </Form.Item>
                  <Form.Item
                    label="远程脚本根目录"
                    name="backend_path"
                    rules={[{ required: true, message: "请填写远程脚本根目录" }]}
                  >
                    <AppInput placeholder="/opt/sample-scan" disabled={scanning} />
                  </Form.Item>
                </>
              ) : null}
              <Form.Item
                label="测序根目录"
                name="root_path"
                rules={[{ required: true, message: "请填写测序根目录" }]}
              >
                <AppInput placeholder={sequencingRoot} disabled={scanning} />
              </Form.Item>
              {scanType === "local" ? (
                <div className="sequencing-root-shortcuts">
                  <span>快捷选择：</span>
                  <Space wrap>
                    <AppButton
                      tone="quiet"
                      size="small"
                      disabled={scanning}
                      onClick={() => scanForm.setFieldValue("root_path", sequencingRoot)}
                    >
                      H100 测序目录
                    </AppButton>
                    {sequencingNasRoot ? (
                      <AppButton
                        tone="quiet"
                        size="small"
                        disabled={scanning}
                        onClick={() => scanForm.setFieldValue("root_path", sequencingNasRoot)}
                      >
                        NAS 历史测序目录
                      </AppButton>
                    ) : null}
                  </Space>
                </div>
              ) : null}
              <Form.Item label="扫描模式" name="scan_mode" hidden>
                <Radio.Group>
                  <Radio.Button value="incremental">常规扫描</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item label="指定项目目录" name="projects">
                <AppInput placeholder="可选，多个项目用逗号或换行分隔" disabled={scanning} />
              </Form.Item>
              {scanType === "remote" ? (
                <Form.Item label="Python 命令" name="python_command">
                  <AppInput placeholder="python" disabled={scanning} />
                </Form.Item>
              ) : null}
            </div>
            <div className="sequencing-scan-actions">
              <div />
              <Space>
                <AppButton
                  tone="quiet"
                  disabled={scanning || testingSsh}
                  onClick={() => {
                    localStorage.removeItem(SCAN_CONFIG_STORAGE_KEY);
                    scanForm.setFieldsValue(DEFAULT_SCAN_CONFIG);
                    setScanType("local");
                    message.success("已清除保存的扫描配置");
                  }}
                >
                  清除保存配置
                </AppButton>
                {scanType === "remote" ? (
                  <AppButton
                    tone="secondary"
                    loading={testingSsh}
                    disabled={scanning}
                    onClick={() => void testSshConnection()}
                  >
                    测试 SSH 连接
                  </AppButton>
                ) : null}
                <AppButton
                  tone="primary"
                  loading={scanning}
                  disabled={testingSsh}
                  onClick={() => void triggerScan()}
                >
                  开始扫描
                </AppButton>
              </Space>
            </div>
          </Form>
        </Card>
      ) : null}

      <AppFilterCard>
        <div className="sequencing-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索样本编码、原始序号、项目编号、RawData 路径、R1/R2 文件名"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadRecords();
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
            placeholder="数据状态"
            options={SEQUENCING_STATUS_OPTIONS}
            value={dataStatus}
            onChange={(value) => {
              setPage(1);
              setDataStatus(value);
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
                setDataStatus(undefined);
                setCenterCode(undefined);
                setPage(1);
              }}
            >
              重置
            </AppButton>
            <AppButton
              tone="secondary"
              icon={<Download />}
              loading={exporting}
              onClick={() => void exportRecords()}
            >
              导出
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <section className="sequencing-content-grid">
        <AppTableCard
          className="samples-table-card sequencing-table-card"
          title="测序目录"
          total={total}
        >
          <AppTable<SequencingRecordItem>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            tableLayout="fixed"
            scrollX={2170}
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

        <Card className="sequencing-batch-card" title="最近扫描批次" loading={batchLoading}>
          <div className="scan-batch-list">
            {batches.length > 0 ? (
              batches.map((batch) => (
                <div className="scan-batch-item" key={batch.id}>
                  <div>
                    <strong>批次 #{batch.id}</strong>
                    {scanStatusTag(batch.status)}
                  </div>
                  <Typography.Text ellipsis>{batch.scan_root_path}</Typography.Text>
                  <small>
                    目录 {batch.total_sample_dirs}，新增 {batch.new_count}，未匹配 {batch.unmatched_count}
                  </small>
                  <small>{formatFullDateTime(batch.finished_at)}</small>
                </div>
              ))
            ) : (
              <div className="empty-small">暂无扫描批次</div>
            )}
          </div>
        </Card>
      </section>

      <Drawer
        title={`测序数据详情 ${valueText(record.sample_code || record.sample_id)}`}
        width={760}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        <Spin spinning={detailLoading}>
          <div className="sample-detail">
            <Descriptions title="目录信息" column={2} bordered size="small">
              <Descriptions.Item label="样本编码">{valueText(record.sample_code)}</Descriptions.Item>
              <Descriptions.Item label="原始序号">{valueText(record.sample_id)}</Descriptions.Item>
              <Descriptions.Item label="项目编号">{valueText(record.project_code)}</Descriptions.Item>
              <Descriptions.Item label="数据状态">{statusTag(String(record.data_status ?? ""), "sequencing")}</Descriptions.Item>
              <Descriptions.Item label="扫描批次">#{valueText(record.scan_batch_id)}</Descriptions.Item>
              <Descriptions.Item label="数据根目录" span={2}>{valueText(record.data_root_path)}</Descriptions.Item>
              <Descriptions.Item label="RawData 路径" span={2}>{valueText(record.raw_data_path)}</Descriptions.Item>
              <Descriptions.Item label="R1 文件">{valueText(record.r1_file_name)}</Descriptions.Item>
              <Descriptions.Item label="R2 文件">{valueText(record.r2_file_name)}</Descriptions.Item>
              <Descriptions.Item label="MD5 文件">{valueText(record.md5_file_name)}</Descriptions.Item>
              <Descriptions.Item label="总大小">{formatBytes(record.total_size_bytes)}</Descriptions.Item>
              <Descriptions.Item label="最近扫描">{formatFullDateTime(record.last_scanned_at)}</Descriptions.Item>
              <Descriptions.Item label="文件修改">{formatFullDateTime(record.file_modified_at)}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{valueText(record.note)}</Descriptions.Item>
            </Descriptions>

            {hasGenomeStatus(genomeStatus) ? (
              <Card className="detail-sub-card" title="基因组状态">
                <GenomeStatusDescriptions status={genomeStatus} />
              </Card>
            ) : null}

            <Card className="detail-sub-card" title="MD5 解析结果">
              {md5Values.length > 0 ? (
                <div className="md5-list">
                  {md5Values.map(([fileName, md5]) => (
                    <div className="md5-item" key={fileName}>
                      <span>{fileName}</span>
                      <code>{valueText(md5)}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-small">暂无 MD5 解析结果</div>
              )}
            </Card>

            {detail?.scan_batch ? (
              <Descriptions title="扫描批次" column={2} bordered size="small">
                <Descriptions.Item label="批次编号">#{valueText(scanBatch.id)}</Descriptions.Item>
                <Descriptions.Item label="状态">{scanStatusTag(String(scanBatch.status ?? ""))}</Descriptions.Item>
                <Descriptions.Item label="扫描根目录" span={2}>{valueText(scanBatch.scan_root_path)}</Descriptions.Item>
                <Descriptions.Item label="项目数">{valueText(scanBatch.total_projects)}</Descriptions.Item>
                <Descriptions.Item label="样本目录">{valueText(scanBatch.total_sample_dirs)}</Descriptions.Item>
                <Descriptions.Item label="新增">{valueText(scanBatch.new_count)}</Descriptions.Item>
                <Descriptions.Item label="未匹配">{valueText(scanBatch.unmatched_count)}</Descriptions.Item>
                <Descriptions.Item label="完成时间">{formatFullDateTime(scanBatch.finished_at)}</Descriptions.Item>
                <Descriptions.Item label="错误信息">{valueText(scanBatch.error_message)}</Descriptions.Item>
              </Descriptions>
            ) : null}
          </div>
        </Spin>
      </Drawer>
    </div>
  );
}
