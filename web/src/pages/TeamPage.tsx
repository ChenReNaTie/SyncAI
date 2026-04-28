import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getTeam, getProjects, createProject } from "../api/client.js";

interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  team_id: string;
  created_at: string;
}

export function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create project form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    if (!teamId) {
      navigate("/dashboard");
      return;
    }
    loadTeamData();
  }, [teamId, token, navigate]);

  const loadTeamData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [teamRes, projectsRes] = await Promise.all([
        getTeam(token!, teamId!),
        getProjects(token!, teamId!),
      ]);

      setTeam(teamRes.data);
      setProjects(projectsRes.data);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED" || err.message.includes("401")) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to load team data");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setCreateError("Project name is required");
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);

      await createProject(token!, teamId!, projectName.trim(), projectDesc.trim());

      setProjectName("");
      setProjectDesc("");
      setShowCreateForm(false);

      // Reload projects
      const projectsRes = await getProjects(token!, teamId!);
      setProjects(projectsRes.data);
    } catch (err: any) {
      setCreateError(err.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <main className="page-shell">
        <section className="hero">
          <h1>Loading Team...</h1>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-shell">
        <header className="page-header">
          <Link to="/dashboard">&larr; Back to Dashboard</Link>
        </header>
        <section className="content-section">
          <div className="alert alert-error">
            <p>Error: {error}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <Link to="/dashboard">&larr; Back to Dashboard</Link>
      </header>

      <section className="content-section">
        <h2>{team?.name || "Team"}</h2>
        {team && (
          <p>
            <strong>Slug:</strong> {team.slug}
          </p>
        )}
      </section>

      <section className="content-section">
        <div className="section-header">
          <h3>Projects</h3>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? "Cancel" : "+ Create Project"}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateProject} className="form">
            {createError && (
              <div className="alert alert-error">
                <p>{createError}</p>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="projectName">Project Name</label>
              <input
                id="projectName"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name"
                className="form-control"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="projectDesc">Description</label>
              <input
                id="projectDesc"
                type="text"
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="Enter project description (optional)"
                className="form-control"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Project"}
            </button>
          </form>
        )}

        {projects.length === 0 ? (
          <p>No projects yet.</p>
        ) : (
          <ul className="team-grid">
            {projects.map((project) => (
              <li key={project.id} className="card">
                <h4>{project.name}</h4>
                {project.description && <p>{project.description}</p>}
                <small>
                  Created: {new Date(project.created_at).toLocaleDateString()}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
