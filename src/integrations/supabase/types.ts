export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aero_components: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          kind: string
          params: Json
          updated_at: string
          user_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          params?: Json
          updated_at?: string
          user_id: string
          variant_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          params?: Json
          updated_at?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aero_components_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      builds: {
        Row: {
          car_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          objective: Database["public"]["Enums"]["objective_type"]
          starred: boolean
          status: Database["public"]["Enums"]["build_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          objective?: Database["public"]["Enums"]["objective_type"]
          starred?: boolean
          status?: Database["public"]["Enums"]["build_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          objective?: Database["public"]["Enums"]["objective_type"]
          starred?: boolean
          status?: Database["public"]["Enums"]["build_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builds_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      car_templates: {
        Row: {
          cd_stock: number | null
          created_at: string
          default_tyre: string | null
          drivetrain: string | null
          frontal_area_m2: number | null
          id: string
          make: string
          mass_kg: number | null
          model: string
          slug: string
          supported: boolean
          track_front_mm: number | null
          track_rear_mm: number | null
          trim: string | null
          updated_at: string
          wheelbase_mm: number | null
          year_range: string | null
        }
        Insert: {
          cd_stock?: number | null
          created_at?: string
          default_tyre?: string | null
          drivetrain?: string | null
          frontal_area_m2?: number | null
          id?: string
          make: string
          mass_kg?: number | null
          model: string
          slug: string
          supported?: boolean
          track_front_mm?: number | null
          track_rear_mm?: number | null
          trim?: string | null
          updated_at?: string
          wheelbase_mm?: number | null
          year_range?: string | null
        }
        Update: {
          cd_stock?: number | null
          created_at?: string
          default_tyre?: string | null
          drivetrain?: string | null
          frontal_area_m2?: number | null
          id?: string
          make?: string
          mass_kg?: number | null
          model?: string
          slug?: string
          supported?: boolean
          track_front_mm?: number | null
          track_rear_mm?: number | null
          trim?: string | null
          updated_at?: string
          wheelbase_mm?: number | null
          year_range?: string | null
        }
        Relationships: []
      }
      cars: {
        Row: {
          created_at: string
          id: string
          name: string
          nickname: string | null
          notes: string | null
          template_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          nickname?: string | null
          notes?: string | null
          template_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          nickname?: string | null
          notes?: string | null
          template_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cars_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          audience: string
          build_id: string | null
          created_at: string
          expires_at: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          kind: Database["public"]["Enums"]["export_kind"]
          sections: Json
          status: Database["public"]["Enums"]["export_status"]
          updated_at: string
          user_id: string
          variant_id: string | null
        }
        Insert: {
          audience?: string
          build_id?: string | null
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          kind: Database["public"]["Enums"]["export_kind"]
          sections?: Json
          status?: Database["public"]["Enums"]["export_status"]
          updated_at?: string
          user_id: string
          variant_id?: string | null
        }
        Update: {
          audience?: string
          build_id?: string | null
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["export_kind"]
          sections?: Json
          status?: Database["public"]["Enums"]["export_status"]
          updated_at?: string
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exports_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      geometries: {
        Row: {
          build_id: string
          created_at: string
          id: string
          metadata: Json
          ride_height_front_mm: number | null
          ride_height_rear_mm: number | null
          source: string
          steady_state: boolean
          stl_path: string | null
          underbody_model: string
          updated_at: string
          user_id: string
          wheel_rotation: string
        }
        Insert: {
          build_id: string
          created_at?: string
          id?: string
          metadata?: Json
          ride_height_front_mm?: number | null
          ride_height_rear_mm?: number | null
          source?: string
          steady_state?: boolean
          stl_path?: string | null
          underbody_model?: string
          updated_at?: string
          user_id: string
          wheel_rotation?: string
        }
        Update: {
          build_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          ride_height_front_mm?: number | null
          ride_height_rear_mm?: number | null
          source?: string
          steady_state?: boolean
          stl_path?: string | null
          underbody_model?: string
          updated_at?: string
          user_id?: string
          wheel_rotation?: string
        }
        Relationships: [
          {
            foreignKeyName: "geometries_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      optimization_jobs: {
        Row: {
          allowed_components: Json
          baseline_variant_id: string | null
          best_candidate: Json | null
          build_id: string
          candidates_evaluated: number
          candidates_total: number
          completed_at: string | null
          confidence: Database["public"]["Enums"]["confidence_level"]
          constraints: Json
          created_at: string
          credits_charged: number
          id: string
          objective: Database["public"]["Enums"]["objective_type"]
          objective_weights: Json
          ranked_candidates: Json
          reasoning: string | null
          started_at: string | null
          state: Database["public"]["Enums"]["job_state"]
          updated_at: string
          user_id: string
          walltime_s: number | null
        }
        Insert: {
          allowed_components?: Json
          baseline_variant_id?: string | null
          best_candidate?: Json | null
          build_id: string
          candidates_evaluated?: number
          candidates_total?: number
          completed_at?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"]
          constraints?: Json
          created_at?: string
          credits_charged?: number
          id?: string
          objective: Database["public"]["Enums"]["objective_type"]
          objective_weights?: Json
          ranked_candidates?: Json
          reasoning?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["job_state"]
          updated_at?: string
          user_id: string
          walltime_s?: number | null
        }
        Update: {
          allowed_components?: Json
          baseline_variant_id?: string | null
          best_candidate?: Json | null
          build_id?: string
          candidates_evaluated?: number
          candidates_total?: number
          completed_at?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"]
          constraints?: Json
          created_at?: string
          credits_charged?: number
          id?: string
          objective?: Database["public"]["Enums"]["objective_type"]
          objective_weights?: Json
          ranked_candidates?: Json
          reasoning?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["job_state"]
          updated_at?: string
          user_id?: string
          walltime_s?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "optimization_jobs_baseline_variant_id_fkey"
            columns: ["baseline_variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optimization_jobs_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits: number
          display_name: string | null
          id: string
          org: string | null
          plan: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id: string
          org?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id?: string
          org?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      simulation_jobs: {
        Row: {
          air_density: number
          assumptions_snapshot: Json
          completed_at: string | null
          created_at: string
          credits_charged: number
          error_message: string | null
          id: string
          iterations_done: number
          iterations_target: number
          kind: Database["public"]["Enums"]["job_kind"]
          residual: string | null
          solver: string
          speed_kmh: number
          started_at: string | null
          state: Database["public"]["Enums"]["job_state"]
          updated_at: string
          user_id: string
          variant_id: string
          walltime_s: number | null
          yaw_deg: number
        }
        Insert: {
          air_density?: number
          assumptions_snapshot?: Json
          completed_at?: string | null
          created_at?: string
          credits_charged?: number
          error_message?: string | null
          id?: string
          iterations_done?: number
          iterations_target?: number
          kind?: Database["public"]["Enums"]["job_kind"]
          residual?: string | null
          solver?: string
          speed_kmh?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["job_state"]
          updated_at?: string
          user_id: string
          variant_id: string
          walltime_s?: number | null
          yaw_deg?: number
        }
        Update: {
          air_density?: number
          assumptions_snapshot?: Json
          completed_at?: string | null
          created_at?: string
          credits_charged?: number
          error_message?: string | null
          id?: string
          iterations_done?: number
          iterations_target?: number
          kind?: Database["public"]["Enums"]["job_kind"]
          residual?: string | null
          solver?: string
          speed_kmh?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["job_state"]
          updated_at?: string
          user_id?: string
          variant_id?: string
          walltime_s?: number | null
          yaw_deg?: number
        }
        Relationships: [
          {
            foreignKeyName: "simulation_jobs_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_results: {
        Row: {
          balance_front_pct: number
          cd: number
          confidence: Database["public"]["Enums"]["confidence_level"]
          confidence_reasons: Json
          cp_roof: number | null
          cp_stagnation: number | null
          cp_underfloor: number | null
          cp_wing: number | null
          created_at: string
          df_front_kgf: number
          df_rear_kgf: number
          df_total_kgf: number
          drag_kgf: number
          id: string
          is_stale: boolean
          job_id: string
          kind: Database["public"]["Enums"]["job_kind"]
          ld_ratio: number
          raw_data: Json
          stability_score: number | null
          top_speed_kmh: number | null
          track_score: number | null
          user_id: string
          v_max_roof: number | null
          v_underfloor: number | null
          variant_id: string
        }
        Insert: {
          balance_front_pct: number
          cd: number
          confidence?: Database["public"]["Enums"]["confidence_level"]
          confidence_reasons?: Json
          cp_roof?: number | null
          cp_stagnation?: number | null
          cp_underfloor?: number | null
          cp_wing?: number | null
          created_at?: string
          df_front_kgf: number
          df_rear_kgf: number
          df_total_kgf: number
          drag_kgf: number
          id?: string
          is_stale?: boolean
          job_id: string
          kind: Database["public"]["Enums"]["job_kind"]
          ld_ratio: number
          raw_data?: Json
          stability_score?: number | null
          top_speed_kmh?: number | null
          track_score?: number | null
          user_id: string
          v_max_roof?: number | null
          v_underfloor?: number | null
          variant_id: string
        }
        Update: {
          balance_front_pct?: number
          cd?: number
          confidence?: Database["public"]["Enums"]["confidence_level"]
          confidence_reasons?: Json
          cp_roof?: number | null
          cp_stagnation?: number | null
          cp_underfloor?: number | null
          cp_wing?: number | null
          created_at?: string
          df_front_kgf?: number
          df_rear_kgf?: number
          df_total_kgf?: number
          drag_kgf?: number
          id?: string
          is_stale?: boolean
          job_id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          ld_ratio?: number
          raw_data?: Json
          stability_score?: number | null
          top_speed_kmh?: number | null
          track_score?: number | null
          user_id?: string
          v_max_roof?: number | null
          v_underfloor?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "simulation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_results_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variants: {
        Row: {
          build_id: string
          created_at: string
          geometry_id: string | null
          id: string
          is_baseline: boolean
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["variant_status"]
          tag: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          build_id: string
          created_at?: string
          geometry_id?: string | null
          id?: string
          is_baseline?: boolean
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["variant_status"]
          tag?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          build_id?: string
          created_at?: string
          geometry_id?: string | null
          id?: string
          is_baseline?: boolean
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["variant_status"]
          tag?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variants_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_geometry_id_fkey"
            columns: ["geometry_id"]
            isOneToOne: false
            referencedRelation: "geometries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "engineer" | "viewer"
      build_status: "draft" | "ready" | "archived"
      confidence_level: "low" | "medium" | "high"
      export_kind:
        | "pdf_report"
        | "image_pack"
        | "comparison_sheet"
        | "aero_summary"
        | "stl_pack"
        | "assumptions_sheet"
      export_status: "generating" | "ready" | "expired" | "failed"
      job_kind: "preview" | "full" | "optimization"
      job_state:
        | "queued"
        | "preprocessing"
        | "simulating"
        | "postprocessing"
        | "completed"
        | "failed"
        | "cancelled"
      objective_type:
        | "top_speed"
        | "track_use"
        | "balance"
        | "high_speed_stability"
        | "rear_grip"
        | "custom"
      plan_tier: "free" | "pro" | "team" | "enterprise"
      variant_status:
        | "draft"
        | "validating"
        | "ready"
        | "simulating"
        | "completed"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "engineer", "viewer"],
      build_status: ["draft", "ready", "archived"],
      confidence_level: ["low", "medium", "high"],
      export_kind: [
        "pdf_report",
        "image_pack",
        "comparison_sheet",
        "aero_summary",
        "stl_pack",
        "assumptions_sheet",
      ],
      export_status: ["generating", "ready", "expired", "failed"],
      job_kind: ["preview", "full", "optimization"],
      job_state: [
        "queued",
        "preprocessing",
        "simulating",
        "postprocessing",
        "completed",
        "failed",
        "cancelled",
      ],
      objective_type: [
        "top_speed",
        "track_use",
        "balance",
        "high_speed_stability",
        "rear_grip",
        "custom",
      ],
      plan_tier: ["free", "pro", "team", "enterprise"],
      variant_status: [
        "draft",
        "validating",
        "ready",
        "simulating",
        "completed",
        "failed",
      ],
    },
  },
} as const
