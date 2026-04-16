# SyncAI / 灵悉 AI - Phase 1 MVP 开发任务清单

**文档编号：** PLAN-2026-001  
**版本：** v1.0  
**创建时间：** 2026-04-14  
**撰写人：** 阿铁 ⚓  
**阶段：** Phase 1 MVP（4-6 周）

---

## 1. MVP 范围定义

### 1.1 核心目标
**验证核心假设：** 团队愿意为 AI 对话共享功能付费

### 1.2 MVP 功能边界
```
✅ 包含在 MVP:
- 用户注册/登录（邮箱 + 密码）
- 创建工作区
- 创建共享会话
- 实时消息同步（WebSocket）
- AI 对话集成（Claude API）
- 基础任务卡片（创建/分配/状态）
- Web 界面（响应式）

❌ 不包含在 MVP:
- 第三方登录（Google/GitHub）
- 知识库系统
- 历史搜索
- IDE 插件
- 支付系统
- 移动端 App
- 数据分析看板
```

### 1.3 成功标准
| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 注册用户数 | 50+ | 数据库统计 |
| 活跃会话数 | 20+ | 周活会话 |
| 核心功能可用性 | 无 P0 Bug | 测试报告 |
| 用户满意度 | >4.0/5.0 | 用户访谈 |
| WebSocket 延迟 | <1 秒 | 性能监控 |

---

## 2. 技术栈确认

### 2.1 后端
- **运行时：** Node.js 20 LTS
- **框架：** Fastify
- **WebSocket:** Socket.io
- **数据库：** PostgreSQL 15
- **缓存：** Redis 7
- **ORM:** Prisma

### 2.2 前端
- **框架：** React 18
- **构建：** Vite
- **UI:** Tailwind CSS + shadcn/ui
- **状态管理：** Zustand
- **WebSocket 客户端：** Socket.io Client

### 2.3 基础设施
- **容器化：** Docker + Docker Compose
- **部署：** 本地服务器（初期）
- **监控：** Sentry（错误追踪）

---

## 3. 开发任务拆解

### 3.1 第 1 周：基础架构搭建

#### Week 1 - Sprint 目标
- [ ] 项目脚手架完成
- [ ] 数据库设计实现
- [ ] 基础认证系统可用
- [ ] WebSocket 服务跑通

---

#### Task 1.1: 项目初始化
**ID:** DEV-001  
**优先级：** P0  
**预估工时：** 4 小时  
**负责人：** 后端开发  

**任务描述：**
创建项目基础结构，配置开发环境

**子任务：**
- [ ] 创建 Git 仓库，配置分支策略（main/develop/feature）
- [ ] 初始化后端项目（Fastify + TypeScript）
- [ ] 初始化前端项目（Vite + React + TypeScript）
- [ ] 配置 Docker Compose（PostgreSQL + Redis）
- [ ] 配置 ESLint + Prettier + Husky
- [ ] 创建 README.md 和贡献指南

**验收标准：**
```bash
# 后端
cd server && npm install && npm run dev
# 访问 http://localhost:3000/health 返回 200

# 前端
cd web && npm install && npm run dev
# 访问 http://localhost:5173 显示欢迎页

# 数据库
docker-compose up -d postgres redis
# psql 连接成功
```

**交付物：**
- [ ] Git 仓库初始化
- [ ] package.json 配置文件
- [ ] tsconfig.json 配置
- [ ] docker-compose.yml
- [ ] .env.example 模板

---

#### Task 1.2: 数据库 Schema 实现
**ID:** DEV-002  
**优先级：** P0  
**预估工时：** 6 小时  
**负责人：** 后端开发  

**任务描述：**
使用 Prisma 实现数据库 Schema

**子任务：**
- [ ] 安装 Prisma CLI
- [ ] 编写 schema.prisma（users, workspaces, sessions, messages, tasks 表）
- [ ] 创建迁移文件
- [ ] 执行迁移
- [ ] 创建种子数据脚本

**验收标准：**
```prisma
// schema.prisma 包含以下模型：
- User (id, email, passwordHash, name, avatarUrl, createdAt)
- Workspace (id, ownerId, name, description, plan, createdAt)
- Session (id, workspaceId, creatorId, name, description, visibility, createdAt)
- SessionMember (sessionId, userId, role, joinedAt)
- Message (id, sessionId, userId, type, content, metadata, timestamp, editedAt)
- Task (id, sessionId, title, description, status, priority, assigneeId, createdAt)
```

**交付物：**
- [ ] prisma/schema.prisma
- [ ] prisma/migrations/ 迁移文件
- [ ] prisma/seed.ts 种子脚本

---

#### Task 1.3: 用户认证系统
**ID:** DEV-003  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 后端开发  

**任务描述：**
实现用户注册、登录、JWT 认证

**子任务：**
- [ ] 实现密码哈希（bcrypt）
- [ ] 实现注册接口（POST /api/auth/register）
- [ ] 实现登录接口（POST /api/auth/login）
- [ ] 实现 JWT Token 生成和验证
- [ ] 实现刷新 Token 机制
- [ ] 实现认证中间件
- [ ] 实现邮箱验证（可选，MVP 可简化）

**API 设计：**
```typescript
// POST /api/auth/register
interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}
interface RegisterResponse {
  user: { id: string; email: string; name: string };
  token: string;
  refreshToken: string;
}

// POST /api/auth/login
interface LoginRequest {
  email: string;
  password: string;
}
interface LoginResponse {
  user: { id: string; email: string; name: string };
  token: string;
  refreshToken: string;
}

// POST /api/auth/refresh
interface RefreshRequest {
  refreshToken: string;
}
interface RefreshResponse {
  token: string;
  refreshToken: string;
}
```

**验收标准：**
- [ ] 注册后密码加密存储
- [ ] 登录成功返回 JWT Token
- [ ] Token 有效期 24 小时
- [ ] 受保护接口需要 Bearer Token
- [ ] Token 过期返回 401

**交付物：**
- [ ] server/routes/auth.ts
- [ ] server/middleware/auth.ts
- [ ] server/utils/password.ts
- [ ] server/utils/jwt.ts
- [ ] 单元测试覆盖率 >80%

---

#### Task 1.4: WebSocket 服务搭建
**ID:** DEV-004  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 后端开发  

**任务描述：**
搭建 Socket.io 服务，实现基础连接管理

**子任务：**
- [ ] 安装 Socket.io
- [ ] 实现 WebSocket 服务器初始化
- [ ] 实现连接认证（从 Token 获取用户信息）
- [ ] 实现加入/离开会话房间
- [ ] 实现基础消息广播
- [ ] 实现断线重连处理
- [ ] 实现连接状态监控

**代码示例：**
```typescript
// server/websocket/index.ts
import { Server } from 'socket.io';

export function setupWebSocket(server: HTTPServer) {
  const io = new Server(server, {
    cors: { origin: process.env.FRONTEND_URL },
  });
  
  io.use(async (socket, next) => {
    // 认证中间件
    const token = socket.handshake.auth.token;
    const user = await verifyToken(token);
    if (!user) return next(new Error('Authentication failed'));
    socket.user = user;
    next();
  });
  
  io.on('connection', (socket) => {
    console.log(`User ${socket.user.id} connected`);
    
    socket.on('join_session', (sessionId) => {
      socket.join(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit('user_joined', {
        userId: socket.user.id,
      });
    });
    
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.id} disconnected`);
    });
  });
  
  return io;
}
```

**验收标准：**
- [ ] 客户端可以成功连接 WebSocket
- [ ] 认证失败连接被拒绝
- [ ] 可以加入会话房间
- [ ] 消息可以广播给房间内其他用户
- [ ] 断线后可以重连

**交付物：**
- [ ] server/websocket/index.ts
- [ ] server/websocket/handlers.ts
- [ ] WebSocket 连接测试脚本

---

#### Task 1.5: 前端基础框架
**ID:** DEV-005  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 前端开发  

**任务描述：**
搭建前端基础框架，实现路由和布局

**子任务：**
- [ ] 配置 Vite + React + TypeScript
- [ ] 安装 Tailwind CSS + shadcn/ui
- [ ] 配置 React Router
- [ ] 实现基础布局（Header + Sidebar + Content）
- [ ] 实现登录/注册页面
- [ ] 配置 Zustand 状态管理
- [ ] 配置 Axios 拦截器（自动添加 Token）

**页面结构：**
```
web/src/
├── components/
│   ├── ui/           # shadcn/ui 组件
│   ├── layout/       # 布局组件
│   └── common/       # 通用组件
├── pages/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Dashboard.tsx
│   └── Session.tsx
├── stores/
│   ├── auth.ts       # 认证状态
│   └── session.ts    # 会话状态
├── hooks/
│   ├── useAuth.ts
│   └── useSocket.ts
├── services/
│   ├── api.ts        # API 客户端
│   └── websocket.ts  # WebSocket 客户端
└── App.tsx
```

**验收标准：**
- [ ] 可以访问 /login 和 /register 页面
- [ ] 登录成功后跳转到 /dashboard
- [ ] 未登录访问受保护页面重定向到登录页
- [ ] 响应式布局（支持移动端）

**交付物：**
- [ ] 完整的前端项目结构
- [ ] 登录/注册页面
- [ ] 基础布局组件
- [ ] 状态管理配置

---

### 3.2 第 2 周：核心功能开发

#### Week 2 - Sprint 目标
- [ ] 工作区和会话管理完成
- [ ] 消息发送和同步完成
- [ ] AI 对话集成完成

---

#### Task 2.1: 工作区管理
**ID:** DEV-006  
**优先级：** P0  
**预估工时：** 6 小时  
**负责人：** 后端开发  

**任务描述：**
实现工作区 CRUD 接口

**API 设计：**
```typescript
// POST /api/workspaces
interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

// GET /api/workspaces
interface ListWorkspacesResponse {
  workspaces: Array<{
    id: string;
    name: string;
    description?: string;
    role: string;  // 当前用户角色
  }>;
}

// GET /api/workspaces/:id
interface GetWorkspaceResponse {
  id: string;
  name: string;
  description?: string;
  members: Array<{ userId: string; name: string; role: string }>;
  sessions: Array<{ id: string; name: string }>;
}
```

**验收标准：**
- [ ] 创建者自动成为工作区管理员
- [ ] 可以列出用户加入的所有工作区
- [ ] 可以查看工作区详情和成员列表

---

#### Task 2.2: 会话管理
**ID:** DEV-007  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 后端开发  

**任务描述：**
实现会话 CRUD 接口

**API 设计：**
```typescript
// POST /api/sessions
interface CreateSessionRequest {
  workspaceId: string;
  name: string;
  description?: string;
  visibility: 'public' | 'invite_only' | 'private';
}

// GET /api/sessions/:id
interface GetSessionResponse {
  id: string;
  name: string;
  description?: string;
  visibility: string;
  members: Array<{ userId: string; name: string; role: string }>;
  recentMessages: Array<Message>;
}

// POST /api/sessions/:id/members
interface InviteMemberRequest {
  email: string;
  role: 'member' | 'observer';
}
```

**验收标准：**
- [ ] 创建会话时设置可见性
- [ ] 生成邀请链接（invite_only 模式）
- [ ] 可以邀请成员加入会话
- [ ] 成员有不同权限（admin/member/observer）

---

#### Task 2.3: 消息系统
**ID:** DEV-008  
**优先级：** P0  
**预估工时：** 12 小时  
**负责人：** 后端开发  

**任务描述：**
实现消息 CRUD 和实时同步

**子任务：**
- [ ] 实现发送消息接口（POST /api/sessions/:id/messages）
- [ ] 实现获取历史消息接口（GET /api/sessions/:id/messages）
- [ ] 实现消息编辑接口（PATCH /api/messages/:id）
- [ ] 实现消息删除接口（DELETE /api/messages/:id）
- [ ] WebSocket 实时推送新消息
- [ ] 消息分页（每次 50 条）
- [ ] 消息类型支持（text/code/ai_response）

**WebSocket 事件：**
```typescript
// 客户端 → 服务端
socket.emit('send_message', {
  sessionId: string,
  content: string,
  type: 'text' | 'code',
});

// 服务端 → 客户端
socket.on('new_message', (message: Message) => {
  // 添加到消息列表
});

socket.on('message_edited', (data: { messageId: string; content: string }) => {
  // 更新消息
});
```

**验收标准：**
- [ ] 发送消息后 1 秒内同步给所有在线成员
- [ ] 历史消息按时间倒序排列
- [ ] 支持 Markdown 渲染
- [ ] 支持代码块高亮
- [ ] 消息可以编辑和删除

---

#### Task 2.4: AI 对话集成
**ID:** DEV-009  
**优先级：** P0  
**预估工时：** 12 小时  
**负责人：** 后端开发  

**任务描述：**
集成 Claude API，实现 AI 对话

**子任务：**
- [ ] 实现 AI Gateway（统一接口）
- [ ] 集成 Claude API（流式）
- [ ] 实现会话 AI Key 管理（加密存储）
- [ ] 实现@AI 触发机制
- [ ] 实现 AI 响应流式推送
- [ ] 实现 Token 使用统计

**API 设计：**
```typescript
// POST /api/sessions/:id/ai/chat
interface AIChatRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  stream?: boolean;
}

// WebSocket 事件
socket.emit('ai_chat', {
  sessionId: string,
  messages: [...],
  model: 'claude-sonnet-4-20250514',
});

socket.on('ai_chunk', (chunk: {
  content: string;
  isComplete: boolean;
  model?: string;
}) => {
  // 流式显示 AI 响应
});
```

**验收标准：**
- [ ] 可以配置会话的 Claude API Key
- [ ] API Key 加密存储
- [ ] @AI 或 /ai 命令触发 AI 对话
- [ ] AI 响应流式显示
- [ ] AI 消息标记为 ai_response 类型

---

#### Task 2.5: 前端会话界面
**ID:** DEV-010  
**优先级：** P0  
**预估工时：** 16 小时  
**负责人：** 前端开发  

**任务描述：**
实现会话主界面（类似聊天界面）

**子任务：**
- [ ] 实现会话列表页面
- [ ] 实现会话详情页面（消息列表）
- [ ] 实现消息输入框（支持 Markdown）
- [ ] 实现消息气泡组件
- [ ] 实现@提及功能
- [ ] 实现代码块渲染（Prism.js）
- [ ] 实现 WebSocket 连接管理
- [ ] 实现消息实时同步

**界面组件：**
```
SessionPage/
├── SessionHeader/      # 会话标题和成员
├── MessageList/        # 消息列表
│   └── MessageBubble/  # 单条消息
│       ├── Avatar/
│       ├── Content/    # Markdown 渲染
│       └── Actions/    # 编辑/删除
├── MessageInput/       # 输入框
│   ├── Toolbar/        # 格式工具
│   └── SendButton/
└── MemberList/         # 成员侧边栏
```

**验收标准：**
- [ ] 可以切换不同会话
- [ ] 消息列表自动滚动到底部
- [ ] 新消息实时显示
- [ ] 支持发送文本和代码
- [ ] 支持@提及成员
- [ ] 显示消息发送者和时间

---

### 3.3 第 3 周：任务系统

#### Week 3 - Sprint 目标
- [ ] 任务卡片系统完成
- [ ] 任务看板视图完成
- [ ] 基础通知系统完成

---

#### Task 3.1: 任务管理
**ID:** DEV-011  
**优先级：** P0  
**预估工时：** 10 小时  
**负责人：** 后端开发  

**任务描述：**
实现任务 CRUD 接口

**API 设计：**
```typescript
// POST /api/tasks
interface CreateTaskRequest {
  sessionId: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  dueDate?: string;
  sourceMessageId?: string;  // 关联的消息
}

// PATCH /api/tasks/:id
interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority?: string;
  assigneeId?: string;
}

// GET /api/sessions/:id/tasks
interface ListTasksResponse {
  tasks: Task[];
}
```

**验收标准：**
- [ ] 可以从消息创建任务（一键转换）
- [ ] 任务有状态机（todo → in_progress → done）
- [ ] 可以分配负责人
- [ ] 可以设置优先级和截止日期
- [ ] 状态变更实时同步

---

#### Task 3.2: 任务看板
**ID:** DEV-012  
**优先级：** P1  
**预估工时：** 12 小时  
**负责人：** 前端开发  

**任务描述：**
实现任务看板视图（类似 Trello）

**子任务：**
- [ ] 实现看板布局（按状态分组）
- [ ] 实现任务卡片组件
- [ ] 实现拖拽变更状态（dnd-kit）
- [ ] 实现任务详情弹窗
- [ ] 实现筛选和排序
- [ ] 实现进度统计

**界面组件：**
```
TaskBoard/
├── BoardHeader/        # 标题和筛选
├── TaskColumn/         # 状态列
│   ├── ColumnHeader/   # 列标题和计数
│   └── TaskCard[]/     # 任务卡片
│       ├── Title/
│       ├── Assignee/
│       ├── Priority/
│       └── DueDate/
└── TaskDetailModal/    # 任务详情
```

**验收标准：**
- [ ] 按状态分组显示任务
- [ ] 可以拖拽任务变更状态
- [ ] 显示任务关键信息
- [ ] 可以点击查看详情
- [ ] 支持筛选（按负责人/优先级）

---

#### Task 3.3: 通知系统
**ID:** DEV-013  
**优先级：** P1  
**预估工时：** 8 小时  
**负责人：** 后端开发  

**任务描述：**
实现基础站内通知

**子任务：**
- [ ] 实现通知表（notifications）
- [ ] 实现创建通知接口
- [ ] 实现获取通知列表接口
- [ ] 实现标记已读接口
- [ ] WebSocket 推送新通知
- [ ] 实现通知触发场景（@提及、任务分配）

**数据库设计：**
```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String
  type      String   // mention, task_assigned, task_updated
  title     String
  content   String
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id])
}
```

**验收标准：**
- [ ] 被@时收到通知
- [ ] 被分配任务时收到通知
- [ ] 通知中心显示未读数量
- [ ] 可以标记为已读

---

### 3.4 第 4 周：测试和优化

#### Week 4 - Sprint 目标
- [ ] 端到端测试完成
- [ ] 性能优化完成
- [ ] 部署脚本完成
- [ ] MVP 发布准备

---

#### Task 4.1: 端到端测试
**ID:** DEV-014  
**优先级：** P0  
**预估工时：** 16 小时  
**负责人：** 全栈开发  

**任务描述：**
编写端到端测试用例

**子任务：**
- [ ] 配置 Playwright
- [ ] 编写用户注册/登录测试
- [ ] 编写创建会话测试
- [ ] 编写发送消息测试
- [ ] 编写 AI 对话测试
- [ ] 编写任务管理测试
- [ ] 编写 WebSocket 同步测试

**测试用例示例：**
```typescript
// tests/e2e/session.spec.ts
test('用户可以创建会话并发送消息', async ({ page }) => {
  // 1. 登录
  await page.goto('/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');
  
  // 2. 创建会话
  await page.click('button:has-text("新建会话")');
  await page.fill('[name=sessionName]', '测试会话');
  await page.click('button:has-text("创建")');
  
  // 3. 发送消息
  await page.fill('[name=message]', 'Hello, World!');
  await page.click('button:has-text("发送")');
  
  // 4. 验证消息显示
  await expect(page.locator('.message')).toContainText('Hello, World!');
});
```

**验收标准：**
- [ ] 核心功能测试覆盖率 >80%
- [ ] 所有 P0 功能有测试覆盖
- [ ] CI 自动运行测试

---

#### Task 4.2: 性能优化
**ID:** DEV-015  
**优先级：** P1  
**预估工时：** 12 小时  
**负责人：** 后端开发  

**任务描述：**
优化系统性能

**子任务：**
- [ ] 数据库查询优化（添加索引）
- [ ] 消息列表分页优化
- [ ] WebSocket 连接池优化
- [ ] 前端资源压缩
- [ ] 图片懒加载
- [ ] 虚拟列表（消息列表）

**性能目标：**
- [ ] 页面加载 <2 秒
- [ ] 消息同步延迟 <1 秒
- [ ] 支持 50+ 并发用户

---

#### Task 4.3: 部署脚本
**ID:** DEV-016  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 后端开发  

**任务描述：**
编写部署脚本和文档

**子任务：**
- [ ] 编写生产环境 Docker Compose
- [ ] 编写数据库迁移脚本
- [ ] 编写环境变量配置模板
- [ ] 编写部署文档
- [ ] 配置 Sentry 错误监控
- [ ] 配置日志收集

**交付物：**
- [ ] docker-compose.prod.yml
- [ ] deploy.sh 部署脚本
- [ ] .env.production.example
- [ ] DEPLOYMENT.md 部署文档

---

#### Task 4.4: MVP 发布准备
**ID:** DEV-017  
**优先级：** P0  
**预估工时：** 8 小时  
**负责人：** 全员  

**任务描述：**
准备 MVP 发布

**子任务：**
- [ ] 编写用户手册
- [ ] 准备演示视频
- [ ] 创建反馈收集表单
- [ ] 准备内测用户邀请名单
- [ ] 配置域名和 SSL 证书
- [ ] 执行最终回归测试

**交付物：**
- [ ] USER_GUIDE.md
- [ ] demo.mp4 演示视频
- [ ] 反馈表单链接
- [ ] 生产环境部署完成

---

## 4. 任务汇总表

### 4.1 按优先级统计
| 优先级 | 任务数 | 总工时 |
|--------|--------|--------|
| P0 | 12 | 96 小时 |
| P1 | 5 | 48 小时 |
| **总计** | **17** | **144 小时** |

### 4.2 按模块统计
| 模块 | 任务数 | 工时 |
|------|--------|------|
| 基础架构 | 5 | 34 小时 |
| 会话和消息 | 4 | 44 小时 |
| AI 集成 | 1 | 12 小时 |
| 任务系统 | 2 | 22 小时 |
| 通知系统 | 1 | 8 小时 |
| 测试和部署 | 4 | 44 小时 |

### 4.3 按人员统计（2 人团队）
| 角色 | 工时 | 周数 |
|------|------|------|
| 后端开发 | 72 小时 | 3.6 周 |
| 前端开发 | 56 小时 | 2.8 周 |
| 全栈/测试 | 16 小时 | 0.8 周 |

---

## 5. 风险管理

### 5.1 技术风险
| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| WebSocket 性能问题 | 中 | 高 | 早期压力测试，准备降级方案 |
| AI API 成本超支 | 中 | 中 | 设置使用限额，用户自带 Key |
| 数据库性能瓶颈 | 低 | 高 | 提前设计索引，准备读写分离 |

### 5.2 进度风险
| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 任务估算不足 | 高 | 中 | 每周回顾，调整优先级 |
| 人员短缺 | 中 | 高 | 准备外包备选方案 |
| 需求变更 | 中 | 中 | 严格 MVP 范围，V1.0 后再扩展 |

---

## 6. 里程碑

### Milestone 1: 基础架构完成（Week 1 结束）
- [ ] 项目脚手架完成
- [ ] 数据库 Schema 实现
- [ ] 认证系统可用
- [ ] WebSocket 服务跑通

### Milestone 2: 核心功能完成（Week 2 结束）
- [ ] 工作区和会话管理完成
- [ ] 消息系统完成
- [ ] AI 对话集成完成
- [ ] 前端会话界面完成

### Milestone 3: 任务系统完成（Week 3 结束）
- [ ] 任务 CRUD 完成
- [ ] 任务看板完成
- [ ] 通知系统完成

### Milestone 4: MVP 发布（Week 4 结束）
- [ ] 端到端测试完成
- [ ] 性能优化完成
- [ ] 部署完成
- [ ] 内测用户邀请

---

## 7. 下一步行动

### 本周（Week 1）
- [ ] **立即开始：** Task 1.1 项目初始化
- [ ] **并行进行：** Task 1.5 前端基础框架
- [ ] **周中检查：** Task 1.2 数据库 Schema
- [ ] **周末完成：** Task 1.3 认证系统 + Task 1.4 WebSocket

### 下周计划
- [ ] 开始 Week 2 任务（会话和消息系统）
- [ ] 确认 AI API Key 配置
- [ ] 准备 UI 设计稿

---

**文档状态：** 可执行  
**负责人：** 拿铁（项目决策）+ 开发团队  
**更新频率：** 每周 Sprint 回顾后更新  

**最后更新：** 2026-04-14  
**下次更新：** 2026-04-21（Week 1 结束后）
