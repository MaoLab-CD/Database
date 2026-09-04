import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import type { LoginResult } from "../api/auth";
import { fetchCenters, type CenterItem } from "../api/centers";
import {
  createUser,
  fetchUsers,
  resetUserPassword,
  updateUser,
  type CreateUserPayload,
  type UpdateUserPayload,
  type UserItem,
  type AccountType,
  type UserRole,
  type UserStatus,
} from "../api/users";
import { getApiErrorMessage } from "../utils/http";
import { formatFullDateTime } from "../utils/format";
import {
  AppButton,
  AppFilterCard,
  AppInput,
  AppSummaryGrid,
  AppTable,
  AppTableCard,
  createTablePagination,
} from "../ui";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员" },
  { value: "user", label: "普通用户" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "停用" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: "internal", label: "内部人员" },
  { value: "hospital", label: "医院人员" },
];

const EXTRA_PERMISSION_OPTIONS = [
  { key: "sample_checkout", label: "扫码出入库", description: "允许进入扫码工作台执行出库和提交归还" },
  { key: "usage_record_create", label: "使用记录", description: "允许查看出入库记录和填写使用信息" },
  { key: "batch_code_generate", label: "批量打码", description: "允许生成编码预览并下载补码 Excel；不允许维护中心" },
  { key: "privacy_access_log_view", label: "隐私访问日志", description: "允许查看敏感信息访问记录和访问来源信息" },
];

type UserFormValues = {
  username?: string;
  display_name: string;
  password?: string;
  role: UserRole;
  status: UserStatus;
  password_reset_required: boolean;
  permissions?: string[];
  account_type: AccountType;
  center_codes?: string[];
};

type UsersPageProps = {
  currentUser: LoginResult;
};

function roleTag(record: UserItem) {
  if (record.is_super_admin) {
    return <Tag color="purple">超级管理员</Tag>;
  }
  return record.role === "admin" ? <Tag color="blue">管理员</Tag> : <Tag>普通用户</Tag>;
}

function statusTag(status: string) {
  return status === "active" ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>;
}

function permissionArrayToObject(values?: string[]) {
  return Object.fromEntries((values ?? []).map((key) => [key, true]));
}

function permissionObjectToArray(permissions: Record<string, boolean>) {
  return EXTRA_PERMISSION_OPTIONS.filter((item) => permissions[item.key]).map((item) => item.key);
}

export function UsersPage({ currentUser }: UsersPageProps) {
  const [keyword, setKeyword] = useState("");
  const [role, setRole] = useState<UserRole | undefined>();
  const [userStatus, setUserStatus] = useState<UserStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [form] = Form.useForm<UserFormValues>();
  const [resetForm] = Form.useForm<{ new_password: string; password_reset_required: boolean }>();
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const selectedFormRole = Form.useWatch("role", form);
  const selectedAccountType = Form.useWatch("account_type", form);

  useEffect(() => {
    if (selectedAccountType === "hospital") {
      form.setFieldValue("permissions", []);
    }
  }, [form, selectedAccountType]);

  const editableRoleOptions = useMemo(
    () => (currentUser.is_super_admin ? ROLE_OPTIONS : ROLE_OPTIONS.filter((item) => item.value === "user")),
    [currentUser.is_super_admin],
  );
  const centerMap = useMemo(
    () => new Map(centers.map((center) => [center.center_code, center])),
    [centers],
  );

  const loadUsers = () => {
    setLoading(true);
    fetchUsers({
      keyword: keyword.trim() || undefined,
      role,
      user_status: userStatus,
      page,
      page_size: pageSize,
    })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => message.error("用户列表加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, [page, pageSize, role, userStatus]);

  useEffect(() => {
    fetchCenters({ active_status: "active", page: 1, page_size: 200 })
      .then((data) => setCenters(data.items))
      .catch(() => message.error("中心列表加载失败"));
  }, []);

  const summary = useMemo(() => {
    return {
      admin: items.filter((item) => item.role === "admin").length,
      user: items.filter((item) => item.role === "user").length,
      disabled: items.filter((item) => item.status === "disabled").length,
    };
  }, [items]);

  const openCreateModal = () => {
    setEditingUser(null);
    form.setFieldsValue({
      role: "user",
      status: "active",
      password_reset_required: true,
      permissions: [],
      account_type: "internal",
      center_codes: [],
    });
    setUserModalOpen(true);
  };

  const openEditModal = (user: UserItem) => {
    if (user.username === currentUser.username) {
      message.info("当前登录账号不能在这里修改角色、状态或权限");
      return;
    }
    if ((user.role === "admin" || user.is_super_admin) && !currentUser.is_super_admin) {
      message.info("只有超级管理员可以管理管理员账号");
      return;
    }
    setEditingUser(user);
    form.setFieldsValue({
      display_name: user.display_name,
      role: user.role,
      status: user.status,
      password_reset_required: user.password_reset_required,
      permissions: permissionObjectToArray(user.permissions),
      account_type: user.account_type,
      center_codes: user.center_codes,
    });
    setUserModalOpen(true);
  };

  const submitUserForm = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingUser) {
        const payload: UpdateUserPayload = {
          display_name: values.display_name,
          role: values.role,
          status: values.status,
          password_reset_required: values.password_reset_required,
          permissions:
            values.role === "user" && values.account_type === "internal"
              ? permissionArrayToObject(values.permissions)
              : {},
          account_type: values.role === "admin" ? "internal" : values.account_type,
          center_codes:
            values.role === "user" && values.account_type === "hospital"
              ? values.center_codes ?? []
              : [],
        };
        await updateUser(editingUser.id, payload);
        message.success("用户已更新");
      } else {
        const payload: CreateUserPayload = {
          username: values.username ?? "",
          display_name: values.display_name,
          password: values.password ?? "",
          role: values.role,
          status: values.status,
          password_reset_required: values.password_reset_required,
          permissions:
            values.role === "user" && values.account_type === "internal"
              ? permissionArrayToObject(values.permissions)
              : {},
          account_type: values.role === "admin" ? "internal" : values.account_type,
          center_codes:
            values.role === "user" && values.account_type === "hospital"
              ? values.center_codes ?? []
              : [],
        };
        await createUser(payload);
        message.success("用户已创建");
      }
      setUserModalOpen(false);
      form.resetFields();
      loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, editingUser ? "用户更新失败" : "用户创建失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const openResetModal = (user: UserItem) => {
    if (user.username === currentUser.username) {
      message.info("当前登录账号请使用右上角的修改密码");
      return;
    }
    if ((user.role === "admin" || user.is_super_admin) && !currentUser.is_super_admin) {
      message.info("只有超级管理员可以重置管理员账号密码");
      return;
    }
    setResetUser(user);
    resetForm.setFieldsValue({
      new_password: "",
      password_reset_required: true,
    });
  };

  const submitResetPassword = async () => {
    if (!resetUser) {
      return;
    }
    const values = await resetForm.validateFields();
    setSubmitting(true);
    try {
      await resetUserPassword(
        resetUser.id,
        values.new_password,
        values.password_reset_required,
      );
      message.success(`已重置 ${resetUser.username} 的密码`);
      setResetUser(null);
      resetForm.resetFields();
      loadUsers();
    } catch (error) {
      message.error(getApiErrorMessage(error, "密码重置失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<UserItem> = [
    {
      title: "账号",
      dataIndex: "username",
      width: 130,
      fixed: "left",
      render: (value: string) => (
        <Space size={6}>
          <strong>{value}</strong>
          {value === currentUser.username ? <Tag color="blue">当前账号</Tag> : null}
        </Space>
      ),
    },
    { title: "显示名称", dataIndex: "display_name", width: 130 },
    {
      title: "账号类型",
      dataIndex: "account_type",
      width: 110,
      render: (value: AccountType) =>
        value === "hospital" ? <Tag color="cyan">医院人员</Tag> : <Tag>内部人员</Tag>,
    },
    {
      title: "所属医院 / 中心",
      width: 260,
      render: (_, record) =>
        record.center_codes.length > 0 ? (
          <div className="user-center-list">
            {record.center_codes.map((centerCode) => {
              const center = centerMap.get(centerCode);
              return (
                <div className="user-center-item" key={centerCode}>
                  <strong>{center?.center_name ?? centerCode}</strong>
                  {center ? <span>{centerCode}</span> : null}
                </div>
              );
            })}
          </div>
        ) : "-",
    },
    { title: "角色", dataIndex: "role", width: 110, render: (_, record) => roleTag(record) },
    { title: "状态", dataIndex: "status", width: 88, render: statusTag },
    {
      title: "附加权限",
      width: 260,
      render: (_, record) =>
        record.role === "admin" ? (
          <Tag color="blue">全部权限</Tag>
        ) : record.account_type === "hospital" ? (
          <Tag color="cyan">数据上传</Tag>
        ) : (
          <Space wrap size={[4, 4]}>
            {EXTRA_PERMISSION_OPTIONS.filter((item) => record.permissions[item.key]).length > 0 ? (
              EXTRA_PERMISSION_OPTIONS.filter((item) => record.permissions[item.key]).map((item) => (
                <Tag key={item.key} color="geekblue">
                  {item.label}
                </Tag>
              ))
            ) : (
              <Tag>默认查询</Tag>
            )}
          </Space>
        ),
    },
    {
      title: "需改密码",
      dataIndex: "password_reset_required",
      width: 96,
      render: (value: boolean) => (value ? <Tag color="gold">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: "密码修改时间",
      dataIndex: "password_changed_at",
      width: 160,
      render: formatFullDateTime,
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 160,
      render: formatFullDateTime,
    },
    {
      title: "操作",
      width: 180,
      fixed: "right",
      render: (_, record) => {
        const isCurrentUser = record.username === currentUser.username;
        const isAdminAccount = record.role === "admin" || record.is_super_admin;
        const disabled = isCurrentUser || (isAdminAccount && !currentUser.is_super_admin);
        if (disabled) {
          return <span className="muted-action">-</span>;
        }
        return (
          <Space>
            <AppButton
              tone="quiet"
              size="small"
              onClick={() => openEditModal(record)}
            >
              编辑
            </AppButton>
            <AppButton
              tone="quiet"
              size="small"
              onClick={() => openResetModal(record)}
            >
              重置密码
            </AppButton>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="users-page">
      <div className="page-toolbar">
        <div>
          <h2>用户管理</h2>
          <span>共 {total} 个账号</span>
        </div>
        <AppButton tone="primary" icon={<Plus />} onClick={openCreateModal}>
          新建用户
        </AppButton>
      </div>

      <AppSummaryGrid
        className="users-summary-grid"
        items={[
          { key: "admin", label: "管理员", value: summary.admin },
          { key: "user", label: "普通用户", value: summary.user },
          { key: "disabled", label: "停用账号", value: summary.disabled },
        ]}
      />

      <AppFilterCard>
        <div className="samples-filter-bar">
          <AppInput
            allowClear
            prefix={<Search />}
            placeholder="搜索账号或显示名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              loadUsers();
            }}
          />
          <Select
            allowClear
            placeholder="角色"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(value) => {
              setPage(1);
              setRole(value);
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            options={STATUS_OPTIONS}
            value={userStatus}
            onChange={(value) => {
              setPage(1);
              setUserStatus(value);
            }}
          />
          <Space>
            <AppButton
              tone="primary"
              icon={<Search />}
              onClick={() => {
                setPage(1);
                loadUsers();
              }}
            >
              查询
            </AppButton>
            <AppButton
              tone="secondary"
              onClick={() => {
                setKeyword("");
                setRole(undefined);
                setUserStatus(undefined);
                setPage(1);
              }}
            >
              重置
            </AppButton>
          </Space>
        </div>
      </AppFilterCard>

      <AppTableCard
        className="samples-table-card users-table-card"
        title="用户列表"
        total={total}
        totalLabel="个账号"
      >
        <AppTable<UserItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scrollX={1280}
          pagination={createTablePagination({
            page,
            pageSize,
            total,
            unit: "个账号",
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          })}
        />
      </AppTableCard>

      <Modal
        title={editingUser ? `编辑用户 ${editingUser.username}` : "新建用户"}
        open={userModalOpen}
        okText={editingUser ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submitUserForm}
        onCancel={() => {
          setUserModalOpen(false);
          form.resetFields();
        }}
        centered
        width={620}
      >
        <Form form={form} layout="vertical" className="users-form">
          {!editingUser ? (
            <>
              <Form.Item
                name="username"
                label="账号"
                rules={[{ required: true, message: "请输入账号" }]}
              >
                <Input placeholder="例如 ryuan" />
              </Form.Item>
              <Form.Item
                name="password"
                label="初始密码"
                rules={[{ required: true, min: 6, message: "密码至少 6 位" }]}
              >
                <Input.Password placeholder="请输入初始密码" />
              </Form.Item>
            </>
          ) : null}
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <Input placeholder="页面右上角显示的名称" />
          </Form.Item>
          <div className="users-form-grid">
            <Form.Item name="role" label="角色" rules={[{ required: true }]}>
              <Select options={editableRoleOptions} />
            </Form.Item>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </div>
          {selectedFormRole === "user" ? (
            <div className="users-form-grid">
              <Form.Item
                name="account_type"
                label="账号类型"
                rules={[{ required: true, message: "请选择账号类型" }]}
              >
                <Select options={ACCOUNT_TYPE_OPTIONS} />
              </Form.Item>
              {selectedAccountType === "hospital" ? (
                <Form.Item
                  name="center_codes"
                  label="所属医院 / 中心"
                  rules={[
                    { required: true, message: "请选择所属医院或中心" },
                    {
                      validator: (_, value?: string[]) =>
                        value?.length === 1
                          ? Promise.resolve()
                          : Promise.reject(new Error("医院账号必须且只能绑定一个中心")),
                    },
                  ]}
                >
                  <Select
                    mode="multiple"
                    maxCount={1}
                    showSearch
                    optionFilterProp="label"
                    placeholder="请选择一个中心"
                    options={centers.map((center) => ({
                      value: center.center_code,
                      label: `${center.center_code} ${center.center_name}`,
                    }))}
                  />
                </Form.Item>
              ) : <div />}
            </div>
          ) : null}
          {selectedFormRole === "admin" ? (
            <div className="admin-permission-note">
              <Tag color="blue">全部权限</Tag>
              <span>管理员默认拥有所有页面和操作权限，不需要配置附加权限。</span>
            </div>
          ) : selectedAccountType === "hospital" ? (
            <div className="admin-permission-note">
              <Tag color="cyan">仅数据上传</Tag>
              <span>医院账号固定只能上传文件和查看本人提交记录，不能配置其他附加权限。</span>
            </div>
          ) : (
            <Form.Item name="permissions" label="普通用户附加权限">
              <Checkbox.Group className="permission-check-grid">
                {EXTRA_PERMISSION_OPTIONS.map((item) => (
                  <Checkbox value={item.key} key={item.key}>
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Form.Item>
          )}
          <Form.Item
            name="password_reset_required"
            label="要求下次登录后修改密码"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resetUser ? `重置密码：${resetUser.username}` : "重置密码"}
        open={Boolean(resetUser)}
        okText="确认重置"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submitResetPassword}
        onCancel={() => {
          setResetUser(null);
          resetForm.resetFields();
        }}
        centered
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, min: 6, message: "密码至少 6 位" }]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="password_reset_required"
            label="要求用户下次登录后修改密码"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
