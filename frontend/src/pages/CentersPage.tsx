import { useEffect, useMemo, useState } from "react";
import { Card, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Search } from "lucide-react";

import {
  createCenter,
  createDistrict,
  fetchCenters,
  fetchDistricts,
  fetchHospitalSeqOptions,
  updateCenter,
  type CenterItem,
  type CreateCenterPayload,
  type CreateDistrictPayload,
  type DistrictItem,
  type HospitalSeqOptions,
} from "../api/centers";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
  createTablePagination,
} from "../ui";
import { FreezerManagementPanel } from "../components/FreezerManagementPanel";
import { SpecimenTypeManagementPanel } from "../components/SpecimenTypeManagementPanel";

type CentersPageProps = {
  canManage: boolean;
};

type CenterFormValues = {
  district_code: string;
  hospital_seq: string;
  center_name: string;
  province?: string;
  region?: string;
  is_active: boolean;
};

type DistrictFormValues = {
  district_code: string;
  district_name: string;
  city_name?: string;
  province?: string;
  is_active: boolean;
};

const DEFAULT_PAGE_SIZE = 20;

function renderStatus(active: boolean) {
  return active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>;
}

function CentersManagementPanel({ canManage }: CentersPageProps) {
  const [form] = Form.useForm<CenterFormValues>();
  const [districtForm] = Form.useForm<DistrictFormValues>();
  const [keyword, setKeyword] = useState("");
  const [activeStatus, setActiveStatus] = useState<"active" | "inactive" | undefined>();
  const [districtCode, setDistrictCode] = useState<string | undefined>();
  const [districts, setDistricts] = useState<DistrictItem[]>([]);
  const [items, setItems] = useState<CenterItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [districtModalOpen, setDistrictModalOpen] = useState(false);
  const [editingCenter, setEditingCenter] = useState<CenterItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [districtSubmitting, setDistrictSubmitting] = useState(false);
  const [seqOptions, setSeqOptions] = useState<HospitalSeqOptions | null>(null);
  const [seqLoading, setSeqLoading] = useState(false);

  const districtMap = useMemo(() => {
    return new Map(districts.map((item) => [item.district_code, item]));
  }, [districts]);

  const loadDistricts = async () => {
    try {
      const rows = await fetchDistricts();
      setDistricts(rows);
    } catch {
      message.error("区县列表加载失败");
    }
  };

  const loadCenters = async () => {
    setLoading(true);
    try {
      const data = await fetchCenters({
        keyword: keyword.trim() || undefined,
        active_status: activeStatus,
        district_code: districtCode,
        page,
        page_size: pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      message.error("中心列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDistricts();
  }, []);

  useEffect(() => {
    loadCenters();
  }, [page, pageSize]);

  const handleSearch = () => {
    setPage(1);
    if (page === 1) {
      loadCenters();
    }
  };

  const handleReset = () => {
    setKeyword("");
    setActiveStatus(undefined);
    setDistrictCode(undefined);
    setPage(1);
    if (page === 1) {
      setTimeout(loadCenters, 0);
    }
  };

  const openDistrictCreate = () => {
    districtForm.resetFields();
    districtForm.setFieldsValue({
      province: "四川",
      city_name: "成都市",
      is_active: true,
    });
    setDistrictModalOpen(true);
  };

  const openCreate = () => {
    setEditingCenter(null);
    setSeqOptions(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, province: "四川" });
    setModalOpen(true);
  };

  const openEdit = (record: CenterItem) => {
    setEditingCenter(record);
    setSeqOptions(null);
    form.setFieldsValue({
      district_code: record.district_code,
      hospital_seq: record.hospital_seq,
      center_name: record.center_name,
      province: record.province || undefined,
      region: record.region || undefined,
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const loadSeqOptions = async (district_code: string) => {
    setSeqLoading(true);
    try {
      const options = await fetchHospitalSeqOptions(district_code);
      setSeqOptions(options);
      if (!editingCenter && options.next_seq) {
        form.setFieldsValue({ hospital_seq: options.next_seq });
      }
    } catch {
      setSeqOptions(null);
      message.error("医院序号加载失败");
    } finally {
      setSeqLoading(false);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingCenter) {
        await updateCenter(editingCenter.id, {
          center_name: values.center_name,
          province: values.province,
          region: values.region,
          is_active: values.is_active,
        });
        message.success("中心已更新");
      } else {
        const payload: CreateCenterPayload = {
          district_code: values.district_code,
          hospital_seq: values.hospital_seq,
          center_name: values.center_name,
          province: values.province,
          region: values.region,
          is_active: values.is_active,
        };
        await createCenter(payload);
        message.success("中心已新增");
      }
      setModalOpen(false);
      loadCenters();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      message.error(typeof detail === "string" ? detail : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDistrictSubmit = async () => {
    const values = await districtForm.validateFields();
    setDistrictSubmitting(true);
    try {
      const payload: CreateDistrictPayload = {
        district_code: values.district_code,
        district_name: values.district_name,
        city_name: values.city_name,
        province: values.province,
        is_active: values.is_active,
      };
      const district = await createDistrict(payload);
      message.success("区县已新增");
      setDistrictModalOpen(false);
      await loadDistricts();
      setDistrictCode(district.district_code);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      message.error(typeof detail === "string" ? detail : "保存失败");
    } finally {
      setDistrictSubmitting(false);
    }
  };

  const columns: ColumnsType<CenterItem> = [
    {
      title: "中心编码",
      dataIndex: "center_code",
      key: "center_code",
      width: 160,
      render: (value: string) => <strong>{value}</strong>,
    },
    {
      title: "中心名称",
      dataIndex: "center_name",
      key: "center_name",
      width: 260,
    },
    {
      title: "区县",
      dataIndex: "district_name",
      key: "district_name",
      width: 160,
      render: (_: string, record: CenterItem) => (
        <span>{record.district_code} {record.district_name || "-"}</span>
      ),
    },
    {
      title: "医院序号",
      dataIndex: "hospital_seq",
      key: "hospital_seq",
      width: 110,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      key: "is_active",
      width: 100,
      render: renderStatus,
    },
    {
      title: "操作",
      key: "action",
      width: 110,
      fixed: "right" as const,
      render: (_: unknown, record: CenterItem) => (
        canManage ? (
          <AppButton tone="quiet" size="small" onClick={() => openEdit(record)}>
            编辑
          </AppButton>
        ) : (
          <span className="muted-text">-</span>
        )
      ),
    },
  ];

  return (
    <div className="centers-management-panel">
      <div className="page-toolbar">
        <div>
          <h2>中心管理</h2>
          <span>共 {total} 个中心</span>
        </div>
        {canManage ? (
          <Space>
            <AppButton tone="secondary" icon={<Plus />} onClick={openDistrictCreate}>
              新增区县
            </AppButton>
            <AppButton tone="primary" icon={<Plus />} onClick={openCreate}>
              新增中心
            </AppButton>
          </Space>
        ) : null}
      </div>

      <AppSummaryGrid
        className="users-summary-grid"
        items={[
          { key: "active", label: "启用中心", value: items.filter((item) => item.is_active).length },
          { key: "districts", label: "区县数量", value: districts.length },
          { key: "inactive", label: "停用中心", value: items.filter((item) => !item.is_active).length },
        ]}
      />

      <AppFilterCard>
        <div className="samples-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索中心编码或名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={handleSearch}
          />
          <Select
            allowClear
            placeholder="区县"
            value={districtCode}
            onChange={setDistrictCode}
            options={districts.map((item) => ({
              value: item.district_code,
              label: `${item.district_code} ${item.district_name}`,
            }))}
          />
          <Select
            allowClear
            placeholder="状态"
            value={activeStatus}
            onChange={setActiveStatus}
            options={[
              { value: "active", label: "启用" },
              { value: "inactive", label: "停用" },
            ]}
          />
          <Space>
            <AppButton tone="primary" icon={<Search />} onClick={handleSearch}>
              查询
            </AppButton>
            <AppButton tone="secondary" onClick={handleReset}>
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card users-table-card"
        title="中心列表"
        total={total}
        totalLabel="个中心"
      >
        <AppTable<CenterItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1180}
          pagination={createTablePagination({
            page,
            pageSize,
            total,
            unit: "个中心",
            showQuickJumper: false,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          })}
        />
      </AppTableCard>

      <Modal
        title="新增区县"
        open={districtModalOpen}
        onCancel={() => setDistrictModalOpen(false)}
        onOk={handleDistrictSubmit}
        okText="保存"
        cancelText="取消"
        confirmLoading={districtSubmitting}
        destroyOnClose
      >
        <Form form={districtForm} layout="vertical" className="users-form">
          <Space size={12} className="centers-form-row">
            <Form.Item
              name="province"
              label="省份"
              rules={[{ required: true, message: "请输入省份" }]}
            >
              <Input placeholder="四川" />
            </Form.Item>
            <Form.Item
              name="city_name"
              label="城市"
              rules={[{ required: true, message: "请输入城市" }]}
            >
              <Input placeholder="成都市" />
            </Form.Item>
          </Space>

          <Form.Item
            name="district_code"
            label="区县编码"
            rules={[
              { required: true, message: "请输入区县编码" },
              { pattern: /^\d{6}$/, message: "请输入 6 位行政区划编码" },
            ]}
          >
            <Input placeholder="如 510105" maxLength={6} />
          </Form.Item>

          <Form.Item
            name="district_name"
            label="区县名称"
            rules={[{ required: true, message: "请输入区县名称" }]}
          >
            <Input placeholder="如 青羊区" />
          </Form.Item>

          <Form.Item name="is_active" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingCenter ? "编辑中心" : "新增中心"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="users-form">
          <Form.Item
            name="district_code"
            label="区县"
            rules={[{ required: true, message: "请选择区县" }]}
          >
            <Select
              disabled={Boolean(editingCenter)}
              placeholder="选择区县"
              options={districts.map((item) => ({
                value: item.district_code,
                label: `${item.district_code} ${item.district_name}`,
              }))}
              onChange={(value) => {
                const district = districtMap.get(value);
                form.setFieldsValue({
                  province: district?.province || "四川",
                  region: district?.district_name,
                  hospital_seq: undefined,
                });
                setSeqOptions(null);
                if (value) {
                  loadSeqOptions(value);
                }
              }}
            />
          </Form.Item>

          <Form.Item
            name="hospital_seq"
            label="医院序号"
            rules={[
              { required: true, message: "请输入医院序号" },
              { pattern: /^\d{3}$/, message: "请输入 3 位数字，如 001" },
              {
                validator: async (_, value) => {
                  if (editingCenter || !value || !seqOptions?.used.includes(value)) {
                    return;
                  }
                  throw new Error(`该区县序号 ${value} 已被占用`);
                },
              },
            ]}
            extra={
              editingCenter
                ? undefined
                : seqLoading
                  ? "正在读取该区县已用序号"
                  : seqOptions
                    ? seqOptions.used.length
                      ? `已占用：${seqOptions.used.join("、")}；建议使用：${seqOptions.next_seq || "无可用序号"}`
                      : `该区县暂无已占用序号；建议使用：${seqOptions.next_seq || "001"}`
                    : "选择区县后自动推荐下一个可用序号"
            }
          >
            <Input disabled={Boolean(editingCenter) || seqLoading} placeholder="001" maxLength={3} />
          </Form.Item>

          <Form.Item label="中心编码" shouldUpdate>
            {() => {
              const values = form.getFieldsValue();
              const value = editingCenter?.center_code ||
                (values.district_code && values.hospital_seq
                  ? `${values.district_code}-${values.hospital_seq}`
                  : "保存后生成");
              return <Input disabled value={value} />;
            }}
          </Form.Item>

          <Form.Item
            name="center_name"
            label="中心名称"
            rules={[{ required: true, message: "请输入中心名称" }]}
          >
            <Input placeholder="如 青羊区草堂社区卫生服务中心" />
          </Form.Item>

          <Space size={12} className="centers-form-row">
            <Form.Item name="province" label="省份">
              <Input placeholder="四川" />
            </Form.Item>
            <Form.Item name="region" label="区域">
              <Input placeholder="青羊区" />
            </Form.Item>
          </Space>

          <Form.Item name="is_active" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function CentersPage({ canManage }: CentersPageProps) {
  const [activeTab, setActiveTab] = useState<"centers" | "freezers" | "specimen-types">("centers");

  return (
    <div className="centers-page">
      <Card className="excel-import-tabs-card">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "centers" | "freezers" | "specimen-types")}
          items={[
            { key: "centers", label: "中心与区县" },
            { key: "freezers", label: "冰箱管理" },
            { key: "specimen-types", label: "样本类型管理" },
          ]}
        />
      </Card>

      {activeTab === "centers" ? (
        <CentersManagementPanel canManage={canManage} />
      ) : activeTab === "freezers" ? (
        <FreezerManagementPanel canManage={canManage} />
      ) : (
        <SpecimenTypeManagementPanel canManage={canManage} />
      )}
    </div>
  );
}
