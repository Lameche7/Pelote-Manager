export type RegistrationMetadata = Record<string, unknown>;

function hasPendingIdentity(metadata: RegistrationMetadata): boolean {
  const identity = metadata.pending_member_identity;
  if (!identity || typeof identity !== "object") return false;
  const values = identity as Record<string, unknown>;
  return ["licenceNumber", "lastName", "firstName", "birthDate"].every(
    (key) => typeof values[key] === "string" && values[key].length > 0,
  );
}

/** Server-side authorization decision for destructive registration cleanup. */
export function canCleanupMemberRegistration(
  metadata: RegistrationMetadata,
  suppliedToken: unknown,
  linkedMemberId: string | null,
): boolean {
  return (
    metadata.registration_pending === true &&
    hasPendingIdentity(metadata) &&
    typeof suppliedToken === "string" &&
    suppliedToken.length > 0 &&
    metadata.registration_token === suppliedToken &&
    linkedMemberId === null
  );
}
