import { AGENT_TYPE, sessionRuntimeStatusValues } from "@syncai/shared";

const entryPoints = [
  {
    title: "工程骨架",
    detail: "后端、前端、共享类型、环境变量和本地依赖服务先跑起来。",
  },
  {
    title: "数据库基座",
    detail: "把团队、项目、会话、消息、事件、todo、审计模型先落到迁移层。",
  },
  {
    title: "调度闭环",
    detail: "串行执行、排队状态、Mock CodexAdapter 和 WebSocket 事件优先打通。",
  },
];

export function App() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">SyncAI / 灵悉 AI</p>
        <h1>文档基线已完成，正式进入工程落地阶段。</h1>
        <p className="lead">
          现在的首要目标不是继续讨论需求，而是把单管理员节点、串行调度和共享会话闭环做成可运行系统。
        </p>
        <div className="hero-grid">
          <article>
            <span>当前阶段</span>
            <strong>M0 / Phase 0</strong>
          </article>
          <article>
            <span>首接 Agent</span>
            <strong>{AGENT_TYPE}</strong>
          </article>
          <article>
            <span>运行状态字典</span>
            <strong>{sessionRuntimeStatusValues.join(" / ")}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <p className="eyebrow">First Three</p>
          <h2>最先开工的三个编码切入点</h2>
        </div>
        <div className="entry-grid">
          {entryPoints.map((item, index) => (
            <article className="entry-card" key={item.title}>
              <span className="index">0{index + 1}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

