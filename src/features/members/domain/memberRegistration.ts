export type MemberRegistrationErrorCode =
  | "identity_not_found"
  | "licence_already_linked"
  | "email_already_used"
  | "weak_password"
  | "cleanup_failed"
  | "unknown";

export class MemberRegistrationError extends Error {
  readonly registrationCode: MemberRegistrationErrorCode;

  constructor(registrationCode: MemberRegistrationErrorCode) {
    super(registrationCode);
    this.name = "MemberRegistrationError";
    this.registrationCode = registrationCode;
  }
}

export function mapRegistrationError(error: unknown): MemberRegistrationError {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code === "23505" || message.includes("already linked"))
    return new MemberRegistrationError("licence_already_linked");
  if (
    message.includes("already registered") ||
    message.includes("already been registered")
  )
    return new MemberRegistrationError("email_already_used");
  if (message.includes("password") || code === "weak_password")
    return new MemberRegistrationError("weak_password");
  if (code === "P0002" || message.includes("does not match"))
    return new MemberRegistrationError("identity_not_found");
  return new MemberRegistrationError("unknown");
}

export async function completeMemberRegistration(
  createProfile: () => Promise<void>,
  linkMember: () => Promise<void>,
  rollbackAccount: () => Promise<void>,
): Promise<void> {
  try {
    await createProfile();
    await linkMember();
  } catch (error) {
    const mapped = mapRegistrationError(error);
    try {
      await rollbackAccount();
    } catch {
      throw new MemberRegistrationError("cleanup_failed");
    }
    throw mapped;
  }
}
