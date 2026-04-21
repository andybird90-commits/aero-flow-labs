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
      car_stls: {
        Row: {
          bbox_max_mm: Json | null
          bbox_min_mm: Json | null
          car_template_id: string
          created_at: string
          forward_axis: string
          id: string
          manifold_clean: boolean
          notes: string | null
          repaired_stl_path: string | null
          stl_path: string
          triangle_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bbox_max_mm?: Json | null
          bbox_min_mm?: Json | null
          car_template_id: string
          created_at?: string
          forward_axis?: string
          id?: string
          manifold_clean?: boolean
          notes?: string | null
          repaired_stl_path?: string | null
          stl_path: string
          triangle_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bbox_max_mm?: Json | null
          bbox_min_mm?: Json | null
          car_template_id?: string
          created_at?: string
          forward_axis?: string
          id?: string
          manifold_clean?: boolean
          notes?: string | null
          repaired_stl_path?: string | null
          stl_path?: string
          triangle_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_stls_car_template_id_fkey"
            columns: ["car_template_id"]
            isOneToOne: true
            referencedRelation: "car_templates"
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
      concept_parts: {
        Row: {
          concept_id: string
          created_at: string
          fidelity_breakdown: Json | null
          fidelity_score: number | null
          glb_url: string | null
          id: string
          isolated_meta: Json | null
          isolated_source_url: string | null
          kind: string
          label: string | null
          project_id: string
          render_urls: Json
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          concept_id: string
          created_at?: string
          fidelity_breakdown?: Json | null
          fidelity_score?: number | null
          glb_url?: string | null
          id?: string
          isolated_meta?: Json | null
          isolated_source_url?: string | null
          kind: string
          label?: string | null
          project_id: string
          render_urls?: Json
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          concept_id?: string
          created_at?: string
          fidelity_breakdown?: Json | null
          fidelity_score?: number | null
          glb_url?: string | null
          id?: string
          isolated_meta?: Json | null
          isolated_source_url?: string | null
          kind?: string
          label?: string | null
          project_id?: string
          render_urls?: Json
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          aero_kit_error: string | null
          aero_kit_status: string
          aero_kit_url: string | null
          aero_kit_warning: string | null
          ai_notes: string | null
          carbon_error: string | null
          carbon_status: string
          concept_set_id: string | null
          created_at: string
          direction: string | null
          hotspots: Json
          id: string
          locked_features: Json
          preview_mesh_error: string | null
          preview_mesh_status: string
          preview_mesh_url: string | null
          project_id: string
          prompt_used: string | null
          render_front_carbon_url: string | null
          render_front_direct_url: string | null
          render_front_url: string | null
          render_rear_carbon_url: string | null
          render_rear_url: string | null
          render_rear34_carbon_url: string | null
          render_rear34_url: string | null
          render_side_carbon_url: string | null
          render_side_opposite_url: string | null
          render_side_url: string | null
          status: Database["public"]["Enums"]["concept_status"]
          title: string
          updated_at: string
          user_id: string
          variation_label: string | null
          variation_seed: Json
        }
        Insert: {
          aero_kit_error?: string | null
          aero_kit_status?: string
          aero_kit_url?: string | null
          aero_kit_warning?: string | null
          ai_notes?: string | null
          carbon_error?: string | null
          carbon_status?: string
          concept_set_id?: string | null
          created_at?: string
          direction?: string | null
          hotspots?: Json
          id?: string
          locked_features?: Json
          preview_mesh_error?: string | null
          preview_mesh_status?: string
          preview_mesh_url?: string | null
          project_id: string
          prompt_used?: string | null
          render_front_carbon_url?: string | null
          render_front_direct_url?: string | null
          render_front_url?: string | null
          render_rear_carbon_url?: string | null
          render_rear_url?: string | null
          render_rear34_carbon_url?: string | null
          render_rear34_url?: string | null
          render_side_carbon_url?: string | null
          render_side_opposite_url?: string | null
          render_side_url?: string | null
          status?: Database["public"]["Enums"]["concept_status"]
          title?: string
          updated_at?: string
          user_id: string
          variation_label?: string | null
          variation_seed?: Json
        }
        Update: {
          aero_kit_error?: string | null
          aero_kit_status?: string
          aero_kit_url?: string | null
          aero_kit_warning?: string | null
          ai_notes?: string | null
          carbon_error?: string | null
          carbon_status?: string
          concept_set_id?: string | null
          created_at?: string
          direction?: string | null
          hotspots?: Json
          id?: string
          locked_features?: Json
          preview_mesh_error?: string | null
          preview_mesh_status?: string
          preview_mesh_url?: string | null
          project_id?: string
          prompt_used?: string | null
          render_front_carbon_url?: string | null
          render_front_direct_url?: string | null
          render_front_url?: string | null
          render_rear_carbon_url?: string | null
          render_rear_url?: string | null
          render_rear34_carbon_url?: string | null
          render_rear34_url?: string | null
          render_side_carbon_url?: string | null
          render_side_opposite_url?: string | null
          render_side_url?: string | null
          status?: Database["public"]["Enums"]["concept_status"]
          title?: string
          updated_at?: string
          user_id?: string
          variation_label?: string | null
          variation_seed?: Json
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
          aggression: string | null
          build_type: string | null
          constraints: string[]
          created_at: string
          discipline: string | null
          id: string
          must_avoid: string[]
          must_include: string[]
          project_id: string
          prompt: string
          reference_image_paths: string[]
          rights_confirmed: boolean
          style_preset_id: string | null
          style_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          aggression?: string | null
          build_type?: string | null
          constraints?: string[]
          created_at?: string
          discipline?: string | null
          id?: string
          must_avoid?: string[]
          must_include?: string[]
          project_id: string
          prompt?: string
          reference_image_paths?: string[]
          rights_confirmed?: boolean
          style_preset_id?: string | null
          style_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          aggression?: string | null
          build_type?: string | null
          constraints?: string[]
          created_at?: string
          discipline?: string | null
          id?: string
          must_avoid?: string[]
          must_include?: string[]
          project_id?: string
          prompt?: string
          reference_image_paths?: string[]
          rights_confirmed?: boolean
          style_preset_id?: string | null
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
          {
            foreignKeyName: "design_briefs_style_preset_id_fkey"
            columns: ["style_preset_id"]
            isOneToOne: false
            referencedRelation: "style_presets"
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
      garage_cars: {
        Row: {
          color: string | null
          created_at: string
          generation_error: string | null
          generation_status: string
          id: string
          make: string
          model: string
          notes: string | null
          ref_front_url: string | null
          ref_front34_url: string | null
          ref_rear_url: string | null
          ref_rear34_url: string | null
          ref_side_opposite_url: string | null
          ref_side_url: string | null
          trim: string | null
          updated_at: string
          user_id: string
          year: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          generation_error?: string | null
          generation_status?: string
          id?: string
          make: string
          model: string
          notes?: string | null
          ref_front_url?: string | null
          ref_front34_url?: string | null
          ref_rear_url?: string | null
          ref_rear34_url?: string | null
          ref_side_opposite_url?: string | null
          ref_side_url?: string | null
          trim?: string | null
          updated_at?: string
          user_id: string
          year?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          generation_error?: string | null
          generation_status?: string
          id?: string
          make?: string
          model?: string
          notes?: string | null
          ref_front_url?: string | null
          ref_front34_url?: string | null
          ref_rear_url?: string | null
          ref_rear34_url?: string | null
          ref_side_opposite_url?: string | null
          ref_side_url?: string | null
          trim?: string | null
          updated_at?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
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
      library_items: {
        Row: {
          asset_mime: string | null
          asset_url: string | null
          concept_id: string | null
          concept_part_id: string | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["library_item_kind"]
          metadata: Json
          project_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
          visibility: Database["public"]["Enums"]["library_visibility"]
        }
        Insert: {
          asset_mime?: string | null
          asset_url?: string | null
          concept_id?: string | null
          concept_part_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["library_item_kind"]
          metadata?: Json
          project_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          user_id: string
          visibility?: Database["public"]["Enums"]["library_visibility"]
        }
        Update: {
          asset_mime?: string | null
          asset_url?: string | null
          concept_id?: string | null
          concept_part_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["library_item_kind"]
          metadata?: Json
          project_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          visibility?: Database["public"]["Enums"]["library_visibility"]
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          library_item_id: string
          price_cents: number
          status: Database["public"]["Enums"]["marketplace_listing_status"]
          title: string | null
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          library_item_id: string
          price_cents?: number
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          title?: string | null
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          library_item_id?: string
          price_cents?: number
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "library_items"
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
          garage_car_id: string | null
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
          garage_car_id?: string | null
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
          garage_car_id?: string | null
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
          {
            foreignKeyName: "projects_garage_car_id_fkey"
            columns: ["garage_car_id"]
            isOneToOne: false
            referencedRelation: "garage_cars"
            referencedColumns: ["id"]
          },
        ]
      }
      prototypes: {
        Row: {
          car_context: string | null
          created_at: string
          fit_preview_error: string | null
          fit_preview_status: string
          fit_preview_url: string | null
          garage_car_id: string | null
          generation_mode: string
          glb_url: string | null
          id: string
          isolated_ref_urls: Json
          mesh_error: string | null
          mesh_status: string
          mesh_task_id: string | null
          notes: string | null
          placement_hint: string | null
          primary_source_index: number
          reference_error: string | null
          reference_status: string
          render_error: string | null
          render_status: string
          render_urls: Json
          replicate_exact: boolean
          source_image_urls: Json
          source_mask_urls: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          car_context?: string | null
          created_at?: string
          fit_preview_error?: string | null
          fit_preview_status?: string
          fit_preview_url?: string | null
          garage_car_id?: string | null
          generation_mode?: string
          glb_url?: string | null
          id?: string
          isolated_ref_urls?: Json
          mesh_error?: string | null
          mesh_status?: string
          mesh_task_id?: string | null
          notes?: string | null
          placement_hint?: string | null
          primary_source_index?: number
          reference_error?: string | null
          reference_status?: string
          render_error?: string | null
          render_status?: string
          render_urls?: Json
          replicate_exact?: boolean
          source_image_urls?: Json
          source_mask_urls?: Json
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          car_context?: string | null
          created_at?: string
          fit_preview_error?: string | null
          fit_preview_status?: string
          fit_preview_url?: string | null
          garage_car_id?: string | null
          generation_mode?: string
          glb_url?: string | null
          id?: string
          isolated_ref_urls?: Json
          mesh_error?: string | null
          mesh_status?: string
          mesh_task_id?: string | null
          notes?: string | null
          placement_hint?: string | null
          primary_source_index?: number
          reference_error?: string | null
          reference_status?: string
          render_error?: string | null
          render_status?: string
          render_urls?: Json
          replicate_exact?: boolean
          source_image_urls?: Json
          source_mask_urls?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prototypes_garage_car_id_fkey"
            columns: ["garage_car_id"]
            isOneToOne: false
            referencedRelation: "garage_cars"
            referencedColumns: ["id"]
          },
        ]
      }
      style_presets: {
        Row: {
          build_type: string | null
          constraints: string[]
          cover_image_url: string | null
          created_at: string
          id: string
          is_public: boolean
          name: string
          prompt: string
          slug: string
          style_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          build_type?: string | null
          constraints?: string[]
          cover_image_url?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          name: string
          prompt?: string
          slug: string
          style_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          build_type?: string | null
          constraints?: string[]
          cover_image_url?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          name?: string
          prompt?: string
          slug?: string
          style_tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      library_item_kind:
        | "concept_image"
        | "aero_kit_mesh"
        | "concept_part_mesh"
        | "prototype_part_mesh"
      library_visibility: "private" | "public"
      marketplace_listing_status: "draft" | "active" | "paused"
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
      library_item_kind: [
        "concept_image",
        "aero_kit_mesh",
        "concept_part_mesh",
        "prototype_part_mesh",
      ],
      library_visibility: ["private", "public"],
      marketplace_listing_status: ["draft", "active", "paused"],
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
