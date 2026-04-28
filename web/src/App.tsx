import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";

function RootRedirect() {
  const token = localStorage.getItem("token");
  return token
    ? <Navigate to="/dashboard" replace />
    : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/teams/:teamId" element={<TeamPage />} />
      <Route path="/projects/:projectId" element={<ProjectPage />} />
    </Routes>
  );
}
