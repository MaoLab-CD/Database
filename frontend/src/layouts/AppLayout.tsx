import { useState, type ReactNode } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Badge, Dropdown, Layout, Menu, Modal } from "antd";
import type { MenuProps } from "antd";

import type { LoginResult } from "../api/auth";
import { AppAlert, AppButton } from "../ui";
import type { MenuItemConfig } from "./menu";
import jcqyEmblem from "../assets/jcqy-emblem.png";

type AppLayoutProps = {
  currentUser: LoginResult;
  visibleMenus: MenuItemConfig[];
  selectedMenu: MenuItemConfig | undefined;
  menuBadges?: Record<string, number>;
  onSelectMenu: (key: string) => void;
  onChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AppLayout({
  currentUser,
  visibleMenus,
  selectedMenu,
  menuBadges = {},
  onSelectMenu,
  onChangePassword,
  onLogout,
  children,
}: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const displayName = currentUser.display_name || currentUser.username;
  const avatarText = displayName.slice(0, 1).toUpperCase();

  const menuItems: MenuProps["items"] = visibleMenus.map((item) => {
    const count = menuBadges[item.key] ?? 0;
    const icon =
      collapsed && count > 0 ? (
        <Badge count={count} size="small" offset={[-2, 2]} className="app-menu-icon-badge">
          <span className="app-menu-icon-wrap">{item.icon}</span>
        </Badge>
      ) : (
        item.icon
      );

    return {
      key: item.key,
      icon,
      label: (
        <span className="app-menu-label">
          <span>{item.label}</span>
          {!collapsed && count > 0 ? <Badge count={count} size="small" /> : null}
        </span>
      ),
    };
  });

  const confirmLogout = () => {
    Modal.confirm({
      title: "确认退出登录？",
      content: "退出后需要重新登录。",
      okText: "确认退出",
      cancelText: "取消",
      centered: true,
      onOk: onLogout,
    });
  };

  return (
    <Layout className={`app-layout ${collapsed ? "app-layout-collapsed" : ""}`}>
      <Layout.Sider
        className="app-sider"
        width={252}
        collapsedWidth={76}
        collapsed={collapsed}
        trigger={null}
      >
        <div className={`app-brand ${collapsed ? "app-brand-collapsed" : ""}`}>
          <span className="app-brand-icon">
            <img src={jcqyEmblem} alt="" />
          </span>
          {!collapsed ? (
            <div className="app-brand-text">
              <strong>样本管理系统</strong>
              <span>基因组医学中心</span>
            </div>
          ) : null}
        </div>

        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[selectedMenu?.key ?? "dashboard"]}
          items={menuItems}
          onClick={({ key }) => onSelectMenu(key)}
          className="app-menu"
        />

        <div className="app-sider-footer">
          <AppButton
            tone="quiet"
            icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? null : "收起"}
          </AppButton>
        </div>
      </Layout.Sider>

      <Layout className="app-main-layout">
        <Layout.Header className="app-header">
          <div className="app-header-title">
            <span>{selectedMenu?.label}</span>
          </div>
          <Dropdown
            menu={{
              items: [
                {
                  key: "user-info",
                  label: (
                    <div className="app-user-menu-info">
                      <div className="app-user-menu-name">{displayName}</div>
                      <div className="app-user-menu-role">
                        {currentUser.is_super_admin
                          ? "超级管理员"
                          : currentUser.role === "admin"
                            ? "管理员"
                            : "普通用户"}
                      </div>
                    </div>
                  ),
                  disabled: true,
                },
                { type: "divider" },
                {
                  key: "change-password",
                  label: "修改密码",
                },
                {
                  key: "logout",
                  label: "退出登录",
                  danger: true,
                },
              ],
              onClick: ({ key }) => {
                if (key === "change-password") onChangePassword();
                if (key === "logout") confirmLogout();
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
            overlayClassName="app-user-dropdown"
          >
            <div className="app-userbar">
              <span className="app-user-avatar">{avatarText}</span>
              <span className="app-user-name">{displayName}</span>
            </div>
          </Dropdown>
        </Layout.Header>

        <Layout.Content className="app-content">
          {currentUser.password_reset_required ? (
            <AppAlert
              type="warning"
              message="当前账号需要修改密码"
              description="管理员已重置该账号密码，请尽快修改密码。"
            />
          ) : null}
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
