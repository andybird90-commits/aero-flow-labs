/**
 * AeroLab data layer — typed React Query hooks over Lovable Cloud.
 * Use these from pages instead of calling supabase.from(...) directly.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile        = Database["public"]["Tables"]["profiles"]["Row"];
export type CarTemplate    = Database["public"]["Tables"]["car_templates"]["Row"];
export type Car            = Database["public"]["Tables"]["cars"]["Row"];
export type Build          = Database["public"]["Tables"]["builds"]["Row"];
export type Geometry       = Database["public"]["Tables"]["geometries"]["Row"];
export type Variant        = Database["public"]["Tables"]["variants"]["Row"];
export type AeroComponent  = Database["public"]["Tables"]["aero_components"]["Row"];
export type SimJob         = Database["public"]["Tables"]["simulation_jobs"]["Row"];
export type SimResult      = Database["public"]["Tables"]["simulation_results"]["Row"];
export type OptJob         = Database["public"]["Tables"]["optimization_jobs"]["Row"];
export type ExportRow      = Database["public"]["Tables"]["exports"]["Row"];

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

/* ─── CARS (per user) ──────────────────────────────────────── */
export function useCars(userId: string | undefined) {
  return useQuery({
    queryKey: ["cars", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cars").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Car[];
    },
  });
}

/* ─── BUILDS ───────────────────────────────────────────────── */
export function useBuilds(userId: string | undefined) {
  return useQuery({
    queryKey: ["builds", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builds")
        .select("*, car:cars(*, template:car_templates(*))")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as (Build & { car: Car & { template: CarTemplate | null } })[];
    },
  });
}

export function useBuild(buildId: string | undefined) {
  return useQuery({
    queryKey: ["build", buildId],
    enabled: !!buildId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builds")
        .select("*, car:cars(*, template:car_templates(*))")
        .eq("id", buildId!)
        .maybeSingle();
      if (error) throw error;
      return data as (Build & { car: Car & { template: CarTemplate | null } }) | null;
    },
  });
}

export function useCreateBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; templateSlug: string; name: string; objective: Database["public"]["Enums"]["objective_type"] }) => {
      const { data: tpl, error: tplErr } = await supabase.from("car_templates").select("*").eq("slug", input.templateSlug).maybeSingle();
      if (tplErr) throw tplErr;
      if (!tpl) throw new Error("Template not found");

      const { data: car, error: carErr } = await supabase.from("cars").insert({
        user_id: input.userId, template_id: tpl.id, name: `${tpl.make} ${tpl.model}`,
      }).select("*").single();
      if (carErr) throw carErr;

      const { data: build, error: buildErr } = await supabase.from("builds").insert({
        user_id: input.userId, car_id: car.id, name: input.name,
        objective: input.objective, status: "draft",
      }).select("*").single();
      if (buildErr) throw buildErr;

      const { data: geo, error: geoErr } = await supabase.from("geometries").insert({
        user_id: input.userId, build_id: build.id, source: "template",
        ride_height_front_mm: 130, ride_height_rear_mm: 135,
        underbody_model: "simplified", wheel_rotation: "static", steady_state: true,
      }).select("*").single();
      if (geoErr) throw geoErr;

      // Create a baseline variant
      await supabase.from("variants").insert({
        user_id: input.userId, build_id: build.id, geometry_id: geo.id,
        name: "Baseline", tag: "Baseline", status: "draft", is_baseline: true,
      });

      return build;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["builds"] });
      qc.invalidateQueries({ queryKey: ["cars"] });
    },
  });
}

export function useUpdateBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Build> }) => {
      const { data, error } = await supabase.from("builds").update(input.patch).eq("id", input.id).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["builds"] });
      qc.invalidateQueries({ queryKey: ["build", v.id] });
    },
  });
}

export function useDuplicateBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (buildId: string) => {
      const { data, error } = await supabase.rpc("duplicate_build", { _build_id: buildId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["builds"] }),
  });
}

export function useDeleteBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (buildId: string) => {
      const { error } = await supabase.from("builds").delete().eq("id", buildId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["builds"] }),
  });
}

/* ─── GEOMETRY ─────────────────────────────────────────────── */
export function useGeometry(buildId: string | undefined) {
  return useQuery({
    queryKey: ["geometry", buildId],
    enabled: !!buildId,
    queryFn: async () => {
      const { data, error } = await supabase.from("geometries")
        .select("*").eq("build_id", buildId!)
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
      // Mark all results for this build's variants stale
      await supabase.from("simulation_results").update({ is_stale: true }).eq("user_id", data.user_id);
      return data as Geometry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["geometry", data.build_id] });
      qc.invalidateQueries({ queryKey: ["variants", data.build_id] });
    },
  });
}

/* ─── VARIANTS ─────────────────────────────────────────────── */
export function useVariants(buildId: string | undefined) {
  return useQuery({
    queryKey: ["variants", buildId],
    enabled: !!buildId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variants")
        .select("*, results:simulation_results(*)")
        .eq("build_id", buildId!)
        .order("created_at");
      if (error) throw error;
      return data as (Variant & { results: SimResult[] })[];
    },
  });
}

export function useCreateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; buildId: string; geometryId: string | null; name: string; tag?: string | null }) => {
      const { data, error } = await supabase.from("variants").insert({
        user_id: input.userId, build_id: input.buildId, geometry_id: input.geometryId,
        name: input.name, tag: input.tag ?? null, status: "draft", is_baseline: false,
      }).select("*").single();
      if (error) throw error;
      return data as Variant;
    },
    onSuccess: (v) => qc.invalidateQueries({ queryKey: ["variants", v.build_id] }),
  });
}

export function useDuplicateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (variantId: string) => {
      const { data, error } = await supabase.rpc("duplicate_variant", { _variant_id: variantId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (variantId: string) => {
      const { error } = await supabase.from("variants").delete().eq("id", variantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUpdateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Variant> }) => {
      const { data, error } = await supabase.from("variants").update(input.patch).eq("id", input.id).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/* ─── AERO COMPONENTS ──────────────────────────────────────── */
export function useComponents(variantId: string | undefined) {
  return useQuery({
    queryKey: ["components", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("aero_components")
        .select("*").eq("variant_id", variantId!).order("created_at");
      if (error) throw error;
      return data as AeroComponent[];
    },
  });
}

export function useUpsertComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; variantId: string; id?: string; kind: string; params: any; enabled: boolean }) => {
      if (input.id) {
        const { data, error } = await supabase.from("aero_components")
          .update({ kind: input.kind, params: input.params, enabled: input.enabled })
          .eq("id", input.id).select("*").single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("aero_components").insert({
        user_id: input.userId, variant_id: input.variantId,
        kind: input.kind, params: input.params, enabled: input.enabled,
      }).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => qc.invalidateQueries({ queryKey: ["components", d.variant_id] }),
  });
}

export function useDeleteComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("aero_components").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["components"] }),
  });
}

/* ─── RESULTS ──────────────────────────────────────────────── */
export function useUserResults(userId: string | undefined) {
  return useQuery({
    queryKey: ["results", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("simulation_results")
        .select("*, variant:variants(*, build:builds(*, car:cars(*, template:car_templates(*))))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (SimResult & { variant: Variant & { build: Build & { car: Car & { template: CarTemplate | null } } } })[];
    },
  });
}

export function useLatestResult(variantId: string | undefined) {
  return useQuery({
    queryKey: ["result", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("simulation_results")
        .select("*").eq("variant_id", variantId!)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as SimResult | null;
    },
  });
}

/* ─── SIMULATION JOBS ──────────────────────────────────────── */
export function useUserJobs(userId: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ["jobs", userId, limit],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("simulation_jobs")
        .select("*, variant:variants(name, build:builds(name, car:cars(name)))")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as (SimJob & { variant: { name: string; build: { name: string; car: { name: string } } } })[];
    },
  });
}

export function useVariantJobs(variantId: string | undefined) {
  return useQuery({
    queryKey: ["variant_jobs", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("simulation_jobs")
        .select("*").eq("variant_id", variantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SimJob[];
    },
  });
}

export function useRunSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { variant_id: string; kind: "preview" | "full"; speed_kmh?: number; yaw_deg?: number; air_density?: number }) => {
      const { data, error } = await supabase.functions.invoke("simulate-variant", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { job_id: string; status: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["variant_jobs"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

/* ─── REALTIME job subscription ────────────────────────────── */
export function useJobRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`jobs-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "simulation_jobs", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["jobs"] });
          qc.invalidateQueries({ queryKey: ["variant_jobs"] });
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "simulation_results", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["results"] });
          qc.invalidateQueries({ queryKey: ["variants"] });
          qc.invalidateQueries({ queryKey: ["result"] });
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "optimization_jobs", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["opt_jobs"] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);
}

/* ─── OPTIMIZATION JOBS ────────────────────────────────────── */
export function useOptJobs(userId: string | undefined) {
  return useQuery({
    queryKey: ["opt_jobs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("optimization_jobs")
        .select("*, build:builds(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (OptJob & { build: { name: string } })[];
    },
  });
}

export function useBuildOptJobs(buildId: string | undefined) {
  return useQuery({
    queryKey: ["opt_jobs", "build", buildId],
    enabled: !!buildId,
    queryFn: async () => {
      const { data, error } = await supabase.from("optimization_jobs")
        .select("*").eq("build_id", buildId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as OptJob[];
    },
  });
}

export function useRunOptimization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { build_id: string; objective: string; allowed_components?: string[]; constraints?: any }) => {
      const { data, error } = await supabase.functions.invoke("run-optimization", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { job_id: string; status: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opt_jobs"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
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
        .select("*, build:builds(name), variant:variants(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (ExportRow & { build: { name: string } | null; variant: { name: string } | null })[];
    },
  });
}

export function useGenerateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { build_id?: string | null; variant_id?: string | null; kind: string; sections?: string[]; audience?: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-export", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { export_id: string; status: string; path: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exports"] }),
  });
}

export async function downloadExport(filePath: string, filename: string) {
  const { data, error } = await supabase.storage.from("exports").createSignedUrl(filePath, 60);
  if (error || !data) throw error ?? new Error("Failed to sign URL");
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ─── SEED DEMO BUILD (calls edge function) ────────────────── */
export function useSeedDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("seed-demo-build");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
