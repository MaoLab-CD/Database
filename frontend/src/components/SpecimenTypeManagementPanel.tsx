import { useEffect, useMemo, useState } from "react";
import { Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Search } from "lucide-react";

import {
  createSpecimenType,
  fetchSpecimenTypes,
  updateSpecimenType,
  type SpecimenTypeItem,
} from "../api/specimenTypes";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
} from "../ui";

type Props = { canManage: boolean };

type FormValues = {
  name: string;
  is_active: boolean;
  allow_batch_code: boolean;
  uses_plate_wells: boolean;
  code_suffix?: string;
  code_rule_confirmed: boolean;
  sort_order: number;
  note?: string;
};

export function SpecimenTypeManagementPanel({ canManage }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [items, setItems] = useState<SpecimenTypeItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [activeStatus, setActiveStatus] = useState<"active" | "inactive">();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpecimenTypeItem | null>(null);
  const codeRuleConfirmed = Form.useWatch("code_rule_confirmed", form);
  const watchedTypeName = Form.useWatch("name", form);
  const isBaseType = (editing?.name || watchedTypeName) === "全血";
  const codeRuleLocked = Boolean(editing?.code_rule_locked);

  const loadItems = async () => {
    setLoading(true);
    try {
      setItems(await fetchSpecimenTypes(false));
    } catch {
      message.error("样本类型列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (activeStatus === "active" && !item.is_active) return false;
      if (activeStatus === "inactive" && item.is_active) return false;
      return !normalized || item.name.toLowerCase().includes(normalized) ||
        (item.note || "").toLowerCase().includes(normalized);
    });
  }, [activeStatus, items, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      is_active: true,
      allow_batch_code: false,
      uses_plate_wells: false,
      code_rule_confirmed: false,
      sort_order: (items[items.length - 1]?.sort_order || 0) + 10,
    });
    setModalOpen(true);
  };

  const openEdit = (item: SpecimenTypeItem) => {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      is_active: item.is_active,
      allow_batch_code: item.allow_batch_code,
      uses_plate_wells: item.uses_plate_wells,
      code_suffix: item.code_suffix ?? undefined,
      code_rule_confirmed: item.code_rule_confirmed,
      sort_order: item.sort_order,
      note: item.note || undefined,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const common = {
        is_active: values.is_active,
        allow_batch_code: values.allow_batch_code,
        uses_plate_wells: values.uses_plate_wells,
        code_suffix: values.code_rule_confirmed
          ? (isBaseType ? "" : (values.code_suffix || "").trim())
          : null,
        code_rule_confirmed: values.code_rule_confirmed,
        sort_order: values.sort_order,
        note: values.note?.trim() || null,
      };
      if (editing) {
        await updateSpecimenType(editing.id, common);
        message.success("样本类型已更新");
      } else {
        await createSpecimenType({ name: values.name.trim(), ...common });
        message.success("样本类型已新增");
      }
      setModalOpen(false);
      await loadItems();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      message.error(typeof detail === "string" ? detail : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<SpecimenTypeItem> = [
    { title: "样本类型", dataIndex: "name", width: 180, render: (value) => <strong>{value}</strong> },
    { title: "排序", dataIndex: "sort_order", width: 90 },
    {
      title: "编码规则",
      key: "code_rule",
      width: 190,
      render: (_, item) => item.code_rule_confirmed ? (
        <Space size={6}>
          <Tag color="green">已确认</Tag>
          <span>{item.code_suffix === "" ? "无后缀" : `后缀 ${item.code_suffix}`}</span>
        </Space>
      ) : <Tag>未确认</Tag>,
    },
    {
      title: "批量打码",
      dataIndex: "allow_batch_code",
      width: 120,
      render: (value) => value ? <Tag color="blue">参与</Tag> : <Tag>不参与</Tag>,
    },
    {
      title: "板孔管理",
      dataIndex: "uses_plate_wells",
      width: 120,
      render: (value) => value ? <Tag color="purple">使用</Tag> : <Tag>不使用</Tag>,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 100,
      render: (value) => value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    { title: "样本数", dataIndex: "sample_count", width: 90 },
    { title: "备注", dataIndex: "note", ellipsis: true, render: (value) => value || "-" },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, item) => canManage ? (
        <AppButton tone="quiet" size="small" onClick={() => openEdit(item)}>编辑</AppButton>
      ) : "-",
    },
  ];

  return <div className="specimen-types-panel">
    <div className="page-toolbar">
      <div><h2>样本类型管理</h2><span>共 {items.length} 个类型</span></div>
      {canManage && <AppButton tone="primary" icon={<Plus />} onClick={openCreate}>新增类型</AppButton>}
    </div>
    <AppSummaryGrid className="users-summary-grid" items={[
      { key: "total", label: "类型总数", value: items.length },
      { key: "active", label: "启用类型", value: items.filter((item) => item.is_active).length },
      { key: "coded", label: "已确认编码", value: items.filter((item) => item.code_rule_confirmed).length },
      { key: "plate", label: "使用板孔", value: items.filter((item) => item.uses_plate_wells).length },
    ]} />
    <AppFilterCard><div className="samples-filter-bar">
      <AppInput allowClear prefix={<Search />} placeholder="搜索类型名称或备注" value={keyword}
        onChange={(event) => setKeyword(event.target.value)} />
      <Select allowClear placeholder="状态" value={activeStatus} onChange={setActiveStatus}
        options={[{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} />
      <AppButton tone="secondary" onClick={() => { setKeyword(""); setActiveStatus(undefined); }}>重置</AppButton>
    </div></AppFilterCard>
    <AppTableCard className="samples-table-card users-table-card" title="样本类型列表"
      total={filteredItems.length} totalLabel="个类型">
      <AppTable<SpecimenTypeItem> rowKey="id" loading={loading} columns={columns}
        dataSource={filteredItems} scrollX={1120} pagination={false} />
    </AppTableCard>
    <Modal title={editing ? "编辑样本类型" : "新增样本类型"} open={modalOpen}
      onCancel={() => setModalOpen(false)} onOk={submit} okText="保存" cancelText="取消"
      confirmLoading={submitting} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="类型名称" rules={[{ required: true, message: "请输入类型名称" }]}
          extra={editing ? "类型名称用于关联历史样本，创建后不可修改。" : undefined}>
          <Input disabled={Boolean(editing)} maxLength={64} placeholder="如：器官组织、细胞株" />
        </Form.Item>
        <Form.Item name="sort_order" label="显示顺序" rules={[{ required: true }]}>
          <InputNumber min={0} max={9999} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="is_active" label="启用状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
        <Form.Item
          name="code_rule_confirmed"
          label="编码规则"
          valuePropName="checked"
          extra={codeRuleLocked
            ? `该类型已有 ${editing?.sample_count || 0} 条样本，后缀已锁定。`
            : "确认编码规则后，才可以将该类型加入批量打码。"}
        >
          <Switch
            checkedChildren="已确认"
            unCheckedChildren="未确认"
            disabled={codeRuleLocked}
            onChange={(checked) => {
              if (!checked) {
                form.setFieldsValue({ code_suffix: undefined, allow_batch_code: false });
              }
            }}
          />
        </Form.Item>
        <Form.Item
          name="code_suffix"
          label="编码后缀"
          extra={codeRuleConfirmed
            ? (isBaseType
              ? "全血使用基础编码，不添加后缀。"
              : "填写一个英文字母，区分大小写，例如血清使用 S。")
            : "规则未确认时不保存后缀。"}
          rules={[{
            validator: (_, value) => {
              if (!codeRuleConfirmed || isBaseType) return Promise.resolve();
              return /^[A-Za-z]$/.test(String(value || "").trim())
                ? Promise.resolve()
                : Promise.reject(new Error("请输入一个英文字母"));
            },
          }]}
        >
          <Input
            maxLength={1}
            disabled={!codeRuleConfirmed || isBaseType || codeRuleLocked}
            placeholder={isBaseType ? "无后缀" : "如 S"}
          />
        </Form.Item>
        <Form.Item name="allow_batch_code" label="参与批量打码" valuePropName="checked"
          extra="只有已确认编码规则的类型才能参与。">
          <Switch
            checkedChildren="参与"
            unCheckedChildren="不参与"
            disabled={!codeRuleConfirmed}
          />
        </Form.Item>
        <Form.Item name="uses_plate_wells" label="使用板孔管理" valuePropName="checked">
          <Switch checkedChildren="使用" unCheckedChildren="不使用" />
        </Form.Item>
        <Form.Item name="note" label="备注"><Input.TextArea maxLength={255} rows={3} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
