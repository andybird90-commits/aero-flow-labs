/**
 * Body Skins data layer — admin-managed full bodyswap shells (GLB/STL).
 *
 * A body skin can be uploaded directly or saved from a Meshy generation.
 * In the Build Studio, an active body skin can be loaded as an overlay
 * (Shell Fit Mode) that drapes over the donor car for visual alignment.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BodySkin = Database["public"]["Tables"]["body_skins"]["Row"];
export type BodySkinFitStatus = Database["public"]["Enums"]["body_skin_fit_status"];

const BUCKET = "body-skins";

export function useBodySkins() {
  return useQuery({
    queryKey: ["body_skins"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("body_skins")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BodySkin[];
    },
  });
}

export function useBodySkin(id: string | undefined | null) {
  return useQuery({
    queryKey: ["body_skin", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("body_skins")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as BodySkin | null;
    },
  });
}

/**
 * Sign a private storage path so the viewer can load the mesh.
 * Accepts either a full URL (returned as-is) or a bucket path.
 */
export function useSignedBodySkinUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed_body_skin_url", path],
    enabled: !!path,
    queryFn: async () => {
      if (!path) return null;
      if (/^https?:\/\//.test(path)) return path;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 30);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 1000 * 60 * 20,
  });
}

export function useUploadBodySkin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      name: string;
      file: File;
      previewFile?: File | null;
      donor_car_template_id?: string | null;
      style_tags?: string[];
      notes?: string;
    }) => {
      const safe = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = (safe.split(".").pop() ?? "").toLowerCase();
      if (ext !== "stl" && ext !== "glb") {
        throw new Error("Only .stl or .glb files are supported.");
      }
      const path = `${input.userId}/${Date.now()}-${safe}`;
      const contentType = ext === "glb" ? "model/gltf-binary" : "model/stl";

      // Use signed upload for files > 6MB to bypass gateway limits.
      const LARGE = 6 * 1024 * 1024;
      if (input.file.size > LARGE) {
        const { data: signed, error: signErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUploadUrl(path);
        if (signErr || !signed) throw signErr ?? new Error("Could not sign upload");
        const { error: putErr } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(signed.path, signed.token, input.file, { contentType });
        if (putErr) throw putErr;
      } else {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, input.file, { contentType, upsert: false });
        if (upErr) throw upErr;
      }

      // Optional preview thumbnail
      let preview_url: string | null = null;
      if (input.previewFile) {
        const previewSafe = input.previewFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const previewPath = `${input.userId}/preview-${Date.now()}-${previewSafe}`;
        const { error: previewErr } = await supabase.storage
          .from(BUCKET)
          .upload(previewPath, input.previewFile, {
            contentType: input.previewFile.type || "image/png",
            upsert: false,
          });
        if (!previewErr) {
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(previewPath, 60 * 60 * 24 * 365);
          preview_url = signed?.signedUrl ?? null;
        }
      }

      const insert = {
        user_id: input.userId,
        name: input.name,
        notes: input.notes ?? null,
        donor_car_template_id: input.donor_car_template_id ?? null,
        style_tags: input.style_tags ?? [],
        preview_url,
        ...(ext === "glb" ? { file_url_glb: path } : { file_url_stl: path }),
      };

      const { data, error } = await (supabase as any)
        .from("body_skins")
        .insert(insert)
        .select("*")
        .single();
      if (error) throw error;
      return data as BodySkin;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["body_skins"] }),
  });
}

export function useDeleteBodySkin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (skin: BodySkin) => {
      const paths: string[] = [];
      if (skin.file_url_stl && !/^https?:\/\//.test(skin.file_url_stl)) paths.push(skin.file_url_stl);
      if (skin.file_url_glb && !/^https?:\/\//.test(skin.file_url_glb)) paths.push(skin.file_url_glb);
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
      const { error } = await (supabase as any)
        .from("body_skins")
        .delete()
        .eq("id", skin.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["body_skins"] }),
  });
}

export function useUpdateBodySkin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<BodySkin, "name" | "notes" | "fit_status" | "style_tags" | "donor_car_template_id">>;
    }) => {
      const { data, error } = await (supabase as any)
        .from("body_skins")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as BodySkin;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["body_skins"] }),
  });
}
