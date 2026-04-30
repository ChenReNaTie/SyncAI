# Repository Guidelines

## 项目结构与模块划分

- `server/src`：后端主代码，包含 Fastify 服务、WebSocket 路由与运行时集成；数据库迁移在 `server/migrations`。
- `web/src`：前端主代码；页面放在 `pages`，通用组件放在 `components`，接口调用放在 `api`。
- `packages/shared/src`：前后端共用的类型、常量与契约，涉及双方数据结构时优先在这里统一。
- `tests/`：仓库级测试目录，按 `unit`、`contracts`、`integration`、`e2e`、`smoke` 分层；公共辅助代码在 `tests/helpers`。
- `docs/`：需求、架构与协作基线。改动业务规则前，先对照相关文档确认口径。

## 构建、测试与开发命令

- `npm run dev`：同时启动本地联调流程。
- `npm run dev:server` / `npm run dev:web`：只启动单个工作区，适合定点排查。
- `npm run db:up`：启动 PostgreSQL 和 Redis；`npm run db:migrate`：执行数据库迁移。
- `npm run build`：按 shared → server → web 顺序构建；`npm run typecheck`：执行全仓 TypeScript 校验。
- `npm run test`：执行提交前回归门禁；按需使用 `npm run test:unit`、`test:contracts`、`test:integration`、`test:e2e`、`test:smoke`。
- `npm run doctor`：检查本地依赖、服务连通性和运行环境。

## 代码风格与命名约定

- 遵循 `.editorconfig`：UTF-8、LF、2 空格缩进、文件末尾保留换行。
- 统一使用 TypeScript ESM；模块尽量小而清晰，导出保持明确。
- React 页面和组件使用 PascalCase，例如 `DashboardPage.tsx`；后端路由与工具文件使用小写命名，例如 `workspace.ts`、`session-events.ts`。
- 跨端共享的数据结构不要各写一份，统一收敛到 `packages/shared/src/index.ts`。
- 当前未配置独立 lint 流程，至少确保 `npm run typecheck` 和 `npm run build` 通过。

## 测试要求

- 使用 Node 内置测试运行器，测试文件命名为 `.test.mjs`。
- 测试按最小必要范围归类：纯逻辑放 `unit`，接口契约放 `contracts`，跨模块流程放 `integration`，真实协作链路放 `e2e`。
- 修改后端或共享契约时，至少运行 `npm run test:unit`、`npm run test:contracts`、`npm run test:integration`。
- 合并较大改动前，建议执行 `npm run test:regression:commit`；发版前执行 `npm run test:regression:pre-release`。

## 提交与合并请求

- 近期提交同时存在 `fix:` 风格和中文摘要；建议保持“单次提交只做一件事”，标题直接说明动作和范围。
- PR 需写清改动目标、涉及路径、已执行测试，以及是否包含迁移或环境变量调整。
- 涉及 `web/` 界面改动时附截图；涉及接口、表结构或 WebSocket 消息结构时要明确标注。

## 配置与协作提醒

- 本地开发请从 `.env.example` 复制 `.env`，不要把端口、账号、密码或 Codex 路径硬编码进源码。
- 如需求理解有分歧，以 `docs/01-产品/产品需求文档.md`、`docs/02-架构设计/概要设计.md`、`docs/02-架构设计/Agent接入设计.md`、`docs/05-环境与协作/Codex协作约束.md` 为准。
