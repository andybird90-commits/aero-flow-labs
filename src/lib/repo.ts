/**
 * AeroLab data layer — typed React Query hooks over Supabase.
 * Use these from pages instead of calling supabase.from(...) directly.
 */
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
export type Export         = Database["public"]["Tables"]["exports"]["Row"];

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
      // 1) Find template
      const { data: tpl, error: tplErr } = await supabase.from("car_templates").select("*").eq("slug", input.templateSlug).maybeSingle();
      if (tplErr) throw tplErr;
      if (!tpl) throw new Error("Template not found");

      // 2) Create car instance
      const { data: car, error: carErr } = await supabase.from("cars").insert({
        user_id: input.userId,
        template_id: tpl.id,
        name: `${tpl.make} ${tpl.model}`,
      }).select("*").single();
      if (carErr) throw carErr;

      // 3) Create build
      const { data: build, error: buildErr } = await supabase.from("builds").insert({
        user_id: input.userId,
        car_id: car.id,
        name: input.name,
        objective: input.objective,
        status: "draft",
      }).select("*").single();
      if (buildErr) throw buildErr;

      // 4) Create default geometry
      const { error: geoErr } = await supabase.from("geometries").insert({
        user_id: input.userId,
        build_id: build.id,
        source: "template",
        ride_height_front_mm: 130,
        ride_height_rear_mm: 135,
        underbody_model: "simplified",
        wheel_rotation: "static",
        steady_state: true,
      });
      if (geoErr) throw geoErr;

      return build;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["builds"] });
      qc.invalidateQueries({ queryKey: ["cars"] });
    },
  });
}

/* ─── VARIANTS + RESULTS (per build) ───────────────────────── */
export function useVariants(buildId: string | undefined) {
  return useQuery({
    queryKey: ["variants", buildId],
    enabled: !!buildId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variants")
        .select("*, latest_result:simulation_results(*)")
        .eq("build_id", buildId!)
        .order("created_at");
      if (error) throw error;
      return data as (Variant & { latest_result: SimResult[] })[];
    },
  });
}

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
