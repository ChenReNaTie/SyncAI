# SyncAI / 灵悉 AI - 技术架构设计

**文档编号：** ARCH-2026-001  
**版本：** v1.0  
**创建时间：** 2026-04-14  
**撰写人：** 阿铁 ⚓  
**状态：** 待评审

---

## 1. 架构概述

### 1.1 架构原则
1. **云原生优先** - 容器化、微服务、自动扩缩容
2. **实时性优先** - WebSocket -first 设计，低延迟同步
3. **安全内建** - 安全不是附加功能，是设计基础
4. **渐进式复杂** - MVP 简单直接，预留扩展空间

### 1.2 整体架构图
```
┌─────────────────────────────────────────────────────────────────────┐
│                          客户端层 (Client Layer)                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Web App   │  │  VS Code    │  │  JetBrains  │  │  Mobile     │ │
│  │  (React)    │  │  Extension  │  │   Plugin    │  │    App      │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                                    │                                 │
│                              WebSocket/HTTPS                         │
└────────────────────────────────────┼──────────────────────────────────┘
                                     │
┌────────────────────────────────────┼──────────────────────────────────┐
│                          网关层 (Gateway Layer)                        │
├────────────────────────────────────┼──────────────────────────────────┤
│                            ┌───────▼───────┐                          │
│                            │   API Gateway │                          │
│                            │   (Kong/      │                          │
│                            │    Traefik)   │                          │
│                            └───────┬───────┘                          │
│                                    │                                   │
│                    ┌───────────────┼───────────────┐                  │
│                    │               │               │                   │
│              ┌─────▼─────┐  ┌──────▼──────┐  ┌────▼────┐            │
│              │   Auth    │  │  Rate Limit │  │  CORS   │            │
│              │  Middleware│  │  Middleware │  │Middleware│          │
│              └───────────┘  └─────────────┘  └─────────┘            │
└────────────────────────────────────┼──────────────────────────────────┘
                                     │
┌────────────────────────────────────┼──────────────────────────────────┐
│                        应用服务层 (Application Layer)                  │
├────────────────────────────────────┼──────────────────────────────────┤
│                                    │                                   │
│  ┌─────────────────────────────────┼─────────────────────────────────┐│
│  │                           WebSocket Service                        ││
│  │  ┌─────────────────────────────────────────────────────────────┐  ││
│  │  │              Socket.io Cluster (多实例)                      │  ││
│  │  │  - 会话管理                                                 │  ││
│  │  │  - 消息广播                                                 │  ││
│  │  │  - 连接状态维护                                             │  ││
│  │  └─────────────────────────────────────────────────────────────┘  ││
│  └───────────────────────────────────────────────────────────────────┘│
│                                    │                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │  User Service│  │ Session Svc │  │  Message Svc │  │  Task Svc  ││
│  │  - 用户管理  │  │  - 会话 CRUD │  │  - 消息 CRUD │  │ - 任务 CRUD││
│  │  - 认证授权  │  │  - 成员管理  │  │  - 搜索索引  │  │ - 状态机   ││
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘│
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐   │
│  │  Knowledge   │  │  Notify Svc │  │   AI Gateway │  │  Export    │   │
│  │  Service     │  │  - 站内信   │  │  - Claude    │  │  Service   │   │
│  │  - 知识库    │  │  - 邮件    │  │  - GPT-4     │  │  - JSON    │   │
│  │  - 归档      │  │  - Webhook │  │  - 流式处理  │  │  - CSV     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘   │
└────────────────────────────────────┼──────────────────────────────────┘
                                     │
┌────────────────────────────────────┼──────────────────────────────────┐
│                          数据层 (Data Layer)                           │
├────────────────────────────────────┼──────────────────────────────────┤
│                                    │                                   │
│  ┌──────────────────┐   ┌─────────▼─────────┐   ┌──────────────────┐ │
│  │   PostgreSQL     │   │      Redis        │   │   Elasticsearch  │ │
│  │   (主数据库)      │   │   (缓存 + 会话)    │   │   (全文搜索)      │ │
│  │                  │   │                   │   │                   │ │
│  │ - users          │   │ - session_store   │   │ - messages_index  │ │
│  │ - workspaces     │   │ - websocket_rooms │   │ - knowledge_index │ │
│  │ - sessions       │   │ - rate_limit      │   │                   │ │
│  │ - messages       │   │ - notification_q  │   │                   │ │
│  │ - tasks          │   │                   │   │                   │ │
│  │ - knowledge_base │   │                   │   │                   │ │
│  └──────────────────┘   └───────────────────┘   └──────────────────┘ │
│                                                                            │
│  ┌──────────────────┐   ┌──────────────────┐                             │
│  │   Object Storage │   │   Message Queue  │                             │
│  │   (S3/MinIO)     │   │   (Redis Streams)│                             │
│  │                  │   │                  │                             │
│  │ - attachments    │   │ - async_tasks    │                             │
│  │ - avatars        │   │ - email_queue    │                             │
│  │ - exports        │   │ - webhook_queue  │                             │
│  └──────────────────┘   └──────────────────┘                             │
└──────────────────────────────────────────────────────────────────────────┘

                                     │
┌────────────────────────────────────┼──────────────────────────────────┐
│                        外部服务层 (External Services)                  │
├────────────────────────────────────┼──────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Anthropic  │  │   OpenAI    │  │   Stripe    │  │  SendGrid   │  │
│  │  (Claude)   │  │   (GPT-4)   │  │  (支付)     │  │  (邮件)     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Google    │  │   GitHub    │  │   Sentry    │  │  Datadog    │  │
│  │   OAuth     │  │   OAuth     │  │  (监控)     │  │  (APM)      │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 技术选型

### 2.1 后端技术栈

| 组件 | 技术选型 | 理由 | 备选方案 |
|------|----------|------|----------|
| **运行时** | Node.js 20 LTS | 高性能异步 I/O，适合 WebSocket 场景 | Deno、Bun |
| **Web 框架** | Fastify | 性能最优（比 Express 快 2-3 倍），低开销 | Express、NestJS |
| **WebSocket** | Socket.io | 成熟稳定，支持房间、广播、断线重连 | ws、uWebSockets.js |
| **数据库** | PostgreSQL 15 | ACID 事务，JSONB 支持，扩展性强 | MySQL 8、TiDB |
| **缓存** | Redis 7 | 高性能，支持 Streams（消息队列） | Memcached、KeyDB |
| **搜索引擎** | Elasticsearch 8 | 全文搜索，高亮，聚合分析 | Meilisearch、Algolia |
| **对象存储** | AWS S3 / MinIO | 标准 S3 协议，自建/云端灵活切换 | Cloudflare R2 |
| **消息队列** | Redis Streams | 轻量，无需额外组件，与缓存复用 | BullMQ、RabbitMQ |

### 2.2 前端技术栈

| 组件 | 技术选型 | 理由 | 备选方案 |
|------|----------|------|----------|
| **框架** | React 18 | 生态丰富，人才储备多 | Vue 3、Svelte |
| **构建工具** | Vite | 极速开发体验，HMR | Next.js、Remix |
| **状态管理** | Zustand | 轻量，简单，适合中小项目 | Redux Toolkit、Jotai |
| **UI 组件** | Tailwind CSS + shadcn/ui | 快速开发，高度可定制 | Ant Design、MUI |
| **WebSocket 客户端** | Socket.io Client | 与服务端配套，自动重连 | 原生 WebSocket |
| **PWA** | Vite PWA Plugin | 离线缓存，桌面安装 | Workbox |

### 2.3 IDE 插件技术栈

| 组件 | VS Code | JetBrains |
|------|---------|-----------|
| **语言** | TypeScript | Kotlin/Java |
| **框架** | VS Code Extension API | IntelliJ Platform SDK |
| **UI** | Webview (React) | JCEF (Chromium) |
| **通信** | WebSocket 直连 | WebSocket 直连 |

### 2.4 基础设施

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| **容器化** | Docker + Docker Compose | 标准化部署，本地开发一致 |
| **编排** | Kubernetes (可选) | 自动扩缩容，高可用 |
| **CI/CD** | GitHub Actions | 免费，集成好 |
| **监控** | Sentry + Datadog | 错误追踪 + 性能监控 |
| **日志** | Winston + ELK | 结构化日志，集中管理 |

---

## 3. 核心模块设计

### 3.1 WebSocket 服务设计

#### 3.1.1 连接管理
```typescript
// server/services/websocket-service.ts

interface WebSocketSession {
  userId: string;
  sessionId: string;  // 业务会话 ID
  socketId: string;   // Socket.io 连接 ID
  joinedAt: number;
  lastActive: number;
}

class WebSocketService {
  private io: Server;
  private userSockets: Map<string, Set<string>> = new Map();  // userId -> socketIds
  private sessionUsers: Map<string, Set<string>> = new Map(); // sessionId -> userIds
  
  async handleConnection(socket: Socket) {
    // 1. 认证
    const user = await this.authenticate(socket.handshake.auth.token);
    if (!user) {
      socket.disconnect();
      return;
    }
    
    // 2. 记录连接
    this.userSockets.set(user.id, this.userSockets.get(user.id) || new Set());
    this.userSockets.get(user.id)!.add(socket.id);
    
    // 3. 加入会话房间
    socket.on('join_session', async (sessionId) => {
      await this.joinSession(socket, user.id, sessionId);
    });
    
    // 4. 发送消息
    socket.on('send_message', async (data) => {
      await this.handleSendMessage(socket, user.id, data);
    });
    
    // 5. 断开处理
    socket.on('disconnect', () => {
      this.handleDisconnect(socket, user.id);
    });
  }
  
  private async joinSession(socket: Socket, userId: string, sessionId: string) {
    socket.join(`session:${sessionId}`);
    
    // 记录会话 - 用户关系
    if (!this.sessionUsers.has(sessionId)) {
      this.sessionUsers.set(sessionId, new Set());
    }
    this.sessionUsers.get(sessionId)!.add(userId);
    
    // 广播用户上线
    socket.to(`session:${sessionId}`).emit('user_joined', {
      userId,
      timestamp: Date.now(),
    });
    
    // 同步历史消息（最近 50 条）
    const history = await this.getRecentMessages(sessionId, 50);
    socket.emit('history_sync', history);
  }
  
  private async handleSendMessage(socket: Socket, userId: string, data: any) {
    const { sessionId, content, type } = data;
    
    // 1. 保存消息到数据库
    const message = await this.messageService.create({
      sessionId,
      userId,
      content,
      type,
      timestamp: Date.now(),
    });
    
    // 2. 广播给会话内所有用户（包括发送者）
    this.io.to(`session:${sessionId}`).emit('new_message', {
      ...message,
      sender: { id: userId, name: await this.getUserName(userId) },
    });
    
    // 3. 如果是 AI 消息，触发通知
    if (type === 'ai_response') {
      await this.notifyService.notifySessionMembers(sessionId, {
        type: 'ai_response',
        messageId: message.id,
      });
    }
  }
}
```

#### 3.1.2 消息同步协议
```typescript
// 客户端 → 服务端
interface ClientMessage {
  type: 'send_message' | 'edit_message' | 'delete_message' | 'typing' | 'join_session' | 'leave_session';
  payload: any;
  requestId: string;  // 用于去重和确认
}

// 服务端 → 客户端
interface ServerMessage {
  type: 'new_message' | 'message_edited' | 'message_deleted' | 'user_joined' | 'user_left' | 'history_sync' | 'ack';
  payload: any;
  timestamp: number;
}

// 消息数据结构
interface Message {
  id: string;           // UUID
  sessionId: string;
  userId: string;
  type: 'text' | 'code' | 'file' | 'ai_response' | 'system';
  content: string;      // Markdown 格式
  metadata?: {
    model?: string;     // AI 模型标识
    codeLanguage?: string;
    fileId?: string;
    fileName?: string;
  };
  timestamp: number;
  editedAt?: number;
  deletedAt?: number;
}
```

### 3.2 数据库设计

#### 3.2.1 ER 图
```
┌─────────────────────────────────────────────────────────────────────┐
│                         SyncAI 数据库 ER 图                            │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   users      │       │  workspaces  │       │    sessions  │
├──────────────┤       ├──────────────┤       ├──────────────┤
│ id (PK)      │◄──────│ id (PK)      │       │ id (PK)      │
│ email        │   1:N │ owner_id(FK) │       │ workspace_id │───┐
│ password_hash│       │ name         │   1:N │ creator_id   │   │
│ name         │       │ created_at   │──────►│ name         │   │
│ avatar_url   │       │ plan         │       │ description  │   │
│ created_at   │       │              │       │ visibility   │   │
│              │       │              │       │ created_at   │   │
└──────────────┘       └──────────────┘       └──────────────┘   │
                                                                 │
┌──────────────┐       ┌──────────────┐       ┌──────────────┐   │
│session_members│      │   messages   │      │session_ai_keys│   │
├──────────────┤       ├──────────────┤       ├──────────────┤   │
│ session_id   │───┐   │ id (PK)      │       │ id (PK)      │   │
│ user_id      │───┼──►│ session_id   │───┐   │ session_id   │───┘
│ role         │   │   │ user_id      │   │   │ provider     │
│ joined_at    │   │   │ type         │   │   │ encrypted_key│
│              │   │   │ content      │   │   │ created_at   │
└──────────────┘   │   │ metadata     │   │   │              │
                   │   │ timestamp    │   │   └──────────────┘
                   │   │ edited_at    │   │
                   │   │ deleted_at   │   │   ┌──────────────┐
                   │   └──────────────┘   │   │    tasks     │
                   │                      │   ├──────────────┤
                   │   ┌──────────────┐   │   │ id (PK)      │
                   │   │task_comments │   │   │ session_id   │
                   │   ├──────────────┤   │   │ title        │
                   └──►│ id (PK)      │   │   │ description  │
                       │ task_id      │◄──┘   │ status       │
                       │ user_id      │       │ priority     │
                       │ content      │       │ assignee_id  │
                       │ created_at   │       │ due_date     │
                       └──────────────┘       │ created_at   │
                                              └──────────────┘
┌──────────────┐       ┌──────────────┐
│  knowledge   │       │  attachments │
├──────────────┤       ├──────────────┤
│ id (PK)      │       │ id (PK)      │
│ session_id   │       │ message_id   │
│ title        │       │ file_name    │
│ content      │       │ file_size    │
│ tags         │       │ storage_key  │
│ created_by   │       │ created_at   │
│ created_at   │       └──────────────┘
└──────────────┘
```

#### 3.2.2 核心表结构

```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(500),
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 工作区表
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  plan VARCHAR(20) DEFAULT 'free',  -- free, pro, business, enterprise
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 会话表
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  visibility VARCHAR(20) DEFAULT 'private',  -- public, invite_only, private
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 会话成员表
CREATE TABLE session_members (
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',  -- admin, member, observer
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

-- 消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(20) NOT NULL,  -- text, code, file, ai_response, system
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',  -- 存储 AI 模型、代码语言等
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  edited_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- 消息表索引
CREATE INDEX idx_messages_session_timestamp ON messages(session_id, timestamp DESC);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_type ON messages(type);

-- 全文搜索索引（使用 PostgreSQL tsvector）
ALTER TABLE messages ADD COLUMN search_vector tsvector;
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- 任务表
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'todo',  -- todo, in_progress, done, cancelled
  priority VARCHAR(20) DEFAULT 'medium',  -- low, medium, high, urgent
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  due_date TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 任务评论表
CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 知识库表
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  category_id UUID REFERENCES knowledge_base(id),  -- 支持多级分类
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 附件表
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100),
  storage_key VARCHAR(255) NOT NULL,  -- S3 key
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 会话 AI Key 表（加密存储用户 API Key）
CREATE TABLE session_ai_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,  -- anthropic, openai
  encrypted_key BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(session_id, provider)
);
```

### 3.3 AI 网关设计

#### 3.3.1 统一 AI 接口
```typescript
// server/services/ai-gateway.ts

interface AIProvider {
  id: 'anthropic' | 'openai' | 'azure';
  name: string;
  models: string[];
}

interface ChatRequest {
  sessionId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  model?: string;
  stream?: boolean;
  maxTokens?: number;
}

interface ChatChunk {
  type: 'text' | 'code' | 'thinking' | 'error';
  content: string;
  isComplete: boolean;
  metadata?: {
    model?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}

class AIGateway {
  private providers: Map<string, AIProvider> = new Map();
  
  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    // 1. 获取会话的 AI Key
    const aiKey = await this.getSessionAIKey(request.sessionId);
    if (!aiKey) {
      throw new Error('No AI key configured for this session');
    }
    
    // 2. 根据 provider 路由
    const provider = this.providers.get(aiKey.provider);
    if (!provider) {
      throw new Error(`Unknown provider: ${aiKey.provider}`);
    }
    
    // 3. 调用对应 API（流式）
    if (aiKey.provider === 'anthropic') {
      yield* this.callClaudeAPI(aiKey.encryptedKey, request);
    } else if (aiKey.provider === 'openai') {
      yield* this.callOpenAIAPI(aiKey.encryptedKey, request);
    }
  }
  
  private async *callClaudeAPI(encryptedKey: string, request: ChatRequest) {
    const apiKey = await this.decryptKey(encryptedKey);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || 'claude-sonnet-4-20250514',
        max_tokens: request.maxTokens || 8192,
        messages: request.messages,
        stream: true,
      }),
    });
    
    // 处理 SSE 流
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;  // 保留不完整行
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          
          if (data.type === 'content_block_delta') {
            yield {
              type: 'text',
              content: data.delta.text,
              isComplete: false,
            };
          } else if (data.type === 'message_delta') {
            yield {
              type: 'text',
              content: '',
              isComplete: true,
              metadata: {
                usage: {
                  promptTokens: data.usage.input_tokens,
                  completionTokens: data.usage.output_tokens,
                  totalTokens: data.usage.input_tokens + data.usage.output_tokens,
                },
              },
            };
          }
        }
      }
    }
  }
}
```

---

## 4. 部署架构

### 4.1 开发环境
```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: syncai
      POSTGRES_USER: syncai
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data

  api:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://syncai:dev_password@postgres:5432/syncai
      - REDIS_URL=redis://redis:6379
      - ELASTICSEARCH_URL=http://elasticsearch:9200
    volumes:
      - ./server:/app
      - /app/node_modules
    depends_on:
      - postgres
      - redis
      - elasticsearch

  web:
    build: ./web
    ports:
      - "5173:5173"
    volumes:
      - ./web:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=http://localhost:3000

volumes:
  postgres_data:
  redis_data:
  es_data:
```

### 4.2 生产环境（Kubernetes）
```yaml
# k8s/api-deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: syncai-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: syncai-api
  template:
    metadata:
      labels:
        app: syncai-api
    spec:
      containers:
      - name: api
        image: syncai/api:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: syncai-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: syncai-secrets
              key: redis-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: syncai-api
spec:
  selector:
    app: syncai-api
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

---

## 5. 安全设计

### 5.1 认证流程
```typescript
// JWT Token 结构
interface JWTPayload {
  userId: string;
  email: string;
  workspaceId?: string;
  iat: number;
  exp: number;  // 24 小时后过期
}

// 刷新 Token 机制
interface RefreshToken {
  id: string;
  userId: string;
  expiresAt: Date;  // 7 天
  revoked: boolean;
}
```

### 5.2 权限校验中间件
```typescript
// server/middleware/auth.ts

async function requireSessionMember(req: Request, res: Response, next: NextFunction) {
  const { sessionId } = req.params;
  const userId = req.user.id;
  
  const membership = await db.query(
    'SELECT role FROM session_members WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  
  if (!membership.rows.length) {
    return res.status(403).json({ error: 'Not a member of this session' });
  }
  
  req.sessionRole = membership.rows[0].role;
  next();
}

async function requireRole(requiredRole: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roleHierarchy = { observer: 0, member: 1, admin: 2 };
    
    if (roleHierarchy[req.sessionRole] < roleHierarchy[requiredRole]) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// 使用示例
router.post(
  '/sessions/:sessionId/messages',
  authenticate,
  requireSessionMember,
  requireRole('member'),
  sendMessageHandler
);
```

### 5.3 数据加密
```typescript
// server/utils/encryption.ts

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;  // 32 bytes
const IV_LENGTH = 16;

export function encrypt(text: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return Buffer.from(iv.toString('hex') + ':' + encrypted);
}

export function decrypt(buffer: Buffer): string {
  const parts = buffer.toString().split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

---

## 6. 性能优化

### 6.1 缓存策略
```typescript
// 多级缓存设计
class CacheService {
  // L1: 内存缓存（进程内）
  private memoryCache = new Map<string, { value: any; expiry: number }>();
  
  // L2: Redis 缓存（跨进程）
  private redis: Redis;
  
  async get(key: string): Promise<any> {
    // 1. 检查内存缓存
    const memValue = this.memoryCache.get(key);
    if (memValue && memValue.expiry > Date.now()) {
      return memValue.value;
    }
    
    // 2. 检查 Redis
    const redisValue = await this.redis.get(key);
    if (redisValue) {
      const parsed = JSON.parse(redisValue);
      this.memoryCache.set(key, { value: parsed, expiry: Date.now() + 5000 });
      return parsed;
    }
    
    return null;
  }
  
  async set(key: string, value: any, ttl: number = 3600) {
    // 同时写入内存和 Redis
    this.memoryCache.set(key, { value, expiry: Date.now() + 5000 });
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }
}
```

### 6.2 数据库优化
```sql
-- 1. 消息表分区（按月）
CREATE TABLE messages_2026_04 PARTITION OF messages
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- 2. 物化视图（任务统计）
CREATE MATERIALIZED VIEW task_stats AS
SELECT 
  session_id,
  status,
  COUNT(*) as count,
  COUNT(DISTINCT assignee_id) as unique_assignees
FROM tasks
GROUP BY session_id, status;

-- 3. 定期刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY task_stats;
```

---

## 7. 监控与告警

### 7.1 关键指标
| 指标 | 阈值 | 告警级别 |
|------|------|----------|
| API 错误率 | >1% | P1 |
| WebSocket 连接失败率 | >5% | P1 |
| 消息同步延迟 P95 | >2 秒 | P2 |
| 数据库连接池使用率 | >80% | P2 |
| 磁盘使用率 | >85% | P2 |
| 内存使用率 | >90% | P1 |

### 7.2 日志结构
```typescript
// 结构化日志格式
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  traceId: string;      // 请求追踪 ID
  userId?: string;
  sessionId?: string;
  message: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
```

---

## 8. 技术债务管理

### 8.1 MVP 阶段可以简化的地方
1. **单服务架构** - 初期不拆分微服务，单体应用 + 模块化
2. **PostgreSQL 全文搜索** - 暂不上 Elasticsearch，用 PG tsvector
3. **Redis 单节点** - 暂不集群，主从复制即可
4. **手动部署** - 暂不上 K8s，Docker Compose + 脚本

### 8.2 必须在 V1.0 前完成
1. **服务拆分** - WebSocket 服务独立部署
2. **数据库读写分离** - 主从架构
3. **CDN 接入** - 静态资源加速
4. **监控告警** - Sentry + Datadog 完整接入

---

**文档状态：** 待评审  
**评审人：** 拿铁  
**下次更新：** 根据技术验证和 MVP 开发反馈
