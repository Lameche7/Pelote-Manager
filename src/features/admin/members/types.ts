import type { MemberGender } from "./domain/memberRules";
export type AdminMember = {
  id: string;
  club_id: string;
  club_name: string;
  licence_number: string;
  last_name: string;
  first_name: string;
  birth_date: string | null;
  gender: MemberGender;
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
export type MemberForm = {
  licenceNumber: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  gender: MemberGender;
  email?: string;
  phone?: string;
  ranking?: string;
  confirmedSensitive?: boolean;
};
export type MemberSeason = {
  id: string;
  clubSeasonId: string;
  seasonName: string;
  clubId: string;
  clubName: string;
  ranking: string | null;
  category: string;
  isLicensed: boolean;
  updatedAt: string;
};
export type MemberDetail = AdminMember & {
  canEdit: boolean;
  seasons: MemberSeason[];
};
export type MemberImport = {
  id: string;
  file_name: string;
  status:
    "draft" | "validated" | "processing" | "completed" | "failed" | "cancelled";
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
export type MemberImportDetail = {
  import: MemberImport;
  rows: Array<{
    id: string;
    line_number: number;
    planned_action: string;
    executed_action: string | null;
    errors: string[];
    warnings: string[];
    admin_decision: unknown;
    before_values: unknown;
    after_values: unknown;
  }>;
};
export type ImportExecutionResult = {
  status: "completed" | "failed";
  error?: string;
  created: number;
  updated: number;
  reactivated: number;
  unchanged: number;
  ignored: number;
};
