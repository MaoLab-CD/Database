import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Eye,
} from "lucide-react";
import {
  Card,
  DatePicker,
  Form,
  InputNumber,
  Select,
  Tabs,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import * as XLSX from "xlsx";

import {
  fetchCenters,
  fetchDistricts,
  fetchSampleSerialSuggestion,
  type CenterItem,
  type DistrictItem,
  type SampleSerialSuggestion,
} from "../api/centers";
import { AppButton, EllipsisCell } from "../ui";
import { ExcelBatchCodePanel } from "../components/ExcelBatchCodePanel";
import { fetchSpecimenTypes, type SpecimenTypeItem } from "../api/specimenTypes";

type CodeRow = {
  key: number;
  sample_code: string;
  qr_content: string;
  sample_type: string;
  district_code: string;
  district_name: string;
  hospital_seq: string;
  center_code: string;
  center_name: string;
  code_date: string;
  serial_no: string;
  sample_seq: string;
};

type BatchFormValues = {
  district_code: string;
  center_code: string;
  sample_type: string;
  code_date: any;
  start_serial: number;
  count: number;
};

const MAX_SERIAL = 9999;

function exportExcel(rows: CodeRow[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "sample_code",
      "qr_content",
      "sample_type",
      "district_code",
      "district_name",
      "hospital_seq",
      "center_code",
      "center_name",
      "code_date",
      "serial_no",
      "sample_seq",
    ],
  });

  sheet["!cols"] = [
    { wch: 28 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
  ];

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "编码清单");
  XLSX.writeFile(book, `批量打码_${ts}.xlsx`);
}

export function BatchCodePage() {
  const [mode, setMode] = useState<"manual" | "excel">("manual");
  const [form] = Form.useForm<BatchFormValues>();
  const [districts, setDistricts] = useState<DistrictItem[]>([]);
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [districtsError, setDistrictsError] = useState(false);
  const [centersLoading, setCentersLoading] = useState(false);
  const [specimenTypes, setSpecimenTypes] = useState<SpecimenTypeItem[]>([]);
  const [specimenTypesLoading, setSpecimenTypesLoading] = useState(false);
  const [generatedRows, setGeneratedRows] = useState<CodeRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [serialSuggestion, setSerialSuggestion] = useState<SampleSerialSuggestion | null>(null);
  const [serialSuggestionLoading, setSerialSuggestionLoading] = useState(false);

  const districtMap = useMemo(
    () => new Map(districts.map((d) => [d.district_code, d])),
    [districts],
  );
  const centerMap = useMemo(
    () => new Map(centers.map((c) => [c.center_code, c])),
    [centers],
  );
  const specimenTypeMap = useMemo(
    () => new Map(specimenTypes.map((item) => [item.name, item])),
    [specimenTypes],
  );
  const specimenTypeOptions = useMemo(
    () => specimenTypes.map((item) => ({
      value: item.name,
      label: item.code_suffix === ""
        ? `${item.name}（无后缀）`
        : `${item.name}（后缀 ${item.code_suffix}）`,
    })),
    [specimenTypes],
  );

  const loadDistricts = async () => {
    setDistrictsLoading(true);
    setDistrictsError(false);
    try {
      const data = await fetchDistricts();
      setDistricts(data);
    } catch {
      setDistrictsError(true);
    } finally {
      setDistrictsLoading(false);
    }
  };

  useEffect(() => {
    loadDistricts();
    setSpecimenTypesLoading(true);
    fetchSpecimenTypes(true, true)
      .then(setSpecimenTypes)
      .catch(() => message.error("批量打码样本类型加载失败"))
      .finally(() => setSpecimenTypesLoading(false));
  }, []);

  const loadCenters = async (districtCode: string) => {
    setCentersLoading(true);
    try {
      const result = await fetchCenters({
        active_status: "active",
        district_code: districtCode,
        page_size: 100,
      });
      setCenters(result.items);
    } catch {
      setCenters([]);
      message.error("中心列表加载失败");
    } finally {
      setCentersLoading(false);
    }
  };

  const handleDistrictChange = (districtCode: string) => {
    form.setFieldsValue({ center_code: undefined });
    setCenters([]);
    setGeneratedRows([]);
    setSerialSuggestion(null);
    if (districtCode) {
      loadCenters(districtCode);
    }
  };

  const handleCenterChange = () => {
    setGeneratedRows([]);
  };

  const handleGenerate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;

    const { district_code, center_code, sample_type, code_date, start_serial, count } = values;

    const district = districtMap.get(district_code);
    if (!district) {
      message.error("区县不存在");
      return;
    }

    const center = centerMap.get(center_code);
    if (!center) {
      message.error("中心不存在");
      return;
    }
    const specimenType = specimenTypeMap.get(sample_type);
    if (!specimenType || !specimenType.code_rule_confirmed || specimenType.code_suffix == null) {
      message.error("该样本类型的编码规则未确认");
      return;
    }

    const endSerial = start_serial + count - 1;
    if (endSerial > MAX_SERIAL) {
      message.error(`起始编号 ${start_serial} + 数量 ${count} 超过最大编号 ${MAX_SERIAL}，请调整`);
      return;
    }

    setGenerating(true);

    const dateStr = code_date.format("YYMMDD");
    const displayDate = code_date.format("YYYY-MM-DD");
    const rows: CodeRow[] = [];

    for (let i = 0; i < count; i++) {
      const serial = String(start_serial + i).padStart(4, "0");
      const sampleSeq = `${dateStr}${serial}`;
      const suffix = specimenType.code_suffix;
      const finalSampleSeq = `${sampleSeq}${suffix}`;
      const sampleCode = `${center_code}-${finalSampleSeq}`;

      rows.push({
        key: i,
        sample_code: sampleCode,
        qr_content: sampleCode,
        sample_type,
        district_code,
        district_name: district.district_name,
        hospital_seq: center.hospital_seq,
        center_code,
        center_name: center.center_name,
        code_date: displayDate,
        serial_no: serial,
        sample_seq: finalSampleSeq,
      });
    }

    setGeneratedRows(rows);
    setGenerating(false);
    message.success(`已生成 ${count} 条编码`);
  };

  const handleReset = () => {
    form.resetFields();
    setGeneratedRows([]);
    setCenters([]);
  };

  const handleExport = () => {
    if (generatedRows.length === 0) {
      message.warning("请先生成编码");
      return;
    }
    exportExcel(generatedRows);
    message.success("导出成功");
  };

  const columns: ColumnsType<CodeRow> = [
    {
      title: "样本编码",
      dataIndex: "sample_code",
      key: "sample_code",
      width: 260,
      render: (value: string) => (
        <EllipsisCell value={value} copyable strong copyLabel="样本编码" />
      ),
    },
    {
      title: "样本类型",
      dataIndex: "sample_type",
      key: "sample_type",
      width: 90,
    },
    {
      title: "中心编码",
      dataIndex: "center_code",
      key: "center_code",
      width: 130,
    },
    {
      title: "中心名称",
      dataIndex: "center_name",
      key: "center_name",
      width: 200,
    },
    {
      title: "编码日期",
      dataIndex: "code_date",
      key: "code_date",
      width: 120,
    },
    {
      title: "编号",
      dataIndex: "serial_no",
      key: "serial_no",
      width: 80,
    },
    {
      title: "完整编号",
      dataIndex: "sample_seq",
      key: "sample_seq",
      width: 140,
      render: (v: string) => <span style={{ fontFamily: "monospace" }}>{v}</span>,
    },
  ];

  const centerOptions = centers.map((c) => ({
    value: c.center_code,
    label: c.center_name,
  }));

  const districtCode = Form.useWatch("district_code", form);
  const selectedCenterCode = Form.useWatch("center_code", form);
  const codeDate = Form.useWatch("code_date", form);
  const codeDateKey = codeDate?.format ? codeDate.format("YYYY-MM-DD") : undefined;
  const startSerial = Form.useWatch("start_serial", form);
  const count = Form.useWatch("count", form);
  const endSerial = startSerial && count ? startSerial + count - 1 : undefined;
  const overflow =
    endSerial != null && endSerial > MAX_SERIAL;

  useEffect(() => {
    if (!selectedCenterCode || !codeDateKey) {
      setSerialSuggestion(null);
      return;
    }

    let ignore = false;
    setSerialSuggestionLoading(true);
    fetchSampleSerialSuggestion(selectedCenterCode, codeDateKey)
      .then((data) => {
        if (ignore) return;
        setSerialSuggestion(data);
        if (data.next_serial) {
          form.setFieldsValue({ start_serial: data.next_serial });
        }
      })
      .catch(() => {
        if (ignore) return;
        setSerialSuggestion(null);
        message.warning("起始编号建议加载失败，请手动确认");
      })
      .finally(() => {
        if (!ignore) setSerialSuggestionLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedCenterCode, codeDateKey, form]);

  return (
    <div className="batch-code-page">
      <div className="page-toolbar">
        <div>
          <h2>批量打码</h2>
          <span>生成样本编码清单，供外部标签打印软件使用</span>
        </div>
      </div>

      <Card className="excel-import-tabs-card">
        <Tabs
          activeKey={mode}
          onChange={(value) => setMode(value as "manual" | "excel")}
          items={[
            { key: "manual", label: "按日期生成" },
            { key: "excel", label: "Excel 按采集时间补码" },
          ]}
        />
      </Card>

      {mode === "excel" ? (
        <ExcelBatchCodePanel
          districts={districts}
          centers={centers}
          districtsLoading={districtsLoading}
          centersLoading={centersLoading}
          specimenTypes={specimenTypes}
          onDistrictChange={handleDistrictChange}
        />
      ) : (
      <>
      <Card className="samples-filter-card">
        <div className="batch-code-hint">
          请确认起始编号，避免重复打印。同一天同医院补打时，请从上次结束编号后一位开始。
          编码不落库占号，仅作为贴标清单导出工具。
        </div>

        <Form
          form={form}
          className="batch-code-form"
          initialValues={{ sample_type: "全血" }}
          onFinish={handleGenerate}
        >
          <div className="batch-code-form-row">
            <Form.Item
              name="district_code"
              label="区县"
              rules={[{ required: true, message: "请选择区县" }]}
            >
              <Select
                loading={districtsLoading}
                placeholder={districtsError ? "加载失败，点击重试" : "选择区县"}
                notFoundContent={districtsError ? <span style={{ color: "#ff4d4f" }}>加载失败，<a onClick={() => loadDistricts()}>点击重试</a></span> : null}
                options={districts.map((d) => ({
                  value: d.district_code,
                  label: `${d.district_code} ${d.district_name}`,
                }))}
                onChange={handleDistrictChange}
                onClick={() => {
                  if (districtsError) loadDistricts();
                }}
              />
            </Form.Item>

            <Form.Item
              name="center_code"
              label="医院"
              rules={[{ required: true, message: "请选择医院" }]}
            >
              <Select
                loading={centersLoading}
                disabled={!districtCode || centersLoading}
                placeholder={districtCode ? "选择医院" : "请先选择区县"}
                options={centerOptions}
                onChange={handleCenterChange}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>

            <Form.Item
              name="sample_type"
              label="样本类型"
              rules={[{ required: true, message: "请选择样本类型" }]}
            >
              <Select
                loading={specimenTypesLoading}
                options={specimenTypeOptions}
                onChange={() => setGeneratedRows([])}
              />
            </Form.Item>

            <Form.Item
              name="code_date"
              label="日期"
              rules={[{ required: true, message: "请选择日期" }]}
            >
              <DatePicker
                placeholder="编码日期"
                format="YYYY-MM-DD"
                onChange={() => setGeneratedRows([])}
              />
            </Form.Item>

            <Form.Item
              name="start_serial"
              label="起始编号"
              rules={[
                { required: true, message: "请输入起始编号" },
                {
                  validator: (_, value) => {
                    if (value == null || value < 1) return Promise.reject(new Error("起始编号不小于 1"));
                    if (value > MAX_SERIAL) return Promise.reject(new Error(`最大编号 ${MAX_SERIAL}`));
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                min={1}
                max={MAX_SERIAL}
                placeholder="0001"
                controls={false}
                parser={(v) => (v ? parseInt(v, 10) : null as unknown as number)}
              />
            </Form.Item>

            <Form.Item
              name="count"
              label="数量"
              rules={[
                { required: true, message: "请输入数量" },
                { type: "number", min: 1, max: 1000, message: "数量范围 1-1000" },
              ]}
            >
              <InputNumber
                min={1}
                max={1000}
                placeholder="100"
                controls={false}
              />
            </Form.Item>
          </div>

          <div className="batch-code-form-actions">
            <Space>
              <AppButton
                tone="primary"
                icon={<Eye />}
                loading={generating}
                htmlType="submit"
              >
                生成预览
              </AppButton>
              <AppButton
                tone="secondary"
                onClick={handleReset}
              >
                重置
              </AppButton>
            </Space>
            {endSerial != null && !overflow ? (
              <span className="batch-code-range">
                编码范围：
                <strong className="mono">{startSerial?.toString().padStart(4, "0")}</strong>
                ～
                <strong className="mono">{endSerial.toString().padStart(4, "0")}</strong>
                ，共 <strong>{count}</strong> 条
              </span>
            ) : null}
            {serialSuggestion ? (
              <span className="batch-code-suggestion">
                {serialSuggestion.used_count > 0 ? (
                  <>
                    该中心当天库内已有 <strong>{serialSuggestion.used_count}</strong> 条，
                    最大编号 <strong className="mono">{serialSuggestion.max_serial.toString().padStart(4, "0")}</strong>，
                    建议从 <strong className="mono">{serialSuggestion.next_serial?.toString().padStart(4, "0") ?? "-"}</strong> 开始
                  </>
                ) : (
                  <>该中心当天库内暂无样本，建议从 <strong className="mono">0001</strong> 开始</>
                )}
              </span>
            ) : serialSuggestionLoading ? (
              <span className="batch-code-suggestion">正在查询库内已有编号...</span>
            ) : null}
          </div>

          {overflow ? (
            <div className="batch-code-warning">
              <AlertTriangle size={14} />
              起始 {startSerial} + 数量 {count} = 结束编号 {endSerial}，超过最大编号 {MAX_SERIAL}，请减少数量或调整起始编号。
            </div>
          ) : null}
        </Form>
      </Card>

      {generatedRows.length > 0 ? (
        <Card
          className="samples-table-card"
          title="编码预览"
          extra={
            <Space>
              <Tag color="blue">{generatedRows.length} 条</Tag>
              <AppButton
                tone="primary"
                size="small"
                icon={<Download />}
                onClick={handleExport}
              >
                导出 Excel
              </AppButton>
            </Space>
          }
        >
          <Table<CodeRow>
            rowKey="key"
            columns={columns}
            dataSource={generatedRows}
            pagination={false}
            scroll={{ x: 1000, y: 420 }}
            size="small"
          />
        </Card>
      ) : (
        <Card className="samples-table-card">
          <div className="empty-preview">
            <span>选择区县、医院、日期和数量后，点击「生成预览」</span>
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
