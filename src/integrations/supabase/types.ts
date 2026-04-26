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
      blender_jobs: {
        Row: {
          body_skin_id: string | null
          completed_at: string | null
          created_at: string
          donor_car_template_id: string | null
          error_log: string | null
          id: string
          input_mesh_urls: Json
          operation_type: Database["public"]["Enums"]["blender_job_type"]
          output_file_urls: Json
          parameters: Json
          preview_file_url: string | null
          project_id: string | null
          selected_part_ids: Json
          started_at: string | null
          status: Database["public"]["Enums"]["blender_job_status"]
          updated_at: string
          user_id: string
          worker_task_id: string | null
        }
        Insert: {
          body_skin_id?: string | null
          completed_at?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          error_log?: string | null
          id?: string
          input_mesh_urls?: Json
          operation_type: Database["public"]["Enums"]["blender_job_type"]
          output_file_urls?: Json
          parameters?: Json
          preview_file_url?: string | null
          project_id?: string | null
          selected_part_ids?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["blender_job_status"]
          updated_at?: string
          user_id: string
          worker_task_id?: string | null
        }
        Update: {
          body_skin_id?: string | null
          completed_at?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          error_log?: string | null
          id?: string
          input_mesh_urls?: Json
          operation_type?: Database["public"]["Enums"]["blender_job_type"]
          output_file_urls?: Json
          parameters?: Json
          preview_file_url?: string | null
          project_id?: string | null
          selected_part_ids?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["blender_job_status"]
          updated_at?: string
          user_id?: string
          worker_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blender_jobs_body_skin_id_fkey"
            columns: ["body_skin_id"]
            isOneToOne: false
            referencedRelation: "body_skins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blender_jobs_donor_car_template_id_fkey"
            columns: ["donor_car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blender_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      body_kit_parts: {
        Row: {
          ai_confidence: number | null
          ai_label: string | null
          ai_reasoning: string | null
          anchor_position: Json | null
          area_m2: number
          bbox: Json
          body_kit_id: string
          confidence: number
          created_at: string
          glb_url: string | null
          id: string
          label: string | null
          library_item_id: string | null
          slot: string
          stl_path: string
          thumbnail_url: string | null
          triangle_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_label?: string | null
          ai_reasoning?: string | null
          anchor_position?: Json | null
          area_m2?: number
          bbox?: Json
          body_kit_id: string
          confidence?: number
          created_at?: string
          glb_url?: string | null
          id?: string
          label?: string | null
          library_item_id?: string | null
          slot: string
          stl_path: string
          thumbnail_url?: string | null
          triangle_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_label?: string | null
          ai_reasoning?: string | null
          anchor_position?: Json | null
          area_m2?: number
          bbox?: Json
          body_kit_id?: string
          confidence?: number
          created_at?: string
          glb_url?: string | null
          id?: string
          label?: string | null
          library_item_id?: string | null
          slot?: string
          stl_path?: string
          thumbnail_url?: string | null
          triangle_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_kit_parts_body_kit_id_fkey"
            columns: ["body_kit_id"]
            isOneToOne: false
            referencedRelation: "body_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "body_kit_parts_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "library_items"
            referencedColumns: ["id"]
          },
        ]
      }
      body_kits: {
        Row: {
          ai_attempts: number
          ai_notes: string | null
          baked_transform: Json
          body_skin_id: string
          combined_glb_url: string | null
          combined_stl_path: string | null
          created_at: string
          donor_car_template_id: string | null
          error: string | null
          id: string
          name: string
          notes: string | null
          panel_count: number
          preview_thumbnail_url: string | null
          project_id: string
          shell_alignment_id: string | null
          status: Database["public"]["Enums"]["body_kit_bake_status"]
          triangle_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_attempts?: number
          ai_notes?: string | null
          baked_transform?: Json
          body_skin_id: string
          combined_glb_url?: string | null
          combined_stl_path?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          error?: string | null
          id?: string
          name?: string
          notes?: string | null
          panel_count?: number
          preview_thumbnail_url?: string | null
          project_id: string
          shell_alignment_id?: string | null
          status?: Database["public"]["Enums"]["body_kit_bake_status"]
          triangle_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_attempts?: number
          ai_notes?: string | null
          baked_transform?: Json
          body_skin_id?: string
          combined_glb_url?: string | null
          combined_stl_path?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          error?: string | null
          id?: string
          name?: string
          notes?: string | null
          panel_count?: number
          preview_thumbnail_url?: string | null
          project_id?: string
          shell_alignment_id?: string | null
          status?: Database["public"]["Enums"]["body_kit_bake_status"]
          triangle_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_kits_body_skin_id_fkey"
            columns: ["body_skin_id"]
            isOneToOne: false
            referencedRelation: "body_skins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "body_kits_donor_car_template_id_fkey"
            columns: ["donor_car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "body_kits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "body_kits_shell_alignment_id_fkey"
            columns: ["shell_alignment_id"]
            isOneToOne: false
            referencedRelation: "shell_alignments"
            referencedColumns: ["id"]
          },
        ]
      }
      body_skins: {
        Row: {
          concept_project_id: string | null
          created_at: string
          donor_car_template_id: string | null
          file_url_glb: string | null
          file_url_stl: string | null
          fit_status: Database["public"]["Enums"]["body_skin_fit_status"]
          generation_prompt: string | null
          id: string
          name: string
          notes: string | null
          preview_url: string | null
          source_image_urls: Json
          style_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          concept_project_id?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          file_url_glb?: string | null
          file_url_stl?: string | null
          fit_status?: Database["public"]["Enums"]["body_skin_fit_status"]
          generation_prompt?: string | null
          id?: string
          name: string
          notes?: string | null
          preview_url?: string | null
          source_image_urls?: Json
          style_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          concept_project_id?: string | null
          created_at?: string
          donor_car_template_id?: string | null
          file_url_glb?: string | null
          file_url_stl?: string | null
          fit_status?: Database["public"]["Enums"]["body_skin_fit_status"]
          generation_prompt?: string | null
          id?: string
          name?: string
          notes?: string | null
          preview_url?: string | null
          source_image_urls?: Json
          style_tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_skins_concept_project_id_fkey"
            columns: ["concept_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "body_skins_donor_car_template_id_fkey"
            columns: ["donor_car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_jobs: {
        Row: {
          concept_id: string | null
          created_at: string
          error: string | null
          id: string
          inputs: Json
          outputs: Json
          part_kind: string
          part_label: string | null
          project_id: string | null
          recipe: Json
          status: string
          updated_at: string
          user_id: string
          worker_task_id: string | null
        }
        Insert: {
          concept_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          inputs?: Json
          outputs?: Json
          part_kind: string
          part_label?: string | null
          project_id?: string | null
          recipe?: Json
          status?: string
          updated_at?: string
          user_id: string
          worker_task_id?: string | null
        }
        Update: {
          concept_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          inputs?: Json
          outputs?: Json
          part_kind?: string
          part_label?: string | null
          project_id?: string | null
          recipe?: Json
          status?: string
          updated_at?: string
          user_id?: string
          worker_task_id?: string | null
        }
        Relationships: []
      }
      car_hardpoints: {
        Row: {
          car_panel_id: string | null
          car_template_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          notes: string | null
          point_type: Database["public"]["Enums"]["car_hardpoint_type"]
          position: Json
          updated_at: string
        }
        Insert: {
          car_panel_id?: string | null
          car_template_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          point_type: Database["public"]["Enums"]["car_hardpoint_type"]
          position?: Json
          updated_at?: string
        }
        Update: {
          car_panel_id?: string | null
          car_template_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          notes?: string | null
          point_type?: Database["public"]["Enums"]["car_hardpoint_type"]
          position?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_hardpoints_car_panel_id_fkey"
            columns: ["car_panel_id"]
            isOneToOne: false
            referencedRelation: "car_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_hardpoints_car_template_id_fkey"
            columns: ["car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      car_material_maps: {
        Row: {
          ai_notes: string | null
          car_stl_id: string
          created_at: string
          id: string
          method: string
          stats: Json
          tag_blob_b64: string
          triangle_count: number
          updated_at: string
        }
        Insert: {
          ai_notes?: string | null
          car_stl_id: string
          created_at?: string
          id?: string
          method?: string
          stats?: Json
          tag_blob_b64: string
          triangle_count: number
          updated_at?: string
        }
        Update: {
          ai_notes?: string | null
          car_stl_id?: string
          created_at?: string
          id?: string
          method?: string
          stats?: Json
          tag_blob_b64?: string
          triangle_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_material_maps_car_stl_id_fkey"
            columns: ["car_stl_id"]
            isOneToOne: true
            referencedRelation: "car_stls"
            referencedColumns: ["id"]
          },
        ]
      }
      car_panels: {
        Row: {
          area_m2: number
          bbox: Json
          car_stl_id: string
          confidence: number
          created_at: string
          id: string
          slot: string
          stl_path: string
          triangle_count: number
          updated_at: string
        }
        Insert: {
          area_m2?: number
          bbox?: Json
          car_stl_id: string
          confidence?: number
          created_at?: string
          id?: string
          slot: string
          stl_path: string
          triangle_count?: number
          updated_at?: string
        }
        Update: {
          area_m2?: number
          bbox?: Json
          car_stl_id?: string
          confidence?: number
          created_at?: string
          id?: string
          slot?: string
          stl_path?: string
          triangle_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_panels_car_stl_id_fkey"
            columns: ["car_stl_id"]
            isOneToOne: false
            referencedRelation: "car_stls"
            referencedColumns: ["id"]
          },
        ]
      }
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
          carbon_kit_error: string | null
          carbon_kit_glb_url: string | null
          carbon_kit_scale_m: number | null
          carbon_kit_status: string
          carbon_kit_stl_url: string | null
          carbon_kit_task_id: string | null
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
          carbon_kit_error?: string | null
          carbon_kit_glb_url?: string | null
          carbon_kit_scale_m?: number | null
          carbon_kit_status?: string
          carbon_kit_stl_url?: string | null
          carbon_kit_task_id?: string | null
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
          carbon_kit_error?: string | null
          carbon_kit_glb_url?: string | null
          carbon_kit_scale_m?: number | null
          carbon_kit_status?: string
          carbon_kit_stl_url?: string | null
          carbon_kit_task_id?: string | null
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
          body_swap_mode: boolean
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
          variation_count: number
        }
        Insert: {
          aggression?: string | null
          body_swap_mode?: boolean
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
          variation_count?: number
        }
        Update: {
          aggression?: string | null
          body_swap_mode?: boolean
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
          variation_count?: number
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
      frozen_parts: {
        Row: {
          anchor_points: Json
          bbox: Json
          category: string
          created_at: string
          garage_car_id: string | null
          id: string
          mask_url: string | null
          mount_zone: string
          name: string
          preview_url: string | null
          prototype_id: string
          side: string
          silhouette_locked: boolean
          silhouette_url: string | null
          source_image_url: string | null
          symmetry_allowed: boolean
          updated_at: string
          user_id: string
          view_angle: string
        }
        Insert: {
          anchor_points?: Json
          bbox?: Json
          category?: string
          created_at?: string
          garage_car_id?: string | null
          id?: string
          mask_url?: string | null
          mount_zone?: string
          name?: string
          preview_url?: string | null
          prototype_id: string
          side?: string
          silhouette_locked?: boolean
          silhouette_url?: string | null
          source_image_url?: string | null
          symmetry_allowed?: boolean
          updated_at?: string
          user_id: string
          view_angle?: string
        }
        Update: {
          anchor_points?: Json
          bbox?: Json
          category?: string
          created_at?: string
          garage_car_id?: string | null
          id?: string
          mask_url?: string | null
          mount_zone?: string
          name?: string
          preview_url?: string | null
          prototype_id?: string
          side?: string
          silhouette_locked?: boolean
          silhouette_url?: string | null
          source_image_url?: string | null
          symmetry_allowed?: boolean
          updated_at?: string
          user_id?: string
          view_angle?: string
        }
        Relationships: [
          {
            foreignKeyName: "frozen_parts_garage_car_id_fkey"
            columns: ["garage_car_id"]
            isOneToOne: false
            referencedRelation: "garage_cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "frozen_parts_prototype_id_fkey"
            columns: ["prototype_id"]
            isOneToOne: false
            referencedRelation: "prototypes"
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
      geometry_jobs: {
        Row: {
          concept_id: string | null
          created_at: string
          error: string | null
          id: string
          inputs: Json
          job_type: string
          mount_zone: string
          outputs: Json
          part_kind: string
          project_id: string | null
          side: string
          status: string
          updated_at: string
          user_id: string
          worker_task_id: string | null
        }
        Insert: {
          concept_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          inputs?: Json
          job_type: string
          mount_zone: string
          outputs?: Json
          part_kind: string
          project_id?: string | null
          side?: string
          status?: string
          updated_at?: string
          user_id: string
          worker_task_id?: string | null
        }
        Update: {
          concept_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          inputs?: Json
          job_type?: string
          mount_zone?: string
          outputs?: Json
          part_kind?: string
          project_id?: string | null
          side?: string
          status?: string
          updated_at?: string
          user_id?: string
          worker_task_id?: string | null
        }
        Relationships: []
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
      meshy_generations: {
        Row: {
          created_at: string
          donor_car_template_id: string | null
          error: string | null
          generation_type: Database["public"]["Enums"]["meshy_generation_type"]
          id: string
          meshy_task_id: string | null
          output_glb_url: string | null
          output_stl_url: string | null
          parameters: Json
          preview_url: string | null
          prompt: string
          reference_image_urls: Json
          saved_body_skin_id: string | null
          saved_library_item_id: string | null
          status: Database["public"]["Enums"]["meshy_generation_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          donor_car_template_id?: string | null
          error?: string | null
          generation_type: Database["public"]["Enums"]["meshy_generation_type"]
          id?: string
          meshy_task_id?: string | null
          output_glb_url?: string | null
          output_stl_url?: string | null
          parameters?: Json
          preview_url?: string | null
          prompt?: string
          reference_image_urls?: Json
          saved_body_skin_id?: string | null
          saved_library_item_id?: string | null
          status?: Database["public"]["Enums"]["meshy_generation_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          donor_car_template_id?: string | null
          error?: string | null
          generation_type?: Database["public"]["Enums"]["meshy_generation_type"]
          id?: string
          meshy_task_id?: string | null
          output_glb_url?: string | null
          output_stl_url?: string | null
          parameters?: Json
          preview_url?: string | null
          prompt?: string
          reference_image_urls?: Json
          saved_body_skin_id?: string | null
          saved_library_item_id?: string | null
          status?: Database["public"]["Enums"]["meshy_generation_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meshy_generations_donor_car_template_id_fkey"
            columns: ["donor_car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meshy_generations_saved_body_skin_id_fkey"
            columns: ["saved_body_skin_id"]
            isOneToOne: false
            referencedRelation: "body_skins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meshy_generations_saved_library_item_id_fkey"
            columns: ["saved_library_item_id"]
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
      placed_parts: {
        Row: {
          created_at: string
          hidden: boolean
          id: string
          library_item_id: string | null
          locked: boolean
          metadata: Json
          mirrored: boolean
          part_name: string | null
          position: Json
          project_id: string
          rotation: Json
          scale: Json
          snap_zone_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hidden?: boolean
          id?: string
          library_item_id?: string | null
          locked?: boolean
          metadata?: Json
          mirrored?: boolean
          part_name?: string | null
          position?: Json
          project_id: string
          rotation?: Json
          scale?: Json
          snap_zone_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hidden?: boolean
          id?: string
          library_item_id?: string | null
          locked?: boolean
          metadata?: Json
          mirrored?: boolean
          part_name?: string | null
          position?: Json
          project_id?: string
          rotation?: Json
          scale?: Json
          snap_zone_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "placed_parts_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placed_parts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placed_parts_snap_zone_id_fkey"
            columns: ["snap_zone_id"]
            isOneToOne: false
            referencedRelation: "snap_zones"
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
          paint_finish: Json
          share_enabled: boolean
          share_token: string | null
          starred: boolean
          status: Database["public"]["Enums"]["project_status"]
          thumbnail_url: string | null
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
          paint_finish?: Json
          share_enabled?: boolean
          share_token?: string | null
          starred?: boolean
          status?: Database["public"]["Enums"]["project_status"]
          thumbnail_url?: string | null
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
          paint_finish?: Json
          share_enabled?: boolean
          share_token?: string | null
          starred?: boolean
          status?: Database["public"]["Enums"]["project_status"]
          thumbnail_url?: string | null
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
          placement_manifest: Json
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
          placement_manifest?: Json
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
          placement_manifest?: Json
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
      shell_alignments: {
        Row: {
          body_skin_id: string
          created_at: string
          id: string
          locked_hardpoints: Json
          notes: string | null
          position: Json
          project_id: string
          rotation: Json
          scale: Json
          scale_to_wheelbase: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          body_skin_id: string
          created_at?: string
          id?: string
          locked_hardpoints?: Json
          notes?: string | null
          position?: Json
          project_id: string
          rotation?: Json
          scale?: Json
          scale_to_wheelbase?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          body_skin_id?: string
          created_at?: string
          id?: string
          locked_hardpoints?: Json
          notes?: string | null
          position?: Json
          project_id?: string
          rotation?: Json
          scale?: Json
          scale_to_wheelbase?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shell_alignments_body_skin_id_fkey"
            columns: ["body_skin_id"]
            isOneToOne: false
            referencedRelation: "body_skins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shell_alignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      snap_zones: {
        Row: {
          car_template_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          mirror_zone_id: string | null
          normal: Json
          notes: string | null
          position: Json
          rotation: Json
          scale: Json
          updated_at: string
          zone_type: Database["public"]["Enums"]["snap_zone_type"]
        }
        Insert: {
          car_template_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          mirror_zone_id?: string | null
          normal?: Json
          notes?: string | null
          position?: Json
          rotation?: Json
          scale?: Json
          updated_at?: string
          zone_type: Database["public"]["Enums"]["snap_zone_type"]
        }
        Update: {
          car_template_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          mirror_zone_id?: string | null
          normal?: Json
          notes?: string | null
          position?: Json
          rotation?: Json
          scale?: Json
          updated_at?: string
          zone_type?: Database["public"]["Enums"]["snap_zone_type"]
        }
        Relationships: [
          {
            foreignKeyName: "snap_zones_car_template_id_fkey"
            columns: ["car_template_id"]
            isOneToOne: false
            referencedRelation: "car_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snap_zones_mirror_zone_id_fkey"
            columns: ["mirror_zone_id"]
            isOneToOne: false
            referencedRelation: "snap_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_annotations: {
        Row: {
          camera_pose: Json | null
          color: string
          created_at: string
          id: string
          kind: string
          label: string | null
          project_id: string
          strokes: Json
          updated_at: string
          user_id: string
          visible: boolean
        }
        Insert: {
          camera_pose?: Json | null
          color?: string
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          project_id: string
          strokes?: Json
          updated_at?: string
          user_id: string
          visible?: boolean
        }
        Update: {
          camera_pose?: Json | null
          color?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          project_id?: string
          strokes?: Json
          updated_at?: string
          user_id?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "studio_annotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      generate_share_token: { Args: never; Returns: string }
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
      blender_job_status: "queued" | "running" | "complete" | "failed"
      blender_job_type:
        | "trim_part_to_car"
        | "conform_edge_to_body"
        | "thicken_shell"
        | "add_return_lip"
        | "add_mounting_tabs"
        | "mirror_part"
        | "split_for_print_bed"
        | "repair_watertight"
        | "decimate_mesh"
        | "cut_wheel_arches"
        | "cut_window_openings"
        | "panelise_body_skin"
        | "export_stl"
        | "export_glb_preview"
      body_kit_bake_status:
        | "idle"
        | "queued"
        | "baking"
        | "subtracting"
        | "splitting"
        | "ready"
        | "failed"
      body_skin_fit_status: "raw" | "aligned" | "panelised" | "printable"
      car_hardpoint_type:
        | "front_wheel_centre"
        | "rear_wheel_centre"
        | "centreline"
        | "sill_line"
        | "windscreen_base"
        | "windscreen_top"
        | "roof_peak"
        | "door_corner"
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
        | "geometry_part_mesh"
        | "cad_part_mesh"
      library_visibility: "private" | "public"
      marketplace_listing_status: "draft" | "active" | "paused"
      meshy_generation_status: "queued" | "running" | "complete" | "failed"
      meshy_generation_type: "part" | "body_skin"
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
      snap_zone_type:
        | "front_left_arch"
        | "front_right_arch"
        | "rear_left_arch"
        | "rear_right_arch"
        | "front_splitter"
        | "left_sill"
        | "right_sill"
        | "rear_diffuser"
        | "rear_wing"
        | "roof"
        | "bonnet"
        | "left_door"
        | "right_door"
        | "left_quarter"
        | "right_quarter"
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
      blender_job_status: ["queued", "running", "complete", "failed"],
      blender_job_type: [
        "trim_part_to_car",
        "conform_edge_to_body",
        "thicken_shell",
        "add_return_lip",
        "add_mounting_tabs",
        "mirror_part",
        "split_for_print_bed",
        "repair_watertight",
        "decimate_mesh",
        "cut_wheel_arches",
        "cut_window_openings",
        "panelise_body_skin",
        "export_stl",
        "export_glb_preview",
      ],
      body_kit_bake_status: [
        "idle",
        "queued",
        "baking",
        "subtracting",
        "splitting",
        "ready",
        "failed",
      ],
      body_skin_fit_status: ["raw", "aligned", "panelised", "printable"],
      car_hardpoint_type: [
        "front_wheel_centre",
        "rear_wheel_centre",
        "centreline",
        "sill_line",
        "windscreen_base",
        "windscreen_top",
        "roof_peak",
        "door_corner",
      ],
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
        "geometry_part_mesh",
        "cad_part_mesh",
      ],
      library_visibility: ["private", "public"],
      marketplace_listing_status: ["draft", "active", "paused"],
      meshy_generation_status: ["queued", "running", "complete", "failed"],
      meshy_generation_type: ["part", "body_skin"],
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
      snap_zone_type: [
        "front_left_arch",
        "front_right_arch",
        "rear_left_arch",
        "rear_right_arch",
        "front_splitter",
        "left_sill",
        "right_sill",
        "rear_diffuser",
        "rear_wing",
        "roof",
        "bonnet",
        "left_door",
        "right_door",
        "left_quarter",
        "right_quarter",
      ],
    },
  },
} as const
