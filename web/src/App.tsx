import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage.js";

function RootRedirect() {
  const token = localStorage.getItem("token");
  return token
    ? <Navigate to="/dashboard" replace />
    : <Navigate to="/login" replace />;
}

function DashboardPlaceholder() {
  return (
    <main className="page-shell">
      <section className="hero">
        <h1>Dashboard - 登录成功</h1>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPlaceholder />} />
    </Routes>
  );
}
