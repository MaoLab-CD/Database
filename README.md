# 样本管理系统

面向科研样本管理的 Web 平台，覆盖样本建档、库存流转、DNA 板位、测序数据索引、资料归档和操作审计等业务。

仓库包含前后端源代码、数据库结构和自动化测试。业务数据、上传资料与运行配置由各部署环境独立管理。

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

数据库连接、服务密钥和数据目录等参数通过环境变量配置。本地开发时可在 `backend/.env` 中设置，Docker 部署时由部署目录中的 `.env` 注入。

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

涉及 PostgreSQL 的集成测试默认关闭，可在独立测试数据库中按需启用。

## 配置与数据

- 数据库密码、登录签名密钥和文件加密密钥由部署环境提供。
- 样本数据、知情同意资料、测序数据、上传文件、日志和备份保存在业务环境中，不纳入源码仓库。
- 生产环境建议配置 HTTPS、受控网络入口、独立密钥、最小权限和定期备份。
- 开发和测试数据使用虚构或脱敏内容。

## 说明

本项目用于科研样本信息化管理，实际部署方式可根据所在单位的网络、数据安全和运维要求进行配置。
