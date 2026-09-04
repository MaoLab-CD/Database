import type { ReactNode } from "react";
import {
  Building2,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  FileUp,
  Home,
  Printer,
  QrCode,
  ScrollText,
  Server,
  Undo2,
  UploadCloud,
  Users,
} from "lucide-react";

import type { LoginResult } from "../api/auth";

export type MenuItemConfig = {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  adminOnly?: boolean;
  permission?: string;
  hospitalOnly?: boolean;
};

export const MENU_ITEMS: MenuItemConfig[] = [
  {
    key: "dashboard",
    label: "首页概览",
    description: "查看样本库存、流转状态与测序数据关联情况。",
    icon: <Home />,
  },
  {
    key: "samples",
    label: "样本管理",
    description: "样本列表、检索、详情和基础信息查看。",
    icon: <Database />,
  },
  {
    key: "scan-workbench",
    label: "扫码工作台",
    description: "扫码查询、出库、归还申请等操作入口。",
    icon: <QrCode />,
    permission: "sample_checkout",
  },
  {
    key: "return-review",
    label: "归还待确认",
    description: "复核样本归还状态，确认在库、用完、丢失或废弃。",
    icon: <Undo2 />,
    adminOnly: true,
  },
  {
    key: "checkout-records",
    label: "出入库记录",
    description: "查看样本出库、归还和使用追溯记录。",
    icon: <FileSearch />,
    permission: "usage_record_create",
  },
  {
    key: "excel-import",
    label: "Excel 导入",
    description: "导入样本基础表并查看导入批次。",
    icon: <FileUp />,
    adminOnly: true,
  },
  {
    key: "hospital-upload",
    label: "数据上传",
    description: "下载标准模板、上传医院数据并查看校验与审核状态。",
    icon: <UploadCloud />,
    permission: "hospital_data_submit",
    hospitalOnly: true,
  },
  {
    key: "hospital-review",
    label: "医院数据审核",
    description: "核对医院提交的数据，并按需导入系统。",
    icon: <ClipboardCheck />,
    adminOnly: true,
  },
  {
    key: "secure-documents",
    label: "资料档案",
    description: "保存知情同意书等项目资料。",
    icon: <FileText />,
    adminOnly: true,
  },
  {
    key: "batch-code",
    label: "批量打码",
    description: "生成样本编码清单，供外部标签打印软件使用。",
    icon: <Printer />,
    permission: "batch_code_generate",
  },
  {
    key: "centers",
    label: "基础配置",
    description: "维护中心、冰箱和样本类型等基础字典。",
    icon: <Building2 />,
    adminOnly: true,
  },
  {
    key: "sequencing",
    label: "测序数据管理",
    description: "查看测序目录、扫描批次和文件状态。",
    icon: <Server />,
  },
  {
    key: "logs",
    label: "隐私访问日志",
    description: "查看敏感信息访问记录和访问来源信息。",
    icon: <ScrollText />,
    permission: "privacy_access_log_view",
  },
  {
    key: "users",
    label: "用户管理",
    description: "维护账号、角色、状态、密码重置和附加权限。",
    icon: <Users />,
    adminOnly: true,
  },
];

export function canViewMenu(item: MenuItemConfig, user: LoginResult) {
  if (user.account_type === "hospital") {
    return item.key === "hospital-upload" && Boolean(user.permissions.hospital_data_submit);
  }
  if (item.hospitalOnly) {
    return false;
  }
  if (user.role === "admin") {
    return true;
  }
  if (item.adminOnly) {
    return false;
  }
  if (!item.permission) {
    return true;
  }
  return Boolean(user.permissions[item.permission]);
}
