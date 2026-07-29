import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  memberService,
  type MemberIdentity,
} from "@/features/members/services/memberService";

export const memberKeys = {
  all: ["members"] as const,
  verification: (identity: MemberIdentity) =>
    [
      ...memberKeys.all,
      "verification",
      identity.licenceNumber,
      identity.lastName,
      identity.firstName,
      identity.birthDate,
    ] as const,
};

function hasCompleteIdentity(identity: MemberIdentity): boolean {
  return Object.values(identity).every((value) => value.length > 0);
}

export function useMemberLookup(identity: MemberIdentity) {
  return useQuery({
    queryKey: memberKeys.verification(identity),
    queryFn: () => memberService.matchesLicence(identity),
    enabled: hasCompleteIdentity(identity),
  });
}

export function useLinkProfileToMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (identity: MemberIdentity) =>
      memberService.linkCurrentProfile(identity),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memberKeys.all });
    },
  });
}

export function useVerifyMemberIdentity() {
  return useMutation({
    mutationFn: (identity: MemberIdentity) =>
      memberService.matchesLicence(identity),
  });
}

export function useRegisterMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: memberService.register.bind(memberService),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memberKeys.all });
    },
  });
}
