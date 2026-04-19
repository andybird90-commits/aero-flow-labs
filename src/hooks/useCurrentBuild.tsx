/**
 * Hook that resolves the "current build" for the workspace pages
 * (Build / Geometry / Parts / Simulation / Results / Compare / Exports).
 *
 * Source of truth: ?id= search param. Falls back to the user's most-recently
 * updated build. Stores last-opened in localStorage so navigating between
 * workspace pages keeps context.
 */
import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useBuild, useBuilds } from "@/lib/repo";

const LS_KEY = "aerolab.lastBuildId";

export function useCurrentBuild() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const queryId = search.get("id") ?? undefined;

  const { data: builds = [], isLoading: buildsLoading } = useBuilds(user?.id);

  const resolvedId = useMemo(() => {
    if (queryId) return queryId;
    const stored = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (stored && builds.some((b) => b.id === stored)) return stored;
    return builds[0]?.id;
  }, [queryId, builds]);

  // Keep URL in sync if we picked a fallback
  useEffect(() => {
    if (resolvedId && !queryId) {
      const next = new URLSearchParams(search);
      next.set("id", resolvedId);
      setSearch(next, { replace: true });
    }
  }, [resolvedId, queryId, search, setSearch]);

  // Persist
  useEffect(() => {
    if (resolvedId) localStorage.setItem(LS_KEY, resolvedId);
  }, [resolvedId]);

  const buildQuery = useBuild(resolvedId);

  return {
    buildId: resolvedId,
    build: buildQuery.data ?? null,
    isLoading: buildsLoading || buildQuery.isLoading,
    isEmpty: !buildsLoading && builds.length === 0,
    builds,
    goToGarage: () => navigate("/garage"),
  };
}
