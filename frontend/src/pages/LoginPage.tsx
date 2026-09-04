/*
 * @Author: 袁瑞 && 2502099390@qq.com
 * @Date: 2026-06-23 14:07:06
 * @LastEditors: 袁瑞 && 2502099390@qq.com
 * @LastEditTime: 2026-08-13 15:44:16
 * @FilePath: \sample_admin\frontend\src\pages\LoginPage.tsx
 * @Description:
 */
import { Lock, User } from "lucide-react";
import { Card, Checkbox, Form, Typography } from "antd";
import { useEffect } from "react";

import type { LoginPayload } from "../api/auth";
import { AppButton, AppInput, AppPasswordInput } from "../ui";

type LoginPageProps = {
  form: ReturnType<typeof Form.useForm<LoginPayload>>[0];
  onLogin: (values: LoginPayload) => void;
  loading?: boolean;
};

export function LoginPage({ form, onLogin, loading }: LoginPageProps) {
  useEffect(() => {
    const saved = localStorage.getItem("sample_admin_remember_me");
    if (saved === "true") {
      form.setFieldValue("remember_me", true);
    }
  }, [form]);

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-intro">
          <Typography.Title level={1} className="lab-title">
            基因组医学中心
          </Typography.Title>
          <Typography.Title level={1}>样本管理系统</Typography.Title>
          <Typography.Paragraph>
            样本库存、扫码流转与测序数据管理。
          </Typography.Paragraph>
        </div>

        <Card
          className="login-card"
          title={
            <div className="login-title-block">
              <span>登录</span>
              <small>请输入账号和密码进入系统</small>
            </div>
          }
        >
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={onLogin}
            onValuesChange={(changed) => {
              if ("remember_me" in changed) {
                localStorage.setItem("sample_admin_remember_me", String(changed.remember_me));
              }
            }}
          >
            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: "请输入账号" }]}
            >
              <AppInput
                size="large"
                prefix={<User />}
                placeholder="请输入账号"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <AppPasswordInput
                size="large"
                prefix={<Lock />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item name="remember_me" valuePropName="checked">
              <Checkbox>记住我</Checkbox>
            </Form.Item>

            <AppButton tone="primary" size="large" htmlType="submit" block loading={loading}>
              {loading ? "登录中" : "登录"}
            </AppButton>
          </Form>
        </Card>
      </section>
    </main>
  );
}
