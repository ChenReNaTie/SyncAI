# SyncAI / 灵悉 AI - API 设计

**版本：** v1.1  
**更新时间：** 2026-04-16  
**文档定位：** 基于 `docs/概要设计.md` 与 `docs/数据库设计.md` 输出的正式 API 设计文档，覆盖 HTTP 接口、WebSocket 实时事件和内部 Adapter 合同。

---

## 1. 设计目标

本设计只覆盖当前 MVP 可直接开编码的接口范围，不引入未拍板能力。

接口设计必须满足以下产品边界：

- 组织结构固定为团队 > 项目 > 会话。
- 第一阶段只支持 `Codex`。
- Agent 默认运行在管理员本机。
- 同会话消息串行执行，运行中后续消息入队。
- 搜索第一版只搜成员消息和 Agent 最终回复。
- todo 只做轻量版。
- 共享转私有后保留审计，不保留继续暴露内容。

---

## 2. 通用约定

### 2.1 基础规则

- HTTP Base Path：`/api/v1`
- 数据格式：`application/json; charset=utf-8`
- 认证方式：`Authorization: Bearer <token>`
- 在当前开发 / 测试阶段，可由鉴权层或测试注入 `Authorization: Bearer <user_uuid>`，也可临时注入 `x-syncai-user-id` 代表“已完成鉴权的当前用户”；业务路由不得回退到 `creator_id` / `created_by` 冒充当前用户。
- ID 类型：统一使用 `uuid`
- 时间格式：统一使用 ISO 8601 UTC 字符串

### 2.2 统一返回结构

成功返回建议：

```json
{
  "data": {},
  "meta": {}
}
```

错误返回建议：

```json
{
  "error": {
    "code": "SESSION_NOT_VISIBLE",
    "message": "当前用户无权查看该会话",
    "details": {}
  }
}
```

### 2.3 分页规则

- 列表接口优先使用 cursor 分页
- 参数建议：`limit`、`cursor`
- 响应 `meta` 建议返回：`next_cursor`

### 2.4 幂等规则

发送成员消息时，客户端应传 `client_message_id`，服务端按 `(session_id, client_message_id)` 去重，避免断线重试生成重复消息。

若客户端因超时或断线重试再次提交相同 `client_message_id`，服务端返回已存在成员消息的幂等回放结果，不再重复写入消息、队列或事件。

---

## 3. 核心资源模型

| 资源 | 关键字段 |
|---|---|
| `Team` | `id` `name` `slug` |
| `Project` | `id` `team_id` `name` `archived_at` |
| `Session` | `id` `project_id` `title` `visibility` `runtime_status` `bound_agent_type` `bound_agent_node_id` `bound_agent_session_ref` |
| `Message` | `id` `session_id` `sender_type` `content` `processing_status` `is_final_reply` |
| `ReplayEntry` | `entry_type` `occurred_at` `summary/content` `visibility?` |
| `Todo` | `id` `session_id` `source_message_id` `title` `status` |
| `AuditLog` | `id` `session_id` `previous_visibility` `new_visibility` `shared_started_at` `shared_ended_at` |

---

## 4. HTTP API 设计

### 4.1 认证

#### `POST /auth/register`

请求体：

```json
{
  "email": "admin@example.com",
  "password": "StrongPass123",
  "display_name": "Admin A"
}
```

响应体：

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "admin@example.com",
      "display_name": "Admin A"
    },
    "access_token": "jwt",
    "refresh_token": "jwt"
  }
}
```

#### `POST /auth/login`

用途：

- 登录

#### `GET /auth/me`

用途：

- 获取当前登录用户

---

### 4.2 团队与成员

#### `POST /teams`

用途：

- 创建团队
- 创建人默认成为管理员

请求体：

```json
{
  "name": "SyncAI Team",
  "slug": "syncai-team"
}
```

#### `GET /teams`

用途：

- 获取当前用户加入的团队列表

#### `GET /teams/{team_id}`

用途：

- 获取团队详情

#### `POST /teams/{team_id}/members`

请求体：

```json
{
  "user_id": "uuid",
  "role": "member"
}
```

#### `PATCH /teams/{team_id}/members/{user_id}`

约束：

- 只允许 `admin` / `member`

---

### 4.3 管理员执行节点

#### `GET /teams/{team_id}/agent-node`

用途：

- 查看团队当前绑定的管理员本机 Codex 节点

#### `PUT /teams/{team_id}/agent-node`

用途：

- 管理员配置或更新团队默认执行节点

请求体：

```json
{
  "display_name": "Admin MacBook",
  "client_fingerprint": "host-001"
}
```

约束：

- MVP 固定 `agent_type = codex`
- MVP 固定 `node_mode = admin_local`
- 团队会话创建时必须读取这里配置的当前节点；未配置或不可用时，`POST /projects/{project_id}/sessions` 直接失败

#### `POST /internal/agent-nodes/{node_id}/heartbeat`

用途：

- 管理端本机进程回报心跳

说明：

- 该接口属于内部接入接口，不对普通前端开放

---

### 4.4 项目

#### `POST /teams/{team_id}/projects`

请求体：

```json
{
  "name": "shared-ai-chat",
  "description": "SyncAI MVP"
}
```

#### `GET /teams/{team_id}/projects`

用途：

- 获取团队项目列表

#### `PATCH /projects/{project_id}/archive`

请求体：

```json
{
  "archived": true
}
```

---

### 4.5 会话

#### `POST /projects/{project_id}/sessions`

用途：

- 创建共享会话或私有会话
- 创建时绑定团队当前 Codex 节点
- 创建成功响应中必须返回 `bound_agent_node_id` 与 `bound_agent_session_ref`

请求体：

```json
{
  "title": "修复消息队列状态流转",
  "visibility": "shared"
}
```

响应重点字段：

- `id`
- `project_id`
- `visibility`
- `runtime_status`
- `bound_agent_type`
- `bound_agent_node_id`
- `bound_agent_session_ref`

失败条件：

- 团队未配置当前 Codex 节点时返回 `NODE_NOT_CONFIGURED`
- 当前节点不可用或底层 `startSession` 失败时返回 `NODE_UNAVAILABLE`
- 不允许先创建空壳会话、再在首条消息发送时补做绑定

#### `GET /projects/{project_id}/sessions`

用途：

- 获取项目下当前用户可见的会话列表

查询参数建议：

- `visibility`
- `cursor`
- `limit`

列表项至少返回：

- `id`
- `title`
- `visibility`
- `runtime_status`
- `last_message_at`
- `pending_count`

#### `GET /sessions/{session_id}`

用途：

- 获取会话详情

#### `PATCH /sessions/{session_id}/visibility`

用途：

- 共享 / 私有切换

请求体：

```json
{
  "visibility": "private"
}
```

约束：

- 共享转私有时必须同步写审计记录
- 返回体中应带最新 `visibility`

#### `GET /sessions/{session_id}/audit-logs`

用途：

- 查询该会话审计记录

---

### 4.6 消息与执行

#### `GET /sessions/{session_id}/messages`

返回范围固定为：

- 成员消息
- Agent 最终回复

不返回：

- 命令过程摘要
- 状态事件
- 排队事件

#### `POST /sessions/{session_id}/messages`

用途：

- 发送成员消息
- 由服务端决定直接执行还是入队

请求体：

```json
{
  "content": "把会话消息状态机补完整，并补测试。",
  "client_message_id": "web-1744680000-001"
}
```

响应体建议：

```json
{
  "data": {
    "message": {
      "id": "uuid",
      "session_id": "uuid",
      "sender_type": "member",
      "content": "把会话消息状态机补完整，并补测试。",
      "processing_status": "queued",
      "created_at": "2026-04-15T03:00:00Z"
    },
    "dispatch_state": {
      "session_runtime_status": "running",
      "queue_position": 1
    }
  }
}
```

重复提交相同 `(session_id, client_message_id)` 时：

- 返回 `200`
- `data.message` 为第一次成功写入的成员消息
- `data.duplicated = true`
- `data.idempotent_replay = true`
- 不重复写入 `messages`、`session_events` 或新的执行队列项

约束：

- 成员消息必须先落库，再触发调度
- 运行中消息不报错，直接返回 `queued`

---

### 4.7 回放

#### `GET /sessions/{session_id}/replay`

返回条目类型固定为：

- `message`
- `status_changed`
- `command_summary`
- `visibility_changed`

响应示例：

```json
{
  "data": [
    {
      "entry_type": "message",
      "message_id": "uuid",
      "occurred_at": "2026-04-15T03:00:00Z",
      "sender_type": "member",
      "content": "请补充测试"
    },
    {
      "entry_type": "status_changed",
      "occurred_at": "2026-04-15T03:00:01Z",
      "from": "idle",
      "to": "running",
      "summary": "会话开始执行"
    },
    {
      "entry_type": "command_summary",
      "occurred_at": "2026-04-15T03:00:10Z",
      "summary": "已检查消息服务并补充测试用例"
    },
    {
      "entry_type": "visibility_changed",
      "occurred_at": "2026-04-15T03:05:00Z",
      "from": "shared",
      "to": "private",
      "summary": "会话已转为私有，仅创建者继续可见"
    }
  ]
}
```

---

### 4.8 搜索

#### `GET /teams/{team_id}/search`

查询参数：

- `q`：关键词，必填
- `project_id`：可选
- `limit`
- `cursor`

返回范围固定为：

- 成员消息
- Agent 最终回复

搜索结果项至少包含：

- `session_id`
- `project_id`
- `message_id`
- `sender_type`
- `snippet`
- `occurred_at`

---

### 4.9 Todo

#### `GET /sessions/{session_id}/todos`

用途：

- 获取当前会话侧边栏 todo 列表

#### `POST /sessions/{session_id}/todos`

请求体：

```json
{
  "source_message_id": "uuid",
  "title": "补消息状态流转测试"
}
```

响应要求：

- 返回 `source_message_id`
- 返回 `status = pending`

#### `PATCH /todos/{todo_id}`

请求体：

```json
{
  "status": "completed"
}
```

约束：

- 只允许 `pending` / `completed`

---

## 5. WebSocket 实时事件设计

### 5.1 连接与订阅

连接建立后：

1. 使用 JWT 鉴权
2. 客户端显式订阅会话
3. 服务端按会话可见性和团队成员关系校验

客户端事件建议：

- `session.subscribe`
- `session.unsubscribe`

### 5.2 服务端推送事件

#### `session.message.created`

用途：

- 推送新成员消息或 Agent 最终回复

#### `session.message.status_changed`

用途：

- 推送消息状态变化：`accepted -> queued -> running -> completed/failed`

#### `session.runtime.changed`

用途：

- 推送会话聚合运行状态变化

#### `session.event.created`

用途：

- 推送可回放事件，例如 `status.changed`、`command.summary`、`session.shared`、`session.privatized`

#### `session.todo.created`

用途：

- 推送 todo 新建

#### `session.todo.updated`

用途：

- 推送 todo 状态变更

#### `session.visibility.changed`

用途：

- 推送会话共享 / 私有切换
- 对无权继续查看的客户端，服务端应主动断开该会话订阅

---

## 6. 内部 Adapter 合同

外部前端不直接调用 Adapter，但后端实现前必须固定其内部合同。

建议接口：

```ts
interface AgentAdapter {
  startSession(input: {
    teamId: string;
    sessionId: string;
    nodeId: string;
  }): Promise<{ agentSessionRef: string }>;

  resumeSession(input: {
    sessionId: string;
    agentSessionRef: string;
  }): Promise<void>;

  sendMessage(input: {
    sessionId: string;
    messageId: string;
    content: string;
  }): Promise<void>;

  getStatus(input: {
    sessionId: string;
  }): Promise<{
    runtimeStatus: "idle" | "queued" | "running" | "completed" | "error";
  }>;

  onEvent(listener: (event: AdapterEvent) => Promise<void>): void;

  dispose(input: {
    sessionId: string;
  }): Promise<void>;
}
```

`AdapterEvent` 最少应支持：

- `status.changed`
- `command.summary`
- `final.reply`
- `message.failed`
- `node.status_changed`

归一化规则：

- `final.reply` 由服务端写入 `messages`，并标记 `is_final_reply = true`
- `final.reply` 不写入 `session_events`，避免把最终回复同时当成消息和事件
- `status.changed`、`command.summary`、`message.failed` 以及可见性切换类事件才进入回放事件流

---

## 7. 权限校验规则

所有接口都必须统一执行以下校验：

- 当前用户是否属于该团队
- 当前用户是否有权查看该项目
- 当前用户是否有权查看该会话
- 私有会话是否为创建者本人
- 管理员节点配置接口是否由团队管理员调用

共享转私有后，以下接口必须立即受影响：

- 会话列表
- 会话详情
- 消息流
- 回放
- 搜索结果
- todo 列表
- WebSocket 订阅

---

## 8. 错误码建议

| 错误码 | 含义 |
|---|---|
| `AUTH_REQUIRED` | 未登录或 Token 无效 |
| `FORBIDDEN` | 有团队身份但无操作权限 |
| `TEAM_NOT_FOUND` | 团队不存在 |
| `PROJECT_NOT_FOUND` | 项目不存在 |
| `SESSION_NOT_FOUND` | 会话不存在 |
| `SESSION_NOT_VISIBLE` | 当前用户无权查看会话 |
| `NODE_NOT_CONFIGURED` | 团队未配置 Codex 节点 |
| `NODE_UNAVAILABLE` | 当前节点不可用 |
| `INVALID_VISIBILITY` | 非法可见性切换 |
| `INVALID_TODO_STATUS` | 非法 todo 状态 |

---

## 9. 实现优先级建议

建议按以下顺序落 API：

1. `auth`
2. `teams` / `team_members`
3. `projects`
4. `agent-node`
5. `sessions`
6. `messages`
7. `session runtime / websocket`
8. `replay`
9. `search`
10. `todos`
11. `audit logs`

原因：

- 先有可登录、可组织、可配置当前 Codex 节点，才能满足“创建即绑定”的会话前提。
- `messages + websocket + adapter` 跑通后，回放 / 搜索 / todo / 审计才有数据基础。

---

## 10. 结论

这份 API 设计已经把当前 MVP 的 HTTP 资源、实时事件和内部 Adapter 合同统一下来。后续正式开编码时，后端接口命名可以有少量实现层调整，但请求语义、权限边界和返回范围必须严格以本文为准，尤其不能把搜索、回放和 todo 重新扩到旧版英文文档里的更大范围。
