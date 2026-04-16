# SyncAI / 灵悉 AI - 数据库 ER 图设计

**文档编号：** DB-2026-001  
**版本：** v1.0  
**创建时间：** 2026-04-14  
**撰写人：** 阿铁 ⚓  
**数据库：** PostgreSQL 15

---

## 1. ER 图总览

### 1.1 概念 ER 图
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SyncAI 数据库 ER 图                               │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │    users     │
    └──────┬───────┘
           │ 1
           │
           │ N
    ┌──────▼────────┐         ┌──────────────┐
    │   workspaces  │◄────────│     users    │ (owner)
    └──────┬────────┘         └──────────────┘
           │ 1
           │
           │ N
    ┌──────▼────────┐
    │   sessions    │
    └──────┬────────┘
           │ 1
           │
     ┌─────┴─────┐
     │           │
     │ N         │ N
┌────▼─────┐  ┌──▼──────────┐
│ messages │  │session_members│
└────┬─────┘  └──┬──────────┘
     │            │
     │ 1          │ N
     │            │
     │       ┌────▼────┐
     │       │  users  │ (members)
     │       └─────────┘
     │
     │ 1
     │
     │ N
┌────▼──────────┐
│    tasks      │
└────┬──────────┘
     │
     │ 1
     │
     │ N
┌────▼──────────┐
│task_comments  │
└───────────────┘

┌──────────────┐       ┌──────────────┐
│ knowledge    │       │ attachments  │
└──────────────┘       └──────────────┘
```

### 1.2 物理模型图（完整）
```sql
-- ============================================
-- SyncAI 数据库完整 Schema
-- PostgreSQL 15
-- ============================================

-- 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 全文搜索

-- ============================================
-- 1. 用户系统
-- ============================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  avatar_url      VARCHAR(500),
  email_verified  BOOLEAN DEFAULT FALSE,
  plan            VARCHAR(20) DEFAULT 'free',  -- free, pro, business, enterprise
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at   TIMESTAMP WITH TIME ZONE
);

-- 用户索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);

-- ============================================
-- 2. 工作区
-- ============================================

CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  plan            VARCHAR(20) DEFAULT 'free',
  max_members     INTEGER DEFAULT 3,
  max_sessions    INTEGER DEFAULT 5,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 工作区索引
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

-- ============================================
-- 3. 工作区成员
-- ============================================

CREATE TABLE workspace_members (
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(20) DEFAULT 'member',  -- owner, admin, member, viewer
  joined_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  invited_by      UUID REFERENCES users(id),
  PRIMARY KEY (workspace_id, user_id)
);

-- ============================================
-- 4. 会话
-- ============================================

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  visibility      VARCHAR(20) DEFAULT 'private',  -- public, invite_only, private
  is_archived     BOOLEAN DEFAULT FALSE,
  ai_provider     VARCHAR(20),  -- anthropic, openai, null
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 会话索引
CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX idx_sessions_creator ON sessions(creator_id);
CREATE INDEX idx_sessions_visibility ON sessions(visibility);
CREATE INDEX idx_sessions_archived ON sessions(is_archived);

-- ============================================
-- 5. 会话成员
-- ============================================

CREATE TABLE session_members (
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(20) DEFAULT 'member',  -- admin, member, observer
  joined_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_read_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

-- 会话成员索引
CREATE INDEX idx_session_members_user ON session_members(user_id);

-- ============================================
-- 6. 消息
-- ============================================

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  type            VARCHAR(20) NOT NULL,  -- text, code, file, ai_response, system
  content         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  timestamp       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  edited_at       TIMESTAMP WITH TIME ZONE,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  
  -- 全文搜索
  search_vector   TSVECTOR
);

-- 消息索引
CREATE INDEX idx_messages_session_timestamp ON messages(session_id, timestamp DESC);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_type ON messages(type);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- 全文搜索索引
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- 全文搜索触发器
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('pg_catalog.simple', COALESCE(NEW.content, '')), 'A') ||
    setweight(to_tsvector('pg_catalog.simple', COALESCE(NEW.metadata::text, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();

-- ============================================
-- 7. 消息提及
-- ============================================

CREATE TABLE message_mentions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(message_id, mentioned_user_id)
);

-- ============================================
-- 8. 任务
-- ============================================

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'todo',  -- todo, in_progress, done, cancelled
  priority          VARCHAR(20) DEFAULT 'medium',  -- low, medium, high, urgent
  assignee_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  creator_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  due_date          TIMESTAMP WITH TIME ZONE,
  completed_at      TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 任务索引
CREATE INDEX idx_tasks_session ON tasks(session_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);

-- ============================================
-- 9. 任务评论
-- ============================================

CREATE TABLE task_comments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  parent_id       UUID REFERENCES task_comments(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 任务评论索引
CREATE INDEX idx_task_comments_task ON task_comments(task_id);
CREATE INDEX idx_task_comments_parent ON task_comments(parent_id);

-- ============================================
-- 10. 知识库
-- ============================================

CREATE TABLE knowledge_base (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  content         TEXT NOT NULL,
  tags            TEXT[] DEFAULT '{}',
  category_id     UUID REFERENCES knowledge_base(id),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  is_public       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 知识库索引
CREATE INDEX idx_knowledge_session ON knowledge_base(session_id);
CREATE INDEX idx_knowledge_category ON knowledge_base(category_id);
CREATE INDEX idx_knowledge_tags ON knowledge_base USING GIN(tags);

-- ============================================
-- 11. 附件
-- ============================================

CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
  file_name       VARCHAR(255) NOT NULL,
  file_size       BIGINT NOT NULL,
  mime_type       VARCHAR(100),
  storage_key     VARCHAR(255) NOT NULL,  -- S3 key
  download_count  INTEGER DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 附件索引
CREATE INDEX idx_attachments_message ON attachments(message_id);

-- ============================================
-- 12. 会话 AI Key（加密存储）
-- ============================================

CREATE TABLE session_ai_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID UNIQUE NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider        VARCHAR(20) NOT NULL,  -- anthropic, openai
  encrypted_key   BYTEA NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at    TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- 13. 通知
-- ============================================

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(30) NOT NULL,  -- mention, task_assigned, task_updated, member_joined
  title           VARCHAR(200) NOT NULL,
  content         TEXT,
  related_id      UUID,  -- 关联对象 ID（消息 ID、任务 ID 等）
  related_type    VARCHAR(30),  -- message, task, session
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 通知索引
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- ============================================
-- 14. 刷新 Token
-- ============================================

CREATE TABLE refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      VARCHAR(255) NOT NULL,
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 刷新 Token 索引
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token_hash);

-- ============================================
-- 15. 审计日志
-- ============================================

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,  -- create, update, delete, login, logout
  resource_type   VARCHAR(50) NOT NULL,  -- user, workspace, session, message, task
  resource_id     UUID,
  ip_address      INET,
  user_agent      TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 审计日志索引
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ============================================
-- 视图和物化视图
-- ============================================

-- 任务统计视图
CREATE OR REPLACE VIEW task_stats AS
SELECT 
  session_id,
  status,
  COUNT(*) as count,
  COUNT(DISTINCT assignee_id) as unique_assignees,
  COUNT(CASE WHEN due_date < NOW() AND status != 'done' THEN 1 END) as overdue_count
FROM tasks
GROUP BY session_id, status;

-- 会话活跃度视图
CREATE OR REPLACE VIEW session_activity AS
SELECT 
  s.id as session_id,
  s.name as session_name,
  COUNT(DISTINCT m.user_id) as active_members,
  COUNT(msg.id) as message_count,
  MAX(msg.timestamp) as last_activity,
  COUNT(t.id) as task_count,
  COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks
FROM sessions s
LEFT JOIN session_members m ON s.id = m.session_id
LEFT JOIN messages msg ON s.id = msg.session_id AND msg.deleted_at IS NULL
LEFT JOIN tasks t ON s.id = t.session_id
WHERE s.is_archived = FALSE
GROUP BY s.id, s.name;

-- ============================================
-- 触发器：自动更新时间
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- 应用触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_comments_updated_at BEFORE UPDATE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_knowledge_base_updated_at BEFORE UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 初始数据（种子）
-- ============================================

-- 系统用户（用于系统消息）
INSERT INTO users (id, email, password_hash, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'system@syncai.ai', '', 'System');

-- ============================================
-- 权限和角色（可选，使用 PostgreSQL RLS）
-- ============================================

-- 启用行级安全
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- 示例：用户只能查看自己的数据
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (id = current_setting('app.current_user_id')::UUID);

-- ============================================
-- 数据保留策略（分区表）
-- ============================================

-- 消息表按月分区（示例）
-- CREATE TABLE messages_2026_04 PARTITION OF messages
--   FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- CREATE TABLE messages_2026_05 PARTITION OF messages
--   FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- ============================================
-- 注释
-- ============================================

COMMENT ON TABLE users IS '用户账户表';
COMMENT ON TABLE workspaces IS '工作区表';
COMMENT ON TABLE sessions IS '共享会话表';
COMMENT ON TABLE messages IS '消息表';
COMMENT ON TABLE tasks IS '任务表';
COMMENT ON TABLE knowledge_base IS '知识库表';
COMMENT ON TABLE notifications IS '通知表';
COMMENT ON COLUMN messages.metadata IS 'JSONB 存储 AI 模型、代码语言等元数据';
COMMENT ON COLUMN sessions.visibility IS 'public: 公开，invite_only: 邀请制，private: 私密';
COMMENT ON COLUMN tasks.status IS 'todo: 待办，in_progress: 进行中，done: 已完成，cancelled: 已取消';
```

---

## 2. 表结构详解

### 2.1 核心表关系

| 表名 | 说明 | 数据量预估（6 个月） |
|------|------|---------------------|
| users | 用户账户 | 1,000 |
| workspaces | 工作区 | 500 |
| sessions | 会话 | 2,000 |
| messages | 消息 | 500,000 |
| tasks | 任务 | 50,000 |
| notifications | 通知 | 200,000 |

### 2.2 关键字段说明

#### users 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| email | VARCHAR(255) | 唯一，用于登录 |
| password_hash | VARCHAR(255) | bcrypt 哈希 |
| plan | VARCHAR(20) | free/pro/business/enterprise |

#### messages 表
| 字段 | 类型 | 说明 |
|------|------|------|
| type | VARCHAR(20) | text/code/file/ai_response/system |
| metadata | JSONB | {"model": "claude", "codeLanguage": "typescript"} |
| search_vector | TSVECTOR | 全文搜索索引 |

#### tasks 表
| 字段 | 类型 | 说明 |
|------|------|------|
| status | VARCHAR(20) | todo/in_progress/done/cancelled |
| priority | VARCHAR(20) | low/medium/high/urgent |
| source_message_id | UUID | 关联的源消息 ID |

---

## 3. 查询优化

### 3.1 常用查询

#### 获取会话历史消息
```sql
SELECT 
  m.id,
  m.content,
  m.type,
  m.metadata,
  m.timestamp,
  u.name as sender_name,
  u.avatar_url as sender_avatar
FROM messages m
LEFT JOIN users u ON m.user_id = u.id
WHERE m.session_id = $1
  AND m.deleted_at IS NULL
ORDER BY m.timestamp DESC
LIMIT 50 OFFSET $2;
```

#### 获取用户任务统计
```sql
SELECT 
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN due_date < NOW() AND status != 'done' THEN 1 END) as overdue
FROM tasks
WHERE assignee_id = $1
GROUP BY status;
```

#### 全文搜索消息
```sql
SELECT 
  m.id,
  m.content,
  m.timestamp,
  u.name as sender_name,
  ts_rank(m.search_vector, query) as rank
FROM messages m
LEFT JOIN users u ON m.user_id = u.id
WHERE m.session_id = $1
  AND m.search_vector @@ query
ORDER BY rank DESC, m.timestamp DESC
LIMIT 20;
```

### 3.2 性能优化建议

1. **定期 VACUUM**
```sql
VACUUM ANALYZE messages;
VACUUM ANALYZE tasks;
```

2. **分区表（消息量 >1000 万时）**
```sql
-- 按月分区
CREATE TABLE messages_2026_04 PARTITION OF messages
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

3. **物化视图刷新**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY task_stats;
```

---

## 4. 数据迁移

### 4.1 迁移工具
使用 **Prisma Migrate** 或 **Flyway** 管理数据库迁移

### 4.2 迁移流程
```bash
# 1. 创建迁移
npx prisma migrate dev --name init

# 2. 查看迁移 SQL
cat prisma/migrations/*/migration.sql

# 3. 应用到生产
npx prisma migrate deploy

# 4. 生成 Prisma 客户端
npx prisma generate
```

---

## 5. 备份策略

### 5.1 备份计划
| 类型 | 频率 | 保留时间 |
|------|------|----------|
| 全量备份 | 每天 | 30 天 |
| 增量备份 | 每小时 | 7 天 |
| 归档备份 | 每月 | 1 年 |

### 5.2 备份命令
```bash
# 全量备份
pg_dump -h localhost -U syncai syncai > backup_$(date +%Y%m%d).sql

# 恢复
psql -h localhost -U syncai syncai < backup_20260414.sql
```

---

**文档状态：** 可执行  
**评审人：** 后端开发团队  
**下次更新：** 根据实际开发需求调整
