import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Search } from "lucide-react";

import {
  createFreezer,
  fetchFreezers,
  updateFreezer,
  type FreezerItem,
  type FreezerPayload,
} from "../api/freezers";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
} from "../ui";

type FreezerManagementPanelProps = {
  canManage: boolean;
};

type FreezerFormValues = {
  freezer_code: string;
  temperature_c: number;
  is_active: boolean;
};

export function FreezerManagementPanel({
  canManage,
}: FreezerManagementPanelProps) {
  const [form] = Form.useForm<FreezerFormValues>();
  const [items, setItems] = useState<FreezerItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [activeStatus, setActiveStatus] = useState<
    "active" | "inactive" | undefined
  >();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFreezer, setEditingFreezer] = useState<FreezerItem | null>(null);

  const loadFreezers = async () => {
    setLoading(true);
    try {
      setItems(await fetchFreezers(false));
    } catch {
      message.error("冰箱列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFreezers();
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (activeStatus === "active" && !item.is_active) return false;
      if (activeStatus === "inactive" && item.is_active) return false;
      if (!normalizedKeyword) return true;
      return (
        item.freezer_code.toLowerCase().includes(normalizedKeyword) ||
        item.display_name.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [activeStatus, items, keyword]);

  const openCreate = () => {
    setEditingFreezer(null);
    form.resetFields();
    form.setFieldsValue({
      temperature_c: -40,
      is_active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (record: FreezerItem) => {
    setEditingFreezer(record);
    form.setFieldsValue({
      freezer_code: record.freezer_code,
      temperature_c: record.temperature_c,
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload: FreezerPayload = {
      freezer_code: values.freezer_code.trim().toUpperCase(),
      temperature_c: values.temperature_c,
      is_active: values.is_active,
    };
    setSubmitting(true);
    try {
      if (editingFreezer) {
        await updateFreezer(editingFreezer.id, payload);
        message.success("冰箱已更新");
      } else {
        await createFreezer(payload);
        message.success("冰箱已新增");
      }
      setModalOpen(false);
      await loadFreezers();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      message.error(typeof detail === "string" ? detail : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<FreezerItem> = [
    {
      title: "冰箱编号",
      dataIndex: "freezer_code",
      width: 180,
      render: (value: string) => <strong>{value}</strong>,
    },
    {
      title: "温度",
      dataIndex: "temperature_c",
      width: 140,
      render: (value: number) => `${value} °C`,
    },
    {
      title: "导入显示",
      dataIndex: "display_name",
      width: 260,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 100,
      render: (active: boolean) =>
        active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "操作",
      key: "action",
      width: 110,
      fixed: "right",
      render: (_: unknown, record: FreezerItem) =>
        canManage ? (
          <AppButton tone="quiet" size="small" onClick={() => openEdit(record)}>
            编辑
          </AppButton>
        ) : (
          <span className="muted-text">-</span>
        ),
    },
  ];

  return (
    <div className="freezers-panel">
      <div className="page-toolbar">
        <div>
          <h2>冰箱管理</h2>
          <span>共 {items.length} 个冰箱</span>
        </div>
        {canManage ? (
          <AppButton tone="primary" icon={<Plus />} onClick={openCreate}>
            新增冰箱
          </AppButton>
        ) : null}
      </div>

      <AppSummaryGrid
        className="users-summary-grid"
        items={[
          {
            key: "total",
            label: "冰箱总数",
            value: items.length,
          },
          {
            key: "active",
            label: "启用冰箱",
            value: items.filter((item) => item.is_active).length,
          },
          {
            key: "inactive",
            label: "停用冰箱",
            value: items.filter((item) => !item.is_active).length,
          },
        ]}
      />

      <AppFilterCard>
        <div className="samples-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索冰箱编号或温度"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
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
          <AppButton
            tone="secondary"
            onClick={() => {
              setKeyword("");
              setActiveStatus(undefined);
            }}
          >
            重置
          </AppButton>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card users-table-card"
        title="冰箱列表"
        total={filteredItems.length}
        totalLabel="台冰箱"
      >
        <AppTable<FreezerItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          scrollX={900}
          pagination={false}
        />
      </AppTableCard>

      <Modal
        title={editingFreezer ? "编辑冰箱" : "新增冰箱"}
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
            name="freezer_code"
            label="冰箱编号"
            rules={[
              { required: true, message: "请输入冰箱编号" },
              {
                pattern: /^\d{3}-\d{2}$/,
                message: "请输入三位-两位编号，如 448-03",
              },
            ]}
          >
            <Input placeholder="如 448-03" maxLength={6} />
          </Form.Item>

          <Form.Item
            name="temperature_c"
            label="温度（°C）"
            rules={[{ required: true, message: "请输入温度" }]}
          >
            <InputNumber min={-196} max={100} step={1} precision={1} />
          </Form.Item>

          <Form.Item label="下拉框显示" shouldUpdate>
            {() => {
              const values = form.getFieldsValue();
              const code = values.freezer_code?.trim().toUpperCase();
              const temperature = values.temperature_c;
              const label =
                code && typeof temperature === "number"
                  ? `${code} ${temperature} °C`
                  : "填写编号和温度后生成";
              return <Input disabled value={label} />;
            }}
          </Form.Item>

          <Form.Item name="is_active" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
