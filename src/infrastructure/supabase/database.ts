import type { UserRole } from "@/shared/config";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.4";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          display_name: string | null;
          role: UserRole;
          member_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          display_name?: string | null;
          role?: UserRole;
          member_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          display_name?: string | null;
          role?: UserRole;
          member_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "club_members";
            referencedColumns: ["id"];
          },
        ];
      };
      club_members: {
        Row: {
          id: string;
          licence_number: string;
          licence_number_normalized: string;
          last_name: string;
          first_name: string;
          birth_date: string;
          email: string | null;
          phone: string | null;
          gender: "male" | "female";
          club_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          licence_number: string;
          licence_number_normalized?: string;
          last_name: string;
          first_name: string;
          birth_date: string;
          email?: string | null;
          phone?: string | null;
          gender: "male" | "female";
          club_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["club_members"]["Insert"]>;
        Relationships: [];
      };
      club_member_seasons: {
        Row: {
          id: string;
          club_member_id: string;
          club_id: string;
          club_season_id: string;
          ranking: string | null;
          category: string;
          is_licensed: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          club_member_id: string;
          club_id: string;
          club_season_id: string;
          ranking?: string | null;
          category: string;
          is_licensed?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["club_member_seasons"]["Insert"]
        >;
        Relationships: [];
      };
      club_member_imports: {
        Row: {
          id: string;
          club_id: string;
          club_season_id: string;
          file_name: string;
          file_size: number;
          file_hash: string;
          encoding: string;
          separator: string;
          column_mapping: Json;
          options: Json;
          status: Database["public"]["Enums"]["club_member_import_status"];
          author_id: string;
          created_at: string;
          validated_at: string | null;
          executed_at: string | null;
          created_count: number;
          updated_count: number;
          reactivated_count: number;
          unchanged_count: number;
          ignored_count: number;
          error_count: number;
          warning_count: number;
          global_error: string | null;
        };
        Insert: {
          id?: string;
          club_id: string;
          club_season_id: string;
          file_name: string;
          file_size: number;
          file_hash: string;
          encoding: string;
          separator: string;
          column_mapping?: Json;
          options?: Json;
          status?: Database["public"]["Enums"]["club_member_import_status"];
          author_id?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["club_member_imports"]["Insert"]
        >;
        Relationships: [];
      };
      club_member_import_rows: {
        Row: {
          id: string;
          import_id: string;
          line_number: number;
          original_data: Json;
          normalized_data: Json;
          planned_action: string;
          admin_decision: Json;
          errors: Json;
          warnings: Json;
          detected_member_id: string | null;
          observed_updated_at: string | null;
          executed_action: string | null;
          before_values: Json | null;
          after_values: Json | null;
        };
        Insert: {
          id?: string;
          import_id: string;
          line_number: number;
          original_data: Json;
          normalized_data: Json;
          planned_action: string;
          admin_decision?: Json;
          errors?: Json;
          warnings?: Json;
          detected_member_id?: string | null;
          observed_updated_at?: string | null;
          executed_action?: string | null;
          before_values?: Json | null;
          after_values?: Json | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["club_member_import_rows"]["Insert"]
        >;
        Relationships: [];
      };
      club_member_audit_log: {
        Row: {
          id: string;
          club_member_id: string | null;
          club_id: string;
          club_season_id: string | null;
          author_id: string | null;
          occurred_at: string;
          action: string;
          before_values: Json | null;
          after_values: Json | null;
          import_id: string | null;
          reason: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          club_member_id?: string | null;
          club_id: string;
          club_season_id?: string | null;
          author_id?: string | null;
          occurred_at?: string;
          action: string;
          before_values?: Json | null;
          after_values?: Json | null;
          import_id?: string | null;
          reason?: string | null;
          metadata?: Json;
        };
        Update: never;
        Relationships: [];
      };
      club_member_access_log: {
        Row: {
          id: string;
          club_member_id: string;
          requesting_club_id: string;
          member_club_id: string;
          accessed_by: string;
          accessed_at: string;
        };
        Insert: {
          id?: string;
          club_member_id: string;
          requesting_club_id: string;
          member_club_id: string;
          accessed_by: string;
          accessed_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      find_member_by_licence: {
        Args: {
          licence_number: string;
          last_name: string;
          first_name: string;
          birth_date: string;
        };
        Returns: boolean;
      };
      link_profile_to_member: {
        Args: {
          licence_number: string;
          last_name: string;
          first_name: string;
          birth_date: string;
        };
        Returns: string;
      };
      get_my_member_profile: {
        Args: Record<string, never>;
        Returns: {
          licence_number: string;
          first_name: string;
          last_name: string;
          is_active: boolean;
          season: string | null;
          is_licensed: boolean;
        }[];
      };
      list_my_member_clubs: {
        Args: Record<string, never>;
        Returns: {
          club_id: string;
          club_name: string;
          member_id: string;
          licence_number: string;
          first_name: string;
          last_name: string;
          is_active: boolean;
          season: string | null;
          is_licensed: boolean;
          affiliation_type: string | null;
          is_default: boolean;
        }[];
      };
      admin_list_club_members: {
        Args: { filters?: Json };
        Returns: AdminMemberRpcRow[];
      };
      admin_search_members_global: {
        Args: { filters?: Json };
        Returns: AdminMemberRpcRow[];
      };
      admin_get_member: { Args: { target_member_id: string }; Returns: Json };
      admin_create_member: { Args: { payload: Json }; Returns: string };
      admin_update_member: {
        Args: {
          target_member_id: string;
          payload: Json;
          expected_updated_at: string;
          reason?: string | null;
        };
        Returns: undefined;
      };
      admin_set_member_active: {
        Args: {
          target_member_id: string;
          target_active: boolean;
          expected_updated_at: string;
          reason: string;
        };
        Returns: undefined;
      };
      admin_correct_member_licence: {
        Args: {
          target_member_id: string;
          target_licence_number: string;
          expected_updated_at: string;
          reason: string;
        };
        Returns: undefined;
      };
      admin_update_member_season: {
        Args: {
          target_member_id: string;
          target_season_id: string;
          target_ranking: string | null;
          target_is_licensed: boolean;
          expected_updated_at: string;
          reason: string;
        };
        Returns: undefined;
      };
      admin_create_member_import: { Args: { payload: Json }; Returns: string };
      admin_validate_member_import: {
        Args: { target_import_id: string; rows: Json };
        Returns: undefined;
      };
      admin_execute_member_import: {
        Args: { target_import_id: string };
        Returns: Json;
      };
      admin_list_member_imports: {
        Args: { filters?: Json };
        Returns: MemberImportRpcRow[];
      };
      admin_get_member_import: {
        Args: { target_import_id: string };
        Returns: Json;
      };
      admin_find_member_import_matches: {
        Args: { payload: Json };
        Returns: Json;
      };
      admin_list_championship_day_results_v2: {
        Args: { target_id: string };
        Returns: {
          match_id: string;
          championship_id: string;
          day_on: string | null;
          actual_on: string | null;
          actual_time: string | null;
          division_id: string;
          division_name: string;
          division_display_order: number;
          pool_code: string | null;
          team1_id: string;
          team1_label: string;
          team1_players: string[];
          team1_is_club: boolean;
          team2_id: string;
          team2_label: string;
          team2_players: string[];
          team2_is_club: boolean;
          club_is_home: boolean;
          proposed_score_team1: number | null;
          proposed_score_team2: number | null;
          proposed_by_team_label: string | null;
          proposal_status: string | null;
          official_score_team1: number | null;
          official_score_team2: number | null;
        }[];
      };
      admin_list_championship_day_results: {
        Args: { target_id: string };
        Returns: {
          match_id: string;
          championship_id: string;
          day_on: string | null;
          actual_on: string | null;
          actual_time: string | null;
          division_id: string;
          division_name: string;
          division_display_order: number;
          pool_code: string | null;
          team1_id: string;
          team1_label: string;
          team1_is_club: boolean;
          team2_id: string;
          team2_label: string;
          team2_is_club: boolean;
          proposed_score_team1: number | null;
          proposed_score_team2: number | null;
          proposed_by_team_label: string | null;
          proposal_status: string | null;
          official_score_team1: number | null;
          official_score_team2: number | null;
        }[];
      };
      list_championship_results_catalog: {
        Args: Record<string, never>;
        Returns: {
          championship_id: string;
          championship_name: string;
          specialty: string;
          season_label: string;
          championship_status: string;
          source_url: string | null;
          has_my_team: boolean;
          has_my_club_team: boolean;
          my_division_ids: string[];
          divisions: Json;
          result_count: number;
        }[];
      };
      list_championship_match_browser: {
        Args: { target_championship_id: string };
        Returns: {
          match_id: string;
          division_id: string;
          division_name: string;
          division_display_order: number;
          pool_id: string | null;
          pool_code: string | null;
          pool_name: string | null;
          phase: string;
          match_status: string;
          theoretical_on: string | null;
          effective_on: string | null;
          effective_time: string | null;
          schedule_source: string;
          venue: string | null;
          team1_id: string;
          team1_label: string;
          team1_club_name: string;
          team1_players: string[];
          team1_is_my_team: boolean;
          team1_is_my_club: boolean;
          team2_id: string;
          team2_label: string;
          team2_club_name: string;
          team2_players: string[];
          team2_is_my_team: boolean;
          team2_is_my_club: boolean;
          official_score_team1: number | null;
          official_score_team2: number | null;
          proposed_score_team1: number | null;
          proposed_score_team2: number | null;
          proposed_by_team_label: string | null;
          displayed_score_team1: number | null;
          displayed_score_team2: number | null;
          result_source: string;
        }[];
      };
      list_championship_results: {
        Args: { target_championship_id: string };
        Returns: {
          match_id: string;
          division_id: string;
          division_name: string;
          division_display_order: number;
          pool_id: string | null;
          pool_code: string | null;
          pool_name: string | null;
          phase: string;
          played_on: string | null;
          played_time: string | null;
          venue: string | null;
          team1_id: string;
          team1_label: string;
          team1_club_name: string;
          team1_players: string[];
          team1_is_my_team: boolean;
          team1_is_my_club: boolean;
          team2_id: string;
          team2_label: string;
          team2_club_name: string;
          team2_players: string[];
          team2_is_my_team: boolean;
          team2_is_my_club: boolean;
          score_team1: number | null;
          score_team2: number | null;
          score_raw: string | null;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      club_member_import_status:
        | "draft"
        | "validated"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled";
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type AdminMemberRpcRow = {
  id: string;
  club_id: string;
  club_name: string;
  licence_number: string;
  last_name: string;
  first_name: string;
  birth_date: string | null;
  gender: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  ranking: string | null;
  category: string | null;
  is_licensed: boolean;
  linked_account: boolean;
  updated_at: string;
  total_count: number;
};
export type MemberImportRpcRow = {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  created_count: number;
  updated_count: number;
  reactivated_count: number;
  unchanged_count: number;
  ignored_count: number;
  error_count: number;
  warning_count: number;
  global_error: string | null;
  author_name: string;
  club_name: string;
  season_name: string;
  total_count: number;
};
