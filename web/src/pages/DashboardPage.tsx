import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { searchMessages, type SearchMessageItem } from "../api/client";

interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export function DashboardPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSlug, setNewTeamSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMessageItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);

  const navigate = useNavigate();
  
  // Check if user is authenticated
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }
    
    fetchTeams();
  }, [navigate]);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch("/api/v1/teams", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        throw new Error(`Failed to fetch teams: ${response.status}`);
      }

      const data = await response.json();
      setTeams(data.data || []);
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching teams");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamSlug.trim()) {
      setCreateError("Please fill in both name and slug");
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);

      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch("/api/v1/teams", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newTeamName.trim(),
          slug: newTeamSlug.trim(),
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to create team: ${response.status}`);
      }

      // Reset form
      setNewTeamName("");
      setNewTeamSlug("");
      
      // Refresh teams list
      await fetchTeams();
    } catch (err: any) {
      setCreateError(err.message || "An error occurred while creating team");
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !selectedTeamId) {
      setSearchError("Please enter a search query and select a team");
      return;
    }

    try {
      setSearching(true);
      setSearchError(null);
      setSearchResults([]);
      setSearchTotal(0);

      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await searchMessages(
        token,
        selectedTeamId,
        searchQuery.trim(),
      );

      setSearchResults(response.data || []);
      setSearchTotal(response.meta?.total ?? 0);
    } catch (err: any) {
      if (err.message?.includes("401") || err.message === "UNAUTHORIZED") {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setSearchError(err.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <main className="page-shell">
        <section className="hero">
          <h1>Loading Teams...</h1>
          <p>Loading your teams...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <h1>Dashboard</h1>
        <button onClick={handleLogout} className="btn btn-secondary">
          Logout
        </button>
      </header>
      
      <section className="content-section">
        <div className="section-header">
          <h2>Search Messages</h2>
        </div>

        <form onSubmit={handleSearch} className="form">
          {searchError && (
            <div className="alert alert-error">
              <p>{searchError}</p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="searchQuery">Search</label>
            <input
              id="searchQuery"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter keyword to search messages..."
              className="form-control"
            />
          </div>

          <div className="form-group">
            <label htmlFor="searchTeam">Team</label>
            <select
              id="searchTeam"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="form-control"
            >
              <option value="">-- Select a team --</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={searching}
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="search-results" style={{ marginTop: "1rem" }}>
            <p>
              <strong>{searchTotal}</strong> result{searchTotal !== 1 ? "s" : ""} found
            </p>
            <ul className="search-result-list" style={{ listStyle: "none", padding: 0 }}>
              {searchResults.map((item) => (
                <li
                  key={item.message_id}
                  className="card"
                  style={{ marginBottom: "0.5rem" }}
                >
                  <p>
                    <strong>Project:</strong> {item.project_name}
                  </p>
                  <p>
                    <strong>Session:</strong> {item.session_title}
                  </p>
                  <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {item.content.length > 200
                      ? item.content.slice(0, 200) + "..."
                      : item.content}
                  </p>
                  <small>
                    {new Date(item.created_at).toLocaleString()}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="content-section">
        <div className="section-header">
          <h2>Your Teams</h2>
        </div>
        
        {error && (
          <div className="alert alert-error">
            <p>Error: {error}</p>
          </div>
        )}
        
        <div className="teams-list">
          {teams.length === 0 ? (
            <p>You don't have any teams yet.</p>
          ) : (
            <ul className="team-grid">
              {teams.map((team) => (
                <li key={team.id} className="card">
                  <h3>
                    <Link to={`/teams/${team.id}`}>{team.name}</Link>
                  </h3>
                  <p><strong>Slug:</strong> {team.slug}</p>
                  <p><strong>ID:</strong> {team.id}</p>
                  <small>Created: {new Date(team.created_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      
      <section className="content-section">
        <div className="section-header">
          <h2>Create New Team</h2>
        </div>
        
        <form onSubmit={handleCreateTeam} className="form">
          {createError && (
            <div className="alert alert-error">
              <p>{createError}</p>
            </div>
          )}
          
          <div className="form-group">
            <label htmlFor="teamName">Team Name</label>
            <input
              id="teamName"
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Enter team name"
              className="form-control"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="teamSlug">Team Slug</label>
            <input
              id="teamSlug"
              type="text"
              value={newTeamSlug}
              onChange={(e) => setNewTeamSlug(e.target.value)}
              placeholder="Enter team slug (unique identifier)"
              className="form-control"
              required
            />
          </div>
          
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={creating}
          >
            {creating ? "Creating..." : "Create Team"}
          </button>
        </form>
      </section>
    </main>
  );
}