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
          last_name: string;
          first_name: string;
          birth_date: string | null;
          email: string | null;
          phone: string | null;
          gender: string | null;
          ranking: string | null;
          category: string | null;
          season: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          licence_number: string;
          last_name: string;
          first_name: string;
          birth_date?: string | null;
          email?: string | null;
          phone?: string | null;
          gender?: string | null;
          ranking?: string | null;
          category?: string | null;
          season: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["club_members"]["Insert"]>;
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
    };
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
