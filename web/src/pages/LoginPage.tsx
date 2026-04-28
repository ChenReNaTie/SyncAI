import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../api/client.js";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result = isLogin
        ? await login(email, password)
        : await register(email, password, displayName);

      localStorage.setItem("token", result.data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>{isLogin ? "登录" : "注册"}</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            密码
            <input
              type="password"
              value={password}
              minLength={isLogin ? 1 : 8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {!isLogin && (
            <label>
              显示名
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit">
            {isLogin ? "登录" : "注册"}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? "还没有账号？" : "已有账号？"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(isLogin ? "register" : "login");
              setError(null);
            }}
          >
            {isLogin ? "去注册" : "去登录"}
          </button>
        </p>
      </section>
    </main>
  );
}
