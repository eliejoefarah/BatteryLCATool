export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_user: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          is_active: boolean
          last_login_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          is_active?: boolean
          last_login_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          is_active?: boolean
          last_login_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      artifact: {
        Row: {
          artifact_id: string
          artifact_type: Database["public"]["Enums"]["artifact_type_enum"]
          checksum_sha256: string | null
          created_at: string
          filename: string
          mime_type: string | null
          revision_id: string
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          artifact_id?: string
          artifact_type: Database["public"]["Enums"]["artifact_type_enum"]
          checksum_sha256?: string | null
          created_at?: string
          filename: string
          mime_type?: string | null
          revision_id: string
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          artifact_id?: string
          artifact_type?: Database["public"]["Enums"]["artifact_type_enum"]
          checksum_sha256?: string | null
          created_at?: string
          filename?: string
          mime_type?: string | null
          revision_id?: string
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
        ]
      }
      battery_model: {
        Row: {
          chemistry: string | null
          created_at: string
          created_by: string
          functional_unit: string | null
          model_id: string
          name: string
          project_id: string
        }
        Insert: {
          chemistry?: string | null
          created_at?: string
          created_by: string
          functional_unit?: string | null
          model_id?: string
          name: string
          project_id: string
        }
        Update: {
          chemistry?: string | null
          created_at?: string
          created_by?: string
          functional_unit?: string | null
          model_id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battery_model_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battery_model_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["project_id"]
          },
        ]
      }
      battery_model_revision: {
        Row: {
          created_at: string
          created_by: string
          frozen_at: string | null
          is_active: boolean
          label: string | null
          model_id: string
          notes: string | null
          revision_id: string
          revision_number: number
          status: Database["public"]["Enums"]["model_status_enum"]
          unfreeze_log: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          frozen_at?: string | null
          is_active?: boolean
          label?: string | null
          model_id: string
          notes?: string | null
          revision_id?: string
          revision_number: number
          status?: Database["public"]["Enums"]["model_status_enum"]
          unfreeze_log?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          frozen_at?: string | null
          is_active?: boolean
          label?: string | null
          model_id?: string
          notes?: string | null
          revision_id?: string
          revision_number?: number
          status?: Database["public"]["Enums"]["model_status_enum"]
          unfreeze_log?: Json
        }
        Relationships: [
          {
            foreignKeyName: "battery_model_revision_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battery_model_revision_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "battery_model"
            referencedColumns: ["model_id"]
          },
        ]
      }
      bw_mapping_candidate: {
        Row: {
          bw_activity_key: string
          bw_activity_name: string | null
          bw_database: string
          bw_location: string | null
          bw_unit: string | null
          candidate_id: string
          created_at: string
          flow_id: string
          generated_at: string
          match_method: string | null
          match_score: number
        }
        Insert: {
          bw_activity_key: string
          bw_activity_name?: string | null
          bw_database: string
          bw_location?: string | null
          bw_unit?: string | null
          candidate_id?: string
          created_at?: string
          flow_id: string
          generated_at?: string
          match_method?: string | null
          match_score: number
        }
        Update: {
          bw_activity_key?: string
          bw_activity_name?: string | null
          bw_database?: string
          bw_location?: string | null
          bw_unit?: string | null
          candidate_id?: string
          created_at?: string
          flow_id?: string
          generated_at?: string
          match_method?: string | null
          match_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "bw_mapping_candidate_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
        ]
      }
      bw_mapping_selection: {
        Row: {
          candidate_id: string | null
          confirmed_at: string
          confirmed_by: string
          created_at: string
          flow_id: string
          mapping_id: string
          mapping_status: Database["public"]["Enums"]["mapping_status_enum"]
          notes: string | null
          revision_id: string
        }
        Insert: {
          candidate_id?: string | null
          confirmed_at?: string
          confirmed_by: string
          created_at?: string
          flow_id: string
          mapping_id?: string
          mapping_status?: Database["public"]["Enums"]["mapping_status_enum"]
          notes?: string | null
          revision_id: string
        }
        Update: {
          candidate_id?: string | null
          confirmed_at?: string
          confirmed_by?: string
          created_at?: string
          flow_id?: string
          mapping_id?: string
          mapping_status?: Database["public"]["Enums"]["mapping_status_enum"]
          notes?: string | null
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bw_mapping_selection_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "bw_mapping_candidate"
            referencedColumns: ["candidate_id"]
          },
          {
            foreignKeyName: "bw_mapping_selection_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bw_mapping_selection_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
          {
            foreignKeyName: "bw_mapping_selection_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
        ]
      }
      catalog_set: {
        Row: {
          catalog_set_id: string
          created_at: string
          created_by: string
          description: string | null
          name: string
        }
        Insert: {
          catalog_set_id?: string
          created_at?: string
          created_by: string
          description?: string | null
          name: string
        }
        Update: {
          catalog_set_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_set_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      data_origin_catalog: {
        Row: {
          code: string
          created_at: string
          description: string | null
          label: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          label: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          label?: string
        }
        Relationships: []
      }
      export_job: {
        Row: {
          activities_exported: number | null
          artifact_id: string | null
          created_at: string
          error_log: string | null
          exchanges_exported: number | null
          export_id: string
          exported_at: string
          exported_by: string
          format: string
          revision_id: string
          status: string
        }
        Insert: {
          activities_exported?: number | null
          artifact_id?: string | null
          created_at?: string
          error_log?: string | null
          exchanges_exported?: number | null
          export_id?: string
          exported_at?: string
          exported_by: string
          format?: string
          revision_id: string
          status?: string
        }
        Update: {
          activities_exported?: number | null
          artifact_id?: string | null
          created_at?: string
          error_log?: string | null
          exchanges_exported?: number | null
          export_id?: string
          exported_at?: string
          exported_by?: string
          format?: string
          revision_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_job_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifact"
            referencedColumns: ["artifact_id"]
          },
          {
            foreignKeyName: "export_job_exported_by_fkey"
            columns: ["exported_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "export_job_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
        ]
      }
      flow_allowed_unit: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          unit_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_allowed_unit_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
          {
            foreignKeyName: "flow_allowed_unit_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit_catalog"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      flow_catalog: {
        Row: {
          canonical_name: string
          cas_number: string | null
          catalog_set_id: string
          created_at: string
          default_unit: string | null
          dimension: Database["public"]["Enums"]["flow_dimension_enum"] | null
          display_name: string | null
          flow_id: string
          is_elementary_flow: boolean
          kind: Database["public"]["Enums"]["flow_kind_enum"]
        }
        Insert: {
          canonical_name: string
          cas_number?: string | null
          catalog_set_id: string
          created_at?: string
          default_unit?: string | null
          dimension?: Database["public"]["Enums"]["flow_dimension_enum"] | null
          display_name?: string | null
          flow_id?: string
          is_elementary_flow?: boolean
          kind: Database["public"]["Enums"]["flow_kind_enum"]
        }
        Update: {
          canonical_name?: string
          cas_number?: string | null
          catalog_set_id?: string
          created_at?: string
          default_unit?: string | null
          dimension?: Database["public"]["Enums"]["flow_dimension_enum"] | null
          display_name?: string | null
          flow_id?: string
          is_elementary_flow?: boolean
          kind?: Database["public"]["Enums"]["flow_kind_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "flow_catalog_catalog_set_id_fkey"
            columns: ["catalog_set_id"]
            isOneToOne: false
            referencedRelation: "catalog_set"
            referencedColumns: ["catalog_set_id"]
          },
        ]
      }
      import_job: {
        Row: {
          activities_count: number | null
          created_at: string
          errors_count: number
          exchanges_count: number | null
          import_id: string
          imported_at: string
          imported_by: string
          log_json: Json | null
          revision_id: string
          source_filename: string
          source_format: string
          status: string
          warnings_count: number
        }
        Insert: {
          activities_count?: number | null
          created_at?: string
          errors_count?: number
          exchanges_count?: number | null
          import_id?: string
          imported_at?: string
          imported_by: string
          log_json?: Json | null
          revision_id: string
          source_filename: string
          source_format: string
          status?: string
          warnings_count?: number
        }
        Update: {
          activities_count?: number | null
          created_at?: string
          errors_count?: number
          exchanges_count?: number | null
          import_id?: string
          imported_at?: string
          imported_by?: string
          log_json?: Json | null
          revision_id?: string
          source_filename?: string
          source_format?: string
          status?: string
          warnings_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_job_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "import_job_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
        ]
      }
      mapping_job: {
        Row: {
          completed_at: string | null
          created_at: string
          flow_count: number | null
          generated_at: string
          log_json: Json | null
          mapping_job_id: string
          matched_count: number | null
          revision_id: string
          status: string
          triggered_by_import_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          flow_count?: number | null
          generated_at?: string
          log_json?: Json | null
          mapping_job_id?: string
          matched_count?: number | null
          revision_id: string
          status?: string
          triggered_by_import_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          flow_count?: number | null
          generated_at?: string
          log_json?: Json | null
          mapping_job_id?: string
          matched_count?: number | null
          revision_id?: string
          status?: string
          triggered_by_import_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mapping_job_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "mapping_job_triggered_by_import_id_fkey"
            columns: ["triggered_by_import_id"]
            isOneToOne: false
            referencedRelation: "import_job"
            referencedColumns: ["import_id"]
          },
        ]
      }
      model_parameter: {
        Row: {
          created_at: string
          description: string | null
          distribution_type: string | null
          max_value: number | null
          min_value: number | null
          mode_value: number | null
          name: string
          param_id: string
          param_type: Database["public"]["Enums"]["param_type_enum"]
          revision_id: string
          value: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          distribution_type?: string | null
          max_value?: number | null
          min_value?: number | null
          mode_value?: number | null
          name: string
          param_id?: string
          param_type?: Database["public"]["Enums"]["param_type_enum"]
          revision_id: string
          value: number
        }
        Update: {
          created_at?: string
          description?: string | null
          distribution_type?: string | null
          max_value?: number | null
          min_value?: number | null
          mode_value?: number | null
          name?: string
          param_id?: string
          param_type?: Database["public"]["Enums"]["param_type_enum"]
          revision_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "model_parameter_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
        ]
      }
      process_exchange: {
        Row: {
          amount_is_ecoinvent_signed: boolean
          created_at: string
          exchange_direction: Database["public"]["Enums"]["exchange_direction_enum"]
          exchange_id: string
          flow_id: string | null
          formula_user: string | null
          output_type: Database["public"]["Enums"]["output_type_enum"] | null
          process_id: string
          quantity_user: number | null
          raw_name: string | null
          sort_order: number | null
          source_database: string | null
          source_location: string | null
          user_unit: string | null
        }
        Insert: {
          amount_is_ecoinvent_signed?: boolean
          created_at?: string
          exchange_direction: Database["public"]["Enums"]["exchange_direction_enum"]
          exchange_id?: string
          flow_id?: string | null
          formula_user?: string | null
          output_type?: Database["public"]["Enums"]["output_type_enum"] | null
          process_id: string
          quantity_user?: number | null
          raw_name?: string | null
          sort_order?: number | null
          source_database?: string | null
          source_location?: string | null
          user_unit?: string | null
        }
        Update: {
          amount_is_ecoinvent_signed?: boolean
          created_at?: string
          exchange_direction?: Database["public"]["Enums"]["exchange_direction_enum"]
          exchange_id?: string
          flow_id?: string | null
          formula_user?: string | null
          output_type?: Database["public"]["Enums"]["output_type_enum"] | null
          process_id?: string
          quantity_user?: number | null
          raw_name?: string | null
          sort_order?: number | null
          source_database?: string | null
          source_location?: string | null
          user_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_exchange_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
          {
            foreignKeyName: "process_exchange_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "process_instance"
            referencedColumns: ["process_id"]
          },
        ]
      }
      process_instance: {
        Row: {
          comment: string | null
          created_at: string
          location: string | null
          name: string
          process_id: string
          production_amount: number
          production_unit: string | null
          revision_id: string
          stage: string | null
          system_boundary: Database["public"]["Enums"]["system_boundary_enum"]
          template_id: string | null
          unit: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          location?: string | null
          name: string
          process_id?: string
          production_amount?: number
          production_unit?: string | null
          revision_id: string
          stage?: string | null
          system_boundary?: Database["public"]["Enums"]["system_boundary_enum"]
          template_id?: string | null
          unit?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          location?: string | null
          name?: string
          process_id?: string
          production_amount?: number
          production_unit?: string | null
          revision_id?: string
          stage?: string | null
          system_boundary?: Database["public"]["Enums"]["system_boundary_enum"]
          template_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_instance_location_fkey"
            columns: ["location"]
            isOneToOne: false
            referencedRelation: "region_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "process_instance_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "process_instance_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "process_template"
            referencedColumns: ["template_id"]
          },
        ]
      }
      process_link: {
        Row: {
          created_at: string
          flow_id: string
          from_process_id: string
          link_id: string
          revision_id: string
          to_process_id: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          from_process_id: string
          link_id?: string
          revision_id: string
          to_process_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          from_process_id?: string
          link_id?: string
          revision_id?: string
          to_process_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_link_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
          {
            foreignKeyName: "process_link_from_process_id_fkey"
            columns: ["from_process_id"]
            isOneToOne: false
            referencedRelation: "process_instance"
            referencedColumns: ["process_id"]
          },
          {
            foreignKeyName: "process_link_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "process_link_to_process_id_fkey"
            columns: ["to_process_id"]
            isOneToOne: false
            referencedRelation: "process_instance"
            referencedColumns: ["process_id"]
          },
        ]
      }
      process_template: {
        Row: {
          canonical_name: string
          catalog_set_id: string
          created_at: string
          stage: string
          template_id: string
          ui_helptext: string | null
          ui_label: string | null
        }
        Insert: {
          canonical_name: string
          catalog_set_id: string
          created_at?: string
          stage: string
          template_id?: string
          ui_helptext?: string | null
          ui_label?: string | null
        }
        Update: {
          canonical_name?: string
          catalog_set_id?: string
          created_at?: string
          stage?: string
          template_id?: string
          ui_helptext?: string | null
          ui_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_template_catalog_set_id_fkey"
            columns: ["catalog_set_id"]
            isOneToOne: false
            referencedRelation: "catalog_set"
            referencedColumns: ["catalog_set_id"]
          },
        ]
      }
      project: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string
          description: string | null
          name: string
          project_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          name: string
          project_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      project_member: {
        Row: {
          assigned_by: string
          created_at: string
          member_id: string
          project_id: string
          role: Database["public"]["Enums"]["project_member_role_enum"]
          user_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          member_id?: string
          project_id: string
          role: Database["public"]["Enums"]["project_member_role_enum"]
          user_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          member_id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_member_role_enum"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_member_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "project_member_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_member_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      region_catalog: {
        Row: {
          code: string
          created_at: string
          is_ecoinvent_shortcut: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          is_ecoinvent_shortcut?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          is_ecoinvent_shortcut?: boolean
          name?: string
        }
        Relationships: []
      }
      template_expected_exchange: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["exchange_direction_enum"]
          display_order: number | null
          expected_id: string
          flow_id: string
          group_key: string | null
          is_required: boolean
          max_occurs: number | null
          min_occurs: number
          template_id: string
          ui_label: string | null
        }
        Insert: {
          created_at?: string
          direction: Database["public"]["Enums"]["exchange_direction_enum"]
          display_order?: number | null
          expected_id?: string
          flow_id: string
          group_key?: string | null
          is_required?: boolean
          max_occurs?: number | null
          min_occurs?: number
          template_id: string
          ui_label?: string | null
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["exchange_direction_enum"]
          display_order?: number | null
          expected_id?: string
          flow_id?: string
          group_key?: string | null
          is_required?: boolean
          max_occurs?: number | null
          min_occurs?: number
          template_id?: string
          ui_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_expected_exchange_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow_catalog"
            referencedColumns: ["flow_id"]
          },
          {
            foreignKeyName: "template_expected_exchange_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "process_template"
            referencedColumns: ["template_id"]
          },
        ]
      }
      unit_catalog: {
        Row: {
          created_at: string
          description: string | null
          dimension: Database["public"]["Enums"]["flow_dimension_enum"]
          factor_to_si: number
          symbol: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          dimension: Database["public"]["Enums"]["flow_dimension_enum"]
          factor_to_si: number
          symbol: string
          unit_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          dimension?: Database["public"]["Enums"]["flow_dimension_enum"]
          factor_to_si?: number
          symbol?: string
          unit_id?: string
        }
        Relationships: []
      }
      validation_issue: {
        Row: {
          code: string
          created_at: string
          exchange_id: string | null
          issue_id: string
          message: string
          process_id: string | null
          severity: Database["public"]["Enums"]["validation_severity_enum"]
          suggestion: string | null
          validation_id: string
        }
        Insert: {
          code: string
          created_at?: string
          exchange_id?: string | null
          issue_id?: string
          message: string
          process_id?: string | null
          severity: Database["public"]["Enums"]["validation_severity_enum"]
          suggestion?: string | null
          validation_id: string
        }
        Update: {
          code?: string
          created_at?: string
          exchange_id?: string | null
          issue_id?: string
          message?: string
          process_id?: string | null
          severity?: Database["public"]["Enums"]["validation_severity_enum"]
          suggestion?: string | null
          validation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_issue_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "process_exchange"
            referencedColumns: ["exchange_id"]
          },
          {
            foreignKeyName: "validation_issue_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "process_instance"
            referencedColumns: ["process_id"]
          },
          {
            foreignKeyName: "validation_issue_validation_id_fkey"
            columns: ["validation_id"]
            isOneToOne: false
            referencedRelation: "validation_run"
            referencedColumns: ["validation_id"]
          },
        ]
      }
      validation_rule: {
        Row: {
          code: string
          created_at: string
          description: string | null
          rule_id: string
          rule_json: Json
          severity: Database["public"]["Enums"]["validation_severity_enum"]
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          rule_id?: string
          rule_json?: Json
          severity: Database["public"]["Enums"]["validation_severity_enum"]
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          rule_id?: string
          rule_json?: Json
          severity?: Database["public"]["Enums"]["validation_severity_enum"]
        }
        Relationships: []
      }
      validation_run: {
        Row: {
          config_hash: string | null
          created_at: string
          issue_count: number
          revision_id: string
          run_at: string
          status: string
          tool_version: string | null
          triggered_by: string
          validation_id: string
        }
        Insert: {
          config_hash?: string | null
          created_at?: string
          issue_count?: number
          revision_id: string
          run_at?: string
          status?: string
          tool_version?: string | null
          triggered_by: string
          validation_id?: string
        }
        Update: {
          config_hash?: string | null
          created_at?: string
          issue_count?: number
          revision_id?: string
          run_at?: string
          status?: string
          tool_version?: string | null
          triggered_by?: string
          validation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_run_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "battery_model_revision"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "validation_run_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      artifact_type_enum: "import" | "export" | "parameter_set" | "admin_export"
      exchange_direction_enum: "input" | "output"
      flow_dimension_enum:
        | "mass"
        | "energy"
        | "volume"
        | "area"
        | "length"
        | "count"
        | "transport"
        | "radioactivity"
        | "time"
        | "other"
      flow_kind_enum:
        | "material"
        | "energy"
        | "emission"
        | "waste"
        | "water"
        | "service"
      mapping_status_enum: "mapped" | "foreground" | "unmappable" | "pending"
      model_status_enum: "draft" | "frozen"
      output_type_enum: "reference" | "coproduct" | "waste_output" | "stock"
      param_type_enum: "scalar" | "lookup"
      project_member_role_enum: "manufacturer" | "reviewer" | "admin"
      system_boundary_enum: "foreground" | "background"
      validation_severity_enum: "error" | "warning" | "info"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      artifact_type_enum: ["import", "export", "parameter_set", "admin_export"],
      exchange_direction_enum: ["input", "output"],
      flow_dimension_enum: [
        "mass",
        "energy",
        "volume",
        "area",
        "length",
        "count",
        "transport",
        "radioactivity",
        "time",
        "other",
      ],
      flow_kind_enum: [
        "material",
        "energy",
        "emission",
        "waste",
        "water",
        "service",
      ],
      mapping_status_enum: ["mapped", "foreground", "unmappable", "pending"],
      model_status_enum: ["draft", "frozen"],
      output_type_enum: ["reference", "coproduct", "waste_output", "stock"],
      param_type_enum: ["scalar", "lookup"],
      project_member_role_enum: ["manufacturer", "reviewer", "admin"],
      system_boundary_enum: ["foreground", "background"],
      validation_severity_enum: ["error", "warning", "info"],
    },
  },
} as const

