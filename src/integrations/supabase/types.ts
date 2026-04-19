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
      concept_sets: {
        Row: {
          created_at: string
          geometry_id: string | null
          id: string
          name: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["concept_set_status"]
          tag: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          geometry_id?: string | null
          id?: string
          name: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["concept_set_status"]
          tag?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          geometry_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["concept_set_status"]
          tag?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variants_build_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      concepts: {
        Row: {
          ai_notes: string | null
          concept_set_id: string | null
          created_at: string
          direction: string | null
          id: string
          locked_features: Json
          preview_mesh_error: string | null
          preview_mesh_status: string
          preview_mesh_url: string | null
          project_id: string
          render_front_url: string | null
          render_rear_url: string | null
          render_rear34_url: string | null
          render_side_url: string | null
          status: Database["public"]["Enums"]["concept_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_notes?: string | null
          concept_set_id?: string | null
          created_at?: string
          direction?: string | null
          id?: string
          locked_features?: Json
          preview_mesh_error?: string | null
          preview_mesh_status?: string
          preview_mesh_url?: string | null
          project_id: string
          render_front_url?: string | null
          render_rear_url?: string | null
          render_rear34_url?: string | null
          render_side_url?: string | null
          status?: Database["public"]["Enums"]["concept_status"]
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_notes?: string | null
          concept_set_id?: string | null
          created_at?: string
          direction?: string | null
          id?: string
          locked_features?: Json
          preview_mesh_error?: string | null
          preview_mesh_status?: string
          preview_mesh_url?: string | null
          project_id?: string
          render_front_url?: string | null
          render_rear_url?: string | null
          render_rear34_url?: string | null
          render_side_url?: string | null
          status?: Database["public"]["Enums"]["concept_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concepts_concept_set_id_fkey"
            columns: ["concept_set_id"]
            isOneToOne: false
            referencedRelation: "concept_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concepts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      design_briefs: {
        Row: {
          build_type: string | null
          constraints: string[]
          created_at: string
          id: string
          project_id: string
          prompt: string
          reference_image_paths: string[]
          rights_confirmed: boolean
          style_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          build_type?: string | null
          constraints?: string[]
          created_at?: string
          id?: string
          project_id: string
          prompt?: string
          reference_image_paths?: string[]
          rights_confirmed?: boolean
          style_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          build_type?: string | null
          constraints?: string[]
          created_at?: string
          id?: string
          project_id?: string
          prompt?: string
          reference_image_paths?: string[]
          rights_confirmed?: boolean
          style_tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_briefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          audience: string
          concept_set_id: string | null
          created_at: string
          expires_at: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          kind: Database["public"]["Enums"]["export_kind"]
          project_id: string | null
          sections: Json
          status: Database["public"]["Enums"]["export_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          audience?: string
          concept_set_id?: string | null
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          kind: Database["public"]["Enums"]["export_kind"]
          project_id?: string | null
          sections?: Json
          status?: Database["public"]["Enums"]["export_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          audience?: string
          concept_set_id?: string | null
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["export_kind"]
          project_id?: string | null
          sections?: Json
          status?: Database["public"]["Enums"]["export_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exports_build_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_variant_id_fkey"
            columns: ["concept_set_id"]
            isOneToOne: false
            referencedRelation: "concept_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      fitted_parts: {
        Row: {
          concept_set_id: string
          created_at: string
          enabled: boolean
          id: string
          kind: string
          params: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          concept_set_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          params?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          concept_set_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          params?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aero_components_variant_id_fkey"
            columns: ["concept_set_id"]
            isOneToOne: false
            referencedRelation: "concept_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      geometries: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          project_id: string
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
          created_at?: string
          id?: string
          metadata?: Json
          project_id: string
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
          created_at?: string
          id?: string
          metadata?: Json
          project_id?: string
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
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_generation_jobs: {
        Row: {
          completed_at: string | null
          concept_id: string | null
          created_at: string
          error_message: string | null
          id: string
          project_id: string
          reasoning: string | null
          started_at: string | null
          state: Database["public"]["Enums"]["parts_job_state"]
          suggested_params: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          concept_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          project_id: string
          reasoning?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["parts_job_state"]
          suggested_params?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          concept_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          project_id?: string
          reasoning?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["parts_job_state"]
          suggested_params?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_generation_jobs_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_generation_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      projects: {
        Row: {
          car_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          starred: boolean
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          starred?: boolean
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          starred?: boolean
          status?: Database["public"]["Enums"]["project_status"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decrement_credits: {
        Args: { _amount: number; _user_id: string }
        Returns: number
      }
      duplicate_project: { Args: { _project_id: string }; Returns: string }
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
      concept_set_status:
        | "draft"
        | "generating"
        | "ready"
        | "approved"
        | "failed"
      concept_status: "pending" | "approved" | "rejected" | "favourited"
      export_kind:
        | "kit_stl_pack"
        | "kit_obj_pack"
        | "single_part_stl"
        | "single_part_obj"
        | "project_pack"
      export_status: "generating" | "ready" | "expired" | "failed"
      job_state:
        | "queued"
        | "preprocessing"
        | "simulating"
        | "postprocessing"
        | "completed"
        | "failed"
        | "cancelled"
      parts_job_state:
        | "queued"
        | "analyzing"
        | "generating"
        | "completed"
        | "failed"
      plan_tier: "free" | "pro" | "team" | "enterprise"
      project_status:
        | "draft"
        | "brief"
        | "concepts"
        | "approved"
        | "parts"
        | "exported"
        | "archived"
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
      concept_set_status: [
        "draft",
        "generating",
        "ready",
        "approved",
        "failed",
      ],
      concept_status: ["pending", "approved", "rejected", "favourited"],
      export_kind: [
        "kit_stl_pack",
        "kit_obj_pack",
        "single_part_stl",
        "single_part_obj",
        "project_pack",
      ],
      export_status: ["generating", "ready", "expired", "failed"],
      job_state: [
        "queued",
        "preprocessing",
        "simulating",
        "postprocessing",
        "completed",
        "failed",
        "cancelled",
      ],
      parts_job_state: [
        "queued",
        "analyzing",
        "generating",
        "completed",
        "failed",
      ],
      plan_tier: ["free", "pro", "team", "enterprise"],
      project_status: [
        "draft",
        "brief",
        "concepts",
        "approved",
        "parts",
        "exported",
        "archived",
      ],
    },
  },
} as const
