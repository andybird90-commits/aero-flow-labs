/**
 * BodyKit Studio data layer — typed React Query hooks over Lovable Cloud.
 * Use these from pages instead of calling supabase.from(...) directly.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile        = Database["public"]["Tables"]["profiles"]["Row"];
export type CarTemplate    = Database["public"]["Tables"]["car_templates"]["Row"];
export type Car            = Database["public"]["Tables"]["cars"]["Row"];
export type Project        = Database["public"]["Tables"]["projects"]["Row"];
export type Geometry       = Database["public"]["Tables"]["geometries"]["Row"];
export type ConceptSet     = Database["public"]["Tables"]["concept_sets"]["Row"];
export type FittedPart     = Database["public"]["Tables"]["fitted_parts"]["Row"];
export type DesignBrief    = Database["public"]["Tables"]["design_briefs"]["Row"];
export type Concept        = Database["public"]["Tables"]["concepts"]["Row"];
export type PartsJob       = Database["public"]["Tables"]["parts_generation_jobs"]["Row"];
export type ExportRow      = Database["public"]["Tables"]["exports"]["Row"];
export type CarStl         = Database["public"]["Tables"]["car_stls"]["Row"];

/* ─── ROLES ────────────────────────────────────────────────── */
export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ["is_admin", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: userId!,
        _role: "admin",
      });
      if (error) throw error;
      return !!data;
    },
  });
}

/* ─── CAR STLs (admin-managed reference bodies) ────────────── */
export function useCarStls() {
  return useQuery({
    queryKey: ["car_stls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("car_stls")
        .select("*, car_template:car_templates(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (CarStl & { car_template: CarTemplate | null })[];
    },
  });
}

export function useUpsertCarStl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      carTemplateId: string;
      file: File;
      forwardAxis: string;
    }) => {
      const path = `${input.carTemplateId}/${Date.now()}-${input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("car-stls")
        .upload(path, input.file, { contentType: "model/stl", upsert: false });
      if (upErr) throw upErr;

      // Upsert by car_template_id (unique). Replace stl_path; clear repaired side.
      const { data, error } = await supabase
        .from("car_stls")
        .upsert(
          {
            car_template_id: input.carTemplateId,
            user_id: input.userId,
            stl_path: path,
            forward_axis: input.forwardAxis,
            repaired_stl_path: null,
            manifold_clean: false,
            triangle_count: null,
            bbox_min_mm: null,
            bbox_max_mm: null,
          },
          { onConflict: "car_template_id" },
        )
        .select("*")
        .single();
      if (error) throw error;
      return data as CarStl;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_stls"] }),
  });
}

export function useDeleteCarStl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: CarStl) => {
      // Best-effort remove of both files (admins only — RLS enforces).
      const paths = [row.stl_path, row.repaired_stl_path].filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from("car-stls").remove(paths);
      const { error } = await supabase.from("car_stls").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_stls"] }),
  });
}

export function useUpdateCarStlAxis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, forward_axis }: { id: string; forward_axis: string }) => {
      const { error } = await supabase.from("car_stls").update({ forward_axis }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_stls"] }),
  });
}

/* ─── PROFILE ──────────────────────────────────────────────── */
export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

/* ─── CAR TEMPLATES (public) ───────────────────────────────── */
export function useCarTemplates() {
  return useQuery({
    queryKey: ["car_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("car_templates").select("*").order("make");
      if (error) throw error;
      return data as CarTemplate[];
    },
  });
}

/* ─── PROJECTS ─────────────────────────────────────────────── */
export function useProjects(userId: string | undefined) {
  return useQuery({
    queryKey: ["projects", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, car:cars(*, template:car_templates(*))")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as (Project & { car: Car & { template: CarTemplate | null } })[];
    },
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, car:cars(*, template:car_templates(*))")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as (Project & { car: Car & { template: CarTemplate | null } }) | null;
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; name: string; carName?: string }) => {
      // Create a minimal car shell (no template required for the new flow).
      const { data: car, error: carErr } = await supabase.from("cars").insert({
        user_id: input.userId,
        name: input.carName ?? "Untitled vehicle",
      }).select("*").single();
      if (carErr) throw carErr;

      const { data: project, error: pErr } = await supabase.from("projects").insert({
        user_id: input.userId,
        car_id: car.id,
        name: input.name,
        status: "draft",
      }).select("*").single();
      if (pErr) throw pErr;

      const { data: geo, error: geoErr } = await supabase.from("geometries").insert({
        user_id: input.userId,
        project_id: project.id,
        source: "template",
        underbody_model: "simplified",
        wheel_rotation: "static",
        steady_state: true,
      }).select("*").single();
      if (geoErr) throw geoErr;

      // Default working concept set
      await supabase.from("concept_sets").insert({
        user_id: input.userId,
        project_id: project.id,
        geometry_id: geo.id,
        name: "Working set",
        status: "draft",
      });

      // Empty design brief
      await supabase.from("design_briefs").insert({
        user_id: input.userId,
        project_id: project.id,
        prompt: "",
      });

      return project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Project> }) => {
      const { data, error } = await supabase.from("projects").update(input.patch).eq("id", input.id).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", v.id] });
    },
  });
}

export function useDuplicateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.rpc("duplicate_project", { _project_id: projectId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/* ─── GEOMETRY (uploaded car model) ────────────────────────── */
export function useGeometry(projectId: string | undefined) {
  return useQuery({
    queryKey: ["geometry", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("geometries")
        .select("*").eq("project_id", projectId!)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as Geometry | null;
    },
  });
}

export function useUpdateGeometry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Geometry> }) => {
      const { data, error } = await supabase.from("geometries").update(input.patch).eq("id", input.id).select("*").single();
      if (error) throw error;
      return data as Geometry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["geometry", data.project_id] });
      qc.invalidateQueries({ queryKey: ["concept_sets", data.project_id] });
    },
  });
}

/* ─── DESIGN BRIEF ─────────────────────────────────────────── */
export function useBrief(projectId: string | undefined) {
  return useQuery({
    queryKey: ["brief", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("design_briefs")
        .select("*").eq("project_id", projectId!)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as DesignBrief | null;
    },
  });
}

export function useUpsertBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; projectId: string; id?: string; patch: Partial<DesignBrief> }) => {
      if (input.id) {
        const { data, error } = await supabase.from("design_briefs")
          .update(input.patch).eq("id", input.id).select("*").single();
        if (error) throw error;
        return data as DesignBrief;
      }
      const { data, error } = await supabase.from("design_briefs").insert({
        user_id: input.userId, project_id: input.projectId,
        prompt: input.patch.prompt ?? "",
        style_tags: input.patch.style_tags ?? [],
        build_type: input.patch.build_type ?? null,
        constraints: input.patch.constraints ?? [],
        reference_image_paths: input.patch.reference_image_paths ?? [],
        rights_confirmed: input.patch.rights_confirmed ?? false,
      }).select("*").single();
      if (error) throw error;
      return data as DesignBrief;
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ["brief", d.project_id] }),
  });
}

/* ─── CONCEPT SETS ─────────────────────────────────────────── */
export function useConceptSets(projectId: string | undefined) {
  return useQuery({
    queryKey: ["concept_sets", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("concept_sets")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at");
      if (error) throw error;
      return data as ConceptSet[];
    },
  });
}

export function useActiveConceptSet(projectId: string | undefined) {
  return useQuery({
    queryKey: ["concept_set_active", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("concept_sets")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ConceptSet | null;
    },
  });
}

/* ─── CONCEPTS ─────────────────────────────────────────────── */
export function useConcepts(projectId: string | undefined) {
  return useQuery({
    queryKey: ["concepts", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("concepts")
        .select("*").eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Concept[];
    },
  });
}

export function useApprovedConcept(projectId: string | undefined) {
  return useQuery({
    queryKey: ["concept_approved", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("concepts")
        .select("*").eq("project_id", projectId!).eq("status", "approved")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as Concept | null;
    },
  });
}

export function useUpdateConcept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Concept> }) => {
      const { data, error } = await supabase.from("concepts")
        .update(input.patch).eq("id", input.id).select("*").single();
      if (error) throw error;
      return data as Concept;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["concepts", d.project_id] });
      qc.invalidateQueries({ queryKey: ["concept_approved", d.project_id] });
    },
  });
}

export function useDeleteConcept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("concepts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["concepts"] }),
  });
}

/* ─── CONCEPT PARTS (extracted / modeled) ──────────────────── */
export type ConceptPart = Database["public"]["Tables"]["concept_parts"]["Row"];

export function useConceptParts(projectId: string | undefined) {
  return useQuery({
    queryKey: ["concept_parts", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("concept_parts")
        .select("*").eq("project_id", projectId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data as ConceptPart[];
    },
  });
}

export function useDeleteConceptPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("concept_parts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["concept_parts"] }),
  });
}

/* ─── FITTED PARTS ─────────────────────────────────────────── */
export function useFittedParts(conceptSetId: string | undefined) {
  return useQuery({
    queryKey: ["fitted_parts", conceptSetId],
    enabled: !!conceptSetId,
    queryFn: async () => {
      const { data, error } = await supabase.from("fitted_parts")
        .select("*").eq("concept_set_id", conceptSetId!).order("created_at");
      if (error) throw error;
      return data as FittedPart[];
    },
  });
}

export function useUpsertFittedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; conceptSetId: string; id?: string; kind: string; params: any; enabled: boolean }) => {
      if (input.id) {
        const { data, error } = await supabase.from("fitted_parts")
          .update({ kind: input.kind, params: input.params, enabled: input.enabled })
          .eq("id", input.id).select("*").single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("fitted_parts").insert({
        user_id: input.userId, concept_set_id: input.conceptSetId,
        kind: input.kind, params: input.params, enabled: input.enabled,
      }).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => qc.invalidateQueries({ queryKey: ["fitted_parts", d.concept_set_id] }),
  });
}

export function useDeleteFittedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fitted_parts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fitted_parts"] }),
  });
}

/* ─── PARTS GENERATION JOBS ────────────────────────────────── */
export function usePartsJobs(projectId: string | undefined) {
  return useQuery({
    queryKey: ["parts_jobs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("parts_generation_jobs")
        .select("*").eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PartsJob[];
    },
  });
}

/* ─── EXPORTS ──────────────────────────────────────────────── */
export function useExports(userId: string | undefined) {
  return useQuery({
    queryKey: ["exports", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("exports")
        .select("*, project:projects(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (ExportRow & { project: { name: string } | null })[];
    },
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; projectId: string; kind: ExportRow["kind"]; sections: any; filePath: string; fileSizeBytes: number }) => {
      const { data, error } = await supabase.from("exports").insert({
        user_id: input.userId,
        project_id: input.projectId,
        kind: input.kind,
        sections: input.sections,
        file_path: input.filePath,
        file_size_bytes: input.fileSizeBytes,
        status: "ready",
      }).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exports"] }),
  });
}

/* ─── REALTIME ─────────────────────────────────────────────── */
export function useJobRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channelName = `bk-jobs-${userId}`;
    const existing = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (existing) supabase.removeChannel(existing);
    const ch = supabase.channel(channelName);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "concepts", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["concepts"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "parts_generation_jobs", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["parts_jobs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "exports", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["exports"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);
}
