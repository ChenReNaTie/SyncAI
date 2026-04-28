import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../api/client.js";
import { PageShell, GlassCard, Button, Input } from "../components/index.js";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = isLogin
        ? await login(email, password)
        : await register(email, password, displayName);

      localStorage.setItem("token", result.data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <div className="flex items-center justify-center min-h-[80vh]">
        <GlassCard glow className="w-full max-w-md animate-slide-up">
          <h1 className="text-3xl font-bold tracking-tight text-text-primary text-center mb-2">
            <span className="text-gradient">灵悉 AI</span>
          </h1>
          <p className="text-text-secondary text-sm text-center mb-8">
            {isLogin ? "欢迎回来" : "创建你的账号"}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="邮箱"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <Input
              label="密码"
              type="password"
              value={password}
              minLength={isLogin ? 1 : 8}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? "输入密码" : "至少 8 位"}
              required
            />

            {!isLogin && (
              <Input
                label="显示名"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="你的名字"
                required
              />
            )}

            {error && (
              <div className="px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" loading={submitting} size="lg" className="w-full mt-2">
              {isLogin ? "登录" : "注册"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-text-muted">
            {isLogin ? "还没有账号？" : "已有账号？"}{" "}
            <button
              type="button"
              className="text-accent-light hover:text-accent font-medium transition-colors"
              onClick={() => {
                setMode(isLogin ? "register" : "login");
                setError(null);
              }}
            >
              {isLogin ? "去注册" : "去登录"}
            </button>
          </p>
        </GlassCard>
      </div>
    </PageShell>
  );
}
