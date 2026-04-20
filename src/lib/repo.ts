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
export type StylePreset    = Database["public"]["Tables"]["style_presets"]["Row"];

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

export function useCreateCarTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      make: string;
      model: string;
      trim?: string;
      yearRange?: string;
    }) => {
      // Slug must be unique. Build from make/model/trim/year + short random
      // suffix so admins can re-add similar entries without collisions.
      const base = [input.make, input.model, input.trim, input.yearRange]
        .filter(Boolean)
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const slug = `${base || "car"}-${Math.random().toString(36).slice(2, 6)}`;

      const { data, error } = await supabase
        .from("car_templates")
        .insert({
          make: input.make.trim(),
          model: input.model.trim(),
          trim: input.trim?.trim() || null,
          year_range: input.yearRange?.trim() || null,
          slug,
          supported: true,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as CarTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["car_templates"] }),
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
      const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = (safeName.split(".").pop() ?? "").toLowerCase();
      if (ext !== "stl" && ext !== "obj") {
        throw new Error("Only .stl or .obj files are supported.");
      }
      const path = `${input.carTemplateId}/${Date.now()}-${safeName}`;
      const contentType = ext === "obj" ? "model/obj" : "model/stl";

      // The JS SDK's plain `.upload()` POSTs the whole file in one request and
      // gateways tend to reject anything > ~50 MB. Mesh files commonly exceed
      // this, so for large files we route through a signed upload URL which
      // streams the body and tolerates much larger payloads.
      const LARGE_THRESHOLD = 6 * 1024 * 1024; // 6 MB
      if (input.file.size > LARGE_THRESHOLD) {
        const { data: signed, error: signErr } = await supabase.storage
          .from("car-stls")
          .createSignedUploadUrl(path);
        if (signErr || !signed) {
          console.error("createSignedUploadUrl failed", signErr);
          throw new Error(signErr?.message ?? "Could not create upload URL");
        }
        const { error: putErr } = await supabase.storage
          .from("car-stls")
          .uploadToSignedUrl(signed.path, signed.token, input.file, { contentType });
        if (putErr) {
          console.error("uploadToSignedUrl failed", putErr);
          throw new Error(`Upload failed (${(input.file.size / 1024 / 1024).toFixed(1)} MB): ${putErr.message}`);
        }
      } else {
        const { error: upErr } = await supabase.storage
          .from("car-stls")
          .upload(path, input.file, { contentType, upsert: false });
        if (upErr) {
          console.error("storage.upload failed", upErr);
          throw new Error(`Upload failed (${(input.file.size / 1024 / 1024).toFixed(1)} MB): ${upErr.message}`);
        }
      }

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

/** Fetch the hero STL row for a given car template (one or none). */
export function useCarStlForTemplate(carTemplateId: string | undefined | null) {
  return useQuery({
    queryKey: ["car_stl_for_template", carTemplateId],
    enabled: !!carTemplateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("car_stls")
        .select("*")
        .eq("car_template_id", carTemplateId!)
        .maybeSingle();
      if (error) throw error;
      return data as CarStl | null;
    },
  });
}

/** Resolve the hero STL for a project via its car.template_id, avoiding stale nested project data. */
export function useHeroStlForProject(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ["hero_stl_for_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("car:cars(template_id)")
        .eq("id", projectId!)
        .maybeSingle();
      if (projectError) throw projectError;

      const templateId = (project as { car?: { template_id?: string | null } | null } | null)?.car?.template_id;
      if (!templateId) return null;

      const { data, error } = await supabase
        .from("car_stls")
        .select("*")
        .eq("car_template_id", templateId)
        .maybeSingle();
      if (error) throw error;
      return data as CarStl | null;
    },
  });
}

/**
 * Create a short-lived signed URL for a private object in the `car-stls` bucket.
 * The repaired path is preferred when present; falls back to the raw path.
 */
export function useSignedCarStlUrl(row: CarStl | null | undefined) {
  return useQuery({
    queryKey: ["signed_car_stl_url", row?.id, row?.repaired_stl_path ?? row?.stl_path],
    enabled: !!row,
    queryFn: async () => {
      const path = row!.repaired_stl_path ?? row!.stl_path;
      const { data, error } = await supabase.storage
        .from("car-stls")
        .createSignedUrl(path, 60 * 30); // 30 minutes
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 1000 * 60 * 20,
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
    mutationFn: async (input: {
      userId: string;
      name: string;
      carName?: string;
      garageCarId?: string | null;
    }) => {
      // If a garage car is provided, derive a sensible default car name from it.
      let derivedCarName = input.carName ?? "Untitled vehicle";
      if (input.garageCarId) {
        const { data: gc } = await supabase
          .from("garage_cars")
          .select("year, make, model, trim")
          .eq("id", input.garageCarId)
          .maybeSingle();
        if (gc) {
          derivedCarName =
            [gc.year, gc.make, gc.model, gc.trim].filter(Boolean).join(" ") ||
            derivedCarName;
        }
      }

      // Create a minimal car shell (no template required for the new flow).
      const { data: car, error: carErr } = await supabase.from("cars").insert({
        user_id: input.userId,
        name: derivedCarName,
      }).select("*").single();
      if (carErr) throw carErr;

      const { data: project, error: pErr } = await supabase.from("projects").insert({
        user_id: input.userId,
        car_id: car.id,
        name: input.name,
        status: "draft",
        garage_car_id: input.garageCarId ?? null,
      } as any).select("*").single();
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

/**
 * Spin up a fresh project for a given car_template applying a style preset.
 * Mirrors useCreateProject() but seeds the design brief with the preset and
 * the (optional) shared addendum prompt so the same DNA can be applied across
 * multiple cars in one click.
 *
 * Returns { project_id, brief_id } so the caller can immediately invoke
 * generate-concepts.
 */
export function useCreateProjectWithStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      template: CarTemplate;
      stylePresetId: string | null;
      addendumPrompt: string;
      styleTags: string[];
      constraints: string[];
      buildType: string | null;
      rightsConfirmed: boolean;
    }) => {
      const tName = `${input.template.make} ${input.template.model}${input.template.trim ? " " + input.template.trim : ""}`;
      const { data: car, error: carErr } = await supabase.from("cars").insert({
        user_id: input.userId,
        template_id: input.template.id,
        name: tName,
      }).select("*").single();
      if (carErr) throw carErr;

      const { data: project, error: pErr } = await supabase.from("projects").insert({
        user_id: input.userId,
        car_id: car.id,
        name: tName,
        status: "brief",
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

      await supabase.from("concept_sets").insert({
        user_id: input.userId,
        project_id: project.id,
        geometry_id: geo.id,
        name: "Working set",
        status: "draft",
      });

      const { data: brief, error: bErr } = await supabase.from("design_briefs").insert({
        user_id: input.userId,
        project_id: project.id,
        prompt: input.addendumPrompt,
        style_tags: input.styleTags,
        constraints: input.constraints,
        build_type: input.buildType,
        rights_confirmed: input.rightsConfirmed,
        style_preset_id: input.stylePresetId,
      } as any).select("*").single();
      if (bErr) throw bErr;

      return { project_id: project.id, brief_id: brief.id, project_name: tName };
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

/* ─── STYLE PRESETS (reusable styling DNA across cars) ─────── */
export function useStylePresets(userId: string | undefined) {
  return useQuery({
    queryKey: ["style_presets", userId],
    enabled: !!userId,
    queryFn: async () => {
      // RLS returns own + public automatically.
      const { data, error } = await supabase
        .from("style_presets")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StylePreset[];
    },
  });
}

export function useStylePreset(id: string | undefined | null) {
  return useQuery({
    queryKey: ["style_preset", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_presets")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as StylePreset | null;
    },
  });
}

export function useCreateStylePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; name: string }) => {
      const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const slug = `${base || "style"}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await supabase
        .from("style_presets")
        .insert({
          user_id: input.userId,
          name: input.name.trim() || "Untitled style",
          slug,
          prompt: "",
          style_tags: [],
          constraints: [],
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as StylePreset;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["style_presets"] }),
  });
}

export function useUpdateStylePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<StylePreset> }) => {
      const { data, error } = await supabase
        .from("style_presets")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as StylePreset;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["style_presets"] });
      qc.invalidateQueries({ queryKey: ["style_preset", d.id] });
    },
  });
}

export function useDeleteStylePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("style_presets").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["style_presets"] }),
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

/** Trigger the boolean aero-kit build for an approved concept. */
export function useBuildAeroKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conceptId: string) => {
      const { data, error } = await supabase.functions.invoke("build-aero-kit", {
        body: { concept_id: conceptId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, conceptId) => {
      qc.invalidateQueries({ queryKey: ["concepts"] });
      qc.invalidateQueries({ queryKey: ["concept_parts"] });
      qc.invalidateQueries({ queryKey: ["concept_aero_status", conceptId] });
    },
  });
}

/** Poll a concept's aero_kit_status while a build is in flight. */
export function useAeroKitStatus(conceptId: string | undefined, active: boolean) {
  return useQuery({
    queryKey: ["concept_aero_status", conceptId],
    enabled: !!conceptId,
    refetchInterval: active ? 2000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("concepts")
        .select("aero_kit_status, aero_kit_url, aero_kit_error, aero_kit_warning, updated_at")
        .eq("id", conceptId!)
        .maybeSingle();
      if (error) throw error;
      return data as {
        aero_kit_status: string;
        aero_kit_url: string | null;
        aero_kit_error: string | null;
        aero_kit_warning: string | null;
        updated_at: string;
      } | null;
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

/* ─── GARAGE CARS (user-owned OEM references) ───────────────── */
export type GarageCar = Database["public"]["Tables"]["garage_cars"]["Row"];

export function useGarageCars(userId: string | undefined) {
  return useQuery({
    queryKey: ["garage_cars", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("garage_cars")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as GarageCar[];
    },
    // While anything is generating, refetch frequently so the UI shows
    // images as soon as the edge function writes them.
    refetchInterval: (q) => {
      const rows = q.state.data as GarageCar[] | undefined;
      return rows?.some((r) => r.generation_status === "generating") ? 4000 : false;
    },
  });
}

export function useGarageCar(garageCarId: string | null | undefined) {
  return useQuery({
    queryKey: ["garage_car", garageCarId],
    enabled: !!garageCarId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("garage_cars")
        .select("*")
        .eq("id", garageCarId!)
        .maybeSingle();
      if (error) throw error;
      return data as GarageCar | null;
    },
    refetchInterval: (q) => {
      const row = q.state.data as GarageCar | null | undefined;
      return row?.generation_status === "generating" ? 4000 : false;
    },
  });
}

export function useCreateGarageCar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      make: string;
      model: string;
      year?: number | null;
      trim?: string | null;
      color?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.from("garage_cars").insert({
        user_id: input.userId,
        make: input.make.trim(),
        model: input.model.trim(),
        year: input.year ?? null,
        trim: input.trim?.trim() || null,
        color: input.color?.trim() || null,
        notes: input.notes?.trim() || null,
      }).select("*").single();
      if (error) throw error;
      return data as GarageCar;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["garage_cars"] }),
  });
}

export function useDeleteGarageCar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("garage_cars").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["garage_cars"] }),
  });
}

export function useGenerateGarageCarViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: string | { garageCarId: string; angles?: string[] },
    ) => {
      const { garageCarId, angles } =
        typeof input === "string" ? { garageCarId: input, angles: undefined } : input;
      const { data, error } = await supabase.functions.invoke("generate-garage-car-views", {
        body: { garage_car_id: garageCarId, angles },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["garage_cars"] }),
  });
}

/* ─── LIBRARY + MARKETPLACE ────────────────────────────────── */

export type LibraryItemKind = "concept_image" | "aero_kit_mesh" | "concept_part_mesh";
export type LibraryVisibility = "private" | "public";
export type MarketplaceListingStatus = "draft" | "active" | "paused";

export interface LibraryItem {
  id: string;
  user_id: string;
  kind: LibraryItemKind;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  asset_url: string | null;
  asset_mime: string | null;
  visibility: LibraryVisibility;
  project_id: string | null;
  concept_id: string | null;
  concept_part_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceListing {
  id: string;
  library_item_id: string;
  user_id: string;
  price_cents: number;
  currency: string;
  status: MarketplaceListingStatus;
  title: string | null;
  description: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceListingWithItem extends MarketplaceListing {
  library_items: LibraryItem | null;
}

/** All library items for the current signed-in user, plus any active listing. */
export function useMyLibrary(userId: string | undefined) {
  return useQuery({
    queryKey: ["library_items", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("library_items")
        .select("*, marketplace_listings(*)")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<LibraryItem & { marketplace_listings: MarketplaceListing[] }>;
    },
  });
}

export function useUpdateLibraryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      visibility?: LibraryVisibility;
      title?: string;
      description?: string | null;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await (supabase as any)
        .from("library_items")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as LibraryItem;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library_items"] });
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

export function useDeleteLibraryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("library_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library_items"] });
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

/**
 * Publish (or update) a marketplace listing for a library item. Also flips the
 * underlying library_item.visibility to 'public' so it's discoverable.
 */
export function usePublishListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      library_item_id: string;
      user_id: string;
      price_cents: number;
      title?: string | null;
      description?: string | null;
    }) => {
      // Upsert listing (one per library item via unique index)
      const { data: existing } = await (supabase as any)
        .from("marketplace_listings")
        .select("id")
        .eq("library_item_id", input.library_item_id)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await (supabase as any)
          .from("marketplace_listings")
          .update({
            price_cents: input.price_cents,
            title: input.title ?? null,
            description: input.description ?? null,
            status: "active" as MarketplaceListingStatus,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("marketplace_listings")
          .insert({
            library_item_id: input.library_item_id,
            user_id: input.user_id,
            price_cents: input.price_cents,
            title: input.title ?? null,
            description: input.description ?? null,
            status: "active" as MarketplaceListingStatus,
          });
        if (error) throw error;
      }

      const { error: libErr } = await (supabase as any)
        .from("library_items")
        .update({ visibility: "public" as LibraryVisibility })
        .eq("id", input.library_item_id);
      if (libErr) throw libErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library_items"] });
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

/** Pause a listing and flip the library item back to private. */
export function useUnpublishListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listing_id: string; library_item_id: string }) => {
      const { error: lErr } = await (supabase as any)
        .from("marketplace_listings")
        .update({ status: "paused" as MarketplaceListingStatus })
        .eq("id", input.listing_id);
      if (lErr) throw lErr;
      const { error: libErr } = await (supabase as any)
        .from("library_items")
        .update({ visibility: "private" as LibraryVisibility })
        .eq("id", input.library_item_id);
      if (libErr) throw libErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library_items"] });
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

/** Public-readable: all active listings + their (public) library item. */
export function useMarketplaceListings(filters?: { kind?: LibraryItemKind | "all" }) {
  return useQuery({
    queryKey: ["marketplace", filters?.kind ?? "all"],
    queryFn: async () => {
      let query = (supabase as any)
        .from("marketplace_listings")
        .select("*, library_items!inner(*)")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (filters?.kind && filters.kind !== "all") {
        query = query.eq("library_items.kind", filters.kind);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as MarketplaceListingWithItem[];
    },
  });
}

