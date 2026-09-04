# 样本管理系统

面向科研样本全流程管理的 Web 应用，用于统一管理样本基础信息、库存流转、测序数据索引和相关资料。

> 本仓库仅包含应用源代码、数据库结构与自动化测试，不包含真实样本数据、患者资料、上传文件、运行密钥或生产环境配置。

## 主要功能

- 样本基础信息、样本类型和存储位置管理
- Excel 批量编码、校验和事务化导入
- 扫码出库、归还申请与管理员复核
- DNA 板号及 96 孔板位置管理
- 测序目录扫描、文件索引与业务状态查询
- 医院数据隔离上传、预览、审核和正式导入
- 敏感字段加密、文件加密存储和操作审计
- 用户、角色和最小权限控制

## 技术栈

- 前端：React、TypeScript、Vite、Ant Design、ECharts
- 后端：FastAPI、SQLAlchemy、PostgreSQL
- 文件处理：openpyxl、xlrd、cryptography
- 部署组件：Docker Compose、Nginx、Gunicorn

## 项目结构

```text
frontend/              React 前端
backend/app/           FastAPI 应用
backend/scripts/       管理和数据处理脚本
backend/sql/           数据库结构及增量迁移
backend/tests/         后端自动化测试
nginx/                 Nginx 配置
docker-compose.yml     容器编排配置
```

## 本地开发

运行环境和密钥应通过本地 `.env` 提供。请勿把 `.env`、真实数据库地址或真实数据文件提交到 Git。

后端：

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

生产构建：

```bash
cd frontend
npm run build
```

## 数据库

新建空数据库时使用：

```text
backend/sql/schema_latest.sql
```

已有数据库应按编号顺序执行尚未应用的增量迁移，不要对已有业务库重复执行整合版结构文件。

## 测试

```bash
cd backend
pytest
```

涉及真实 PostgreSQL 的集成测试默认关闭，只能针对获准的测试数据库显式启用。

## 安全约定

- 仓库不得包含真实患者信息、样本明细、知情同意书或测序数据。
- 仓库不得包含数据库密码、JWT 密钥、文件加密密钥、VPN 配置或私钥。
- 上传文件、日志、备份、导出结果和前端构建产物不得提交。
- 生产部署必须使用独立强密钥、受控网络入口、HTTPS、最小权限和可靠备份。
- 示例数据必须是虚构或充分脱敏的数据。

## 说明

本项目用于科研样本信息化管理。任何真实数据接入和生产部署都应遵循所在单位的数据安全、伦理审查和运维管理要求。
