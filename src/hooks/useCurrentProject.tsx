/**
 * Resolves the "current project" for workspace pages
 * (Upload / Brief / Concepts / Parts / Refine / Exports).
 *
 * Source of truth: ?project= search param. Falls back to the user's most-
 * recently updated project. Persists last-opened to localStorage.
 */
import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProject, useProjects } from "@/lib/repo";

const LS_KEY = "bodykit.lastProjectId";

export function useCurrentProject() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const queryId = search.get("project") ?? undefined;

  const { data: projects = [], isLoading: projectsLoading } = useProjects(user?.id);

  const resolvedId = useMemo(() => {
    if (queryId) return queryId;
    const stored = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (stored && projects.some((p) => p.id === stored)) return stored;
    return projects[0]?.id;
  }, [queryId, projects]);

  useEffect(() => {
    if (resolvedId && !queryId) {
      const next = new URLSearchParams(search);
      next.set("project", resolvedId);
      setSearch(next, { replace: true });
    }
  }, [resolvedId, queryId, search, setSearch]);

  useEffect(() => {
    if (resolvedId) localStorage.setItem(LS_KEY, resolvedId);
  }, [resolvedId]);

  const projectQuery = useProject(resolvedId);

  return {
    projectId: resolvedId,
    project: projectQuery.data ?? null,
    isLoading: projectsLoading || projectQuery.isLoading,
    isEmpty: !projectsLoading && projects.length === 0,
    projects,
    goToProjects: () => navigate("/projects"),
  };
}
