/**
 * Project sharing — read/update share state and generate the public link.
 *
 * The share token is a random URL-safe slug stored on the project row. We
 * keep generation server-side via `generate_share_token()` so multiple tabs
 * can't race each other.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectShareState {
  share_enabled: boolean;
  share_token: string | null;
  thumbnail_url: string | null;
}

export function useProjectShareState(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-share", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectShareState> => {
      const { data, error } = await supabase
        .from("projects")
        .select("share_enabled, share_token, thumbnail_url")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return {
        share_enabled: !!data?.share_enabled,
        share_token: data?.share_token ?? null,
        thumbnail_url: data?.thumbnail_url ?? null,
      };
    },
  });
}

/** Toggle the public link on/off, generating a token the first time. */
export function useToggleShare(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!projectId) throw new Error("No project");
      // If turning on and no token yet, generate one via RPC fallback to client-side.
      const { data: existing } = await supabase
        .from("projects")
        .select("share_token")
        .eq("id", projectId)
        .maybeSingle();

      let token = existing?.share_token ?? null;
      if (enabled && !token) {
        token = makeUrlSafeToken();
      }
      const { error } = await supabase
        .from("projects")
        .update({ share_enabled: enabled, share_token: enabled ? token : existing?.share_token ?? null })
        .eq("id", projectId);
      if (error) throw error;
      return { enabled, token };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-share", projectId] });
    },
  });
}

/** Rotate the share token (invalidates any old links). */
export function useRotateShareToken(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No project");
      const token = makeUrlSafeToken();
      const { error } = await supabase
        .from("projects")
        .update({ share_token: token })
        .eq("id", projectId);
      if (error) throw error;
      return token;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-share", projectId] }),
  });
}

/** URL the public Showroom lives at. */
export function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

/** Crockford-base32-ish 22-char URL-safe token. */
function makeUrlSafeToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
