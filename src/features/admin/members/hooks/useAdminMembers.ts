import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memberAdminService } from "../services/memberAdminService";
import type { Json } from "@/infrastructure/supabase/database";
const allMemberKeys = ["admin-members"] as const;
export const memberKeys = {
  all: allMemberKeys,
  list: (filters: Record<string, Json>) =>
    [...allMemberKeys, "list", filters] as const,
  imports: [...allMemberKeys, "imports"] as const,
};
export const useAdminMembers = (filters: Record<string, Json>) =>
  useQuery({
    queryKey: memberKeys.list(filters),
    queryFn: () => memberAdminService.list(filters),
  });
export const useMemberImports = (filters: Record<string, Json>) =>
  useQuery({
    queryKey: [...memberKeys.imports, filters],
    queryFn: () => memberAdminService.imports(filters),
  });
export const useCreateMember = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: memberAdminService.create,
    onSuccess: () => client.invalidateQueries({ queryKey: memberKeys.all }),
  });
};
export const useSetMemberActive = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      active: boolean;
      updatedAt: string;
      reason: string;
    }) =>
      memberAdminService.setActive(
        input.id,
        input.active,
        input.updatedAt,
        input.reason,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: memberKeys.all }),
  });
};
export const useMemberImportMutations = () => ({
  findMatches: useMutation({
    mutationFn: memberAdminService.findImportMatches,
  }),
  create: useMutation({ mutationFn: memberAdminService.createImport }),
  validate: useMutation({
    mutationFn: ({ id, rows }: { id: string; rows: Json[] }) =>
      memberAdminService.validateImport(id, rows),
  }),
  execute: useMutation({ mutationFn: memberAdminService.executeImport }),
});
export const useUpdateMemberSeason = (memberId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      seasonId: string;
      ranking: string | null;
      isLicensed: boolean;
      expectedUpdatedAt: string;
      reason: string;
    }) =>
      memberAdminService.updateSeason(
        memberId,
        input.seasonId,
        input.ranking,
        input.isLicensed,
        input.expectedUpdatedAt,
        input.reason,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: [...memberKeys.all, "detail", memberId],
      });
    },
  });
};
