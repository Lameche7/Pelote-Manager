import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memberService } from "@/features/members/services/memberService";

export const memberKeys = {
  all: ["members"] as const,
  lookup: (licenceNumber: string) =>
    [...memberKeys.all, "lookup", licenceNumber.trim()] as const,
};

export function useMemberLookup(licenceNumber: string) {
  const normalizedLicenceNumber = licenceNumber.trim();

  return useQuery({
    queryKey: memberKeys.lookup(normalizedLicenceNumber),
    queryFn: () => memberService.findByLicence(normalizedLicenceNumber),
    enabled: normalizedLicenceNumber.length > 0,
  });
}

export function useLinkProfileToMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (licenceNumber: string) =>
      memberService.linkCurrentProfile(licenceNumber),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memberKeys.all });
    },
  });
}
