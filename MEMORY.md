# MEMORY

## 2026-04

- 2026-04-14: `shared-ai-chat` 被确定为 SyncAI（灵悉 AI）项目的长期主会话工作区。
- 2026-04-14: 当前统一产品名称使用 `SyncAI / 灵悉 AI`，后续应避免继续混用 `TeamMind`、`SharedAI Chat` 等历史名称。
- 2026-04-14: 第一阶段已完成现有资料阅读与需求分析基线整理，基线文档为 `docs/requirements-analysis.md`。
- 2026-04-14: 当前产品主线聚焦“共享 AI 会话 + 协作任务跟进”，MVP 不同时推进 IDE 插件、开放 API、知识库体系和企业级能力。
- 2026-04-14: 三份核心中文基线文档 `docs/产品需求文档.md`、`docs/MVP架构设计.md`、`docs/Agent接入设计.md` 已统一口径，搜索 / 回放 / 单管理节点 / 排队中交互 / 共享转私有审计要求已固化，可作为后续开发拆解基础。
- 2026-04-15: 已从“正式文档基线阶段”进入“正式编码阶段”，当前工程主线固定为 npm workspace + Fastify 服务端 + React/Vite 前端 + PostgreSQL/Redis 本地依赖。
- 2026-04-15: 首轮代码骨架已建立，且 `server/migrations/0001_initial_schema.sql` 已把中文正式数据库设计开始转成真实迁移基线；后续优先继续推进数据库仓储、认证、团队/项目/会话基础接口，再接消息调度与 Mock CodexAdapter。
