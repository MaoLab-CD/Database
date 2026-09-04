import { Form, message } from "antd";

import { changePassword } from "../../api/auth";
import { AppModal, AppPasswordInput } from "../../ui";

type ChangePasswordForm = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type ChangePasswordModalProps = {
  open: boolean;
  submitting: boolean;
  forced?: boolean;
  setSubmitting: (submitting: boolean) => void;
  onClose: () => void;
  onSuccess: () => void;
};

export function ChangePasswordModal({
  open,
  submitting,
  forced = false,
  setSubmitting,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [passwordForm] = Form.useForm<ChangePasswordForm>();

  const handleChangePassword = async () => {
    const values = await passwordForm.validateFields();
    setSubmitting(true);
    try {
      await changePassword({
        old_password: values.oldPassword,
        new_password: values.newPassword,
      });
      message.success("密码已修改，请使用新密码重新登录");
      passwordForm.resetFields();
      onSuccess();
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "detail" in error.response.data
          ? String(error.response.data.detail)
          : "修改密码失败，请稍后再试";
      message.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      title="修改密码"
      open={open}
      okText="确认修改"
      cancelText="取消"
      confirmLoading={submitting}
      closable={!forced}
      maskClosable={!forced}
      keyboard={!forced}
      cancelButtonProps={forced ? { style: { display: "none" } } : undefined}
      onOk={handleChangePassword}
      onCancel={() => {
        if (forced) {
          return;
        }
        passwordForm.resetFields();
        onClose();
      }}
      destroyOnClose
    >
      {forced ? (
        <div className="forced-password-note">
          当前账号使用的是管理员设置或重置后的密码，请先修改密码再继续使用系统。
        </div>
      ) : null}
      <Form
        form={passwordForm}
        layout="vertical"
        requiredMark={false}
        className="password-form"
      >
        <Form.Item
          label="旧密码"
          name="oldPassword"
          rules={[{ required: true, message: "请输入旧密码" }]}
        >
          <AppPasswordInput placeholder="请输入旧密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          label="新密码"
          name="newPassword"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: 6, message: "新密码至少 6 位" },
          ]}
        >
          <AppPasswordInput placeholder="请输入新密码" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="确认新密码"
          name="confirmPassword"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的新密码不一致"));
              },
            }),
          ]}
        >
          <AppPasswordInput placeholder="请再次输入新密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </AppModal>
  );
}
