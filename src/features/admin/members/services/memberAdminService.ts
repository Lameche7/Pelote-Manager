import { supabase } from "@/infrastructure/supabase/client";
import type { Json } from "@/infrastructure/supabase/database";
import type {
  AdminMember,
  MemberDetail,
  MemberForm,
  MemberImport,
  MemberImportDetail,
} from "../types";
const value = <T>(data: T | null, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Réponse Supabase vide.");
  return data;
};
const done = async (promise: ReturnType<typeof supabase.rpc>) => {
  const { error } = await promise;
  if (error) throw new Error(error.message);
};
export const memberAdminService = {
  list: async (filters: Record<string, Json> = {}) => {
    const r = await supabase.rpc("admin_list_club_members", { filters });
    return value(r.data, r.error) as AdminMember[];
  },
  searchGlobal: async (filters: Record<string, Json> = {}) => {
    const r = await supabase.rpc("admin_search_members_global", { filters });
    return value(r.data, r.error) as AdminMember[];
  },
  get: async (id: string) => {
    const r = await supabase.rpc("admin_get_member", { target_member_id: id });
    return value(r.data, r.error) as MemberDetail;
  },
  create: async (payload: MemberForm) => {
    const r = await supabase.rpc("admin_create_member", { payload });
    return value(r.data, r.error);
  },
  update: (
    id: string,
    payload: Partial<MemberForm>,
    version: string,
    reason?: string,
  ) =>
    done(
      supabase.rpc("admin_update_member", {
        target_member_id: id,
        payload,
        expected_updated_at: version,
        reason: reason ?? null,
      }),
    ),
  setActive: (id: string, active: boolean, version: string, reason: string) =>
    done(
      supabase.rpc("admin_set_member_active", {
        target_member_id: id,
        target_active: active,
        expected_updated_at: version,
        reason,
      }),
    ),
  correctLicence: (
    id: string,
    licence: string,
    version: string,
    reason: string,
  ) =>
    done(
      supabase.rpc("admin_correct_member_licence", {
        target_member_id: id,
        target_licence_number: licence,
        expected_updated_at: version,
        reason,
      }),
    ),
  updateSeason: (
    id: string,
    seasonId: string,
    ranking: string | null,
    isLicensed: boolean,
    version: string,
    reason: string,
  ) =>
    done(
      supabase.rpc("admin_update_member_season", {
        target_member_id: id,
        target_season_id: seasonId,
        target_ranking: ranking,
        target_is_licensed: isLicensed,
        expected_updated_at: version,
        reason,
      }),
    ),
  imports: async () => {
    const r = await supabase.rpc("admin_list_member_imports", {});
    return value(r.data, r.error) as MemberImport[];
  },
  getImport: async (id: string) => {
    const r = await supabase.rpc("admin_get_member_import", {
      target_import_id: id,
    });
    return value(r.data, r.error) as MemberImportDetail;
  },
  createImport: async (payload: Record<string, Json>) => {
    const r = await supabase.rpc("admin_create_member_import", { payload });
    return value(r.data, r.error);
  },
  validateImport: (id: string, rows: Json[]) =>
    done(
      supabase.rpc("admin_validate_member_import", {
        target_import_id: id,
        rows,
      }),
    ),
  executeImport: async (id: string) => {
    const r = await supabase.rpc("admin_execute_member_import", {
      target_import_id: id,
    });
    return value(r.data, r.error);
  },
};
