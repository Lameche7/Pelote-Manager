import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memberAdminService } from "../services/memberAdminService";
const allMemberKeys = ["admin-members"] as const;
export const memberKeys = {
  all: allMemberKeys,
  list: (filters: Record<string, unknown>) =>
    [...allMemberKeys, "list", filters] as const,
  imports: [...allMemberKeys, "imports"] as const,
};
export const useAdminMembers = (filters: Record<string, unknown>) =>
  useQuery({
    queryKey: memberKeys.list(filters),
    queryFn: () => memberAdminService.list(filters),
  });
export const useMemberImports = () =>
  useQuery({
    queryKey: memberKeys.imports,
    queryFn: memberAdminService.imports,
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
