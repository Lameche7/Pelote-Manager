import type { MemberGender } from "./domain/memberRules";
export type AdminMember = {
  id: string;
  licence_number: string;
  last_name: string;
  first_name: string;
  birth_date: string;
  gender: MemberGender;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  ranking: string | null;
  category: string | null;
  is_licensed: boolean;
  linked_account: boolean;
  updated_at: string;
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
  ignored_count: number;
  global_error: string | null;
};
