import { supabase } from "@/infrastructure/supabase/client";
import type { AdminMember, MemberForm, MemberImport } from "../types";
const rpc = async <T>(name: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
};
export const memberAdminService = {
  list: (filters: Record<string, unknown> = {}) =>
    rpc<AdminMember[]>("admin_list_club_members", { filters }),
  searchGlobal: (filters: Record<string, unknown> = {}) =>
    rpc<AdminMember[]>("admin_search_members_global", { filters }),
  get: (memberId: string) =>
    rpc<AdminMember>("admin_get_member", { target_member_id: memberId }),
  create: (member: MemberForm) =>
    rpc<string>("admin_create_member", { payload: member }),
  update: (
    memberId: string,
    member: Partial<MemberForm>,
    expectedUpdatedAt: string,
    reason?: string,
  ) =>
    rpc<void>("admin_update_member", {
      target_member_id: memberId,
      payload: member,
      expected_updated_at: expectedUpdatedAt,
      reason: reason ?? null,
    }),
  setActive: (
    memberId: string,
    active: boolean,
    expectedUpdatedAt: string,
    reason: string,
  ) =>
    rpc<void>("admin_set_member_active", {
      target_member_id: memberId,
      target_active: active,
      expected_updated_at: expectedUpdatedAt,
      reason,
    }),
  imports: () => rpc<MemberImport[]>("admin_list_member_imports"),
  createImport: (payload: Record<string, unknown>) =>
    rpc<string>("admin_create_member_import", { payload }),
  validateImport: (importId: string, rows: unknown[]) =>
    rpc<void>("admin_validate_member_import", {
      target_import_id: importId,
      rows,
    }),
  executeImport: (importId: string) =>
    rpc<void>("admin_execute_member_import", { target_import_id: importId }),
};
