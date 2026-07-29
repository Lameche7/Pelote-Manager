export type MemberRegistrationErrorCode =
  | "identity_not_found"
  | "licence_already_linked"
  | "email_already_used"
  | "weak_password"
  | "cleanup_failed"
  | "verification_rate_limited"
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

export type RegistrationOutcome = "completed" | "confirmation_required";

export class VerificationAttemptLimiter {
  private failures = 0;
  private blockedUntil = 0;
  private readonly now: () => number;
  private readonly persist?: (state: {
    failures: number;
    blockedUntil: number;
  }) => void;

  constructor(
    now: () => number = Date.now,
    initialState?: { failures: number; blockedUntil: number },
    persist?: (state: { failures: number; blockedUntil: number }) => void,
  ) {
    this.now = now;
    this.failures = initialState?.failures ?? 0;
    this.blockedUntil = initialState?.blockedUntil ?? 0;
    this.persist = persist;
  }

  canAttempt(): boolean {
    return this.now() >= this.blockedUntil;
  }

  recordResult(matches: boolean): void {
    if (matches) {
      this.failures = 0;
      this.blockedUntil = 0;
      this.persist?.({
        failures: this.failures,
        blockedUntil: this.blockedUntil,
      });
      return;
    }
    this.failures += 1;
    if (this.failures >= 5) {
      this.blockedUntil =
        this.now() + Math.min(60_000, 2 ** (this.failures - 5) * 5_000);
    }
    this.persist?.({
      failures: this.failures,
      blockedUntil: this.blockedUntil,
    });
  }
}

export function getRegistrationOutcome(
  hasSession: boolean,
): RegistrationOutcome {
  return hasSession ? "completed" : "confirmation_required";
}

/**
 * Completes registration and performs compensating cleanup when a later step
 * fails. Auth, Postgres and an Edge Function cannot share one transaction.
 */
export async function completeMemberRegistrationWithCleanup(
  createProfile: () => Promise<void>,
  linkMember: () => Promise<void>,
  cleanupAccount: () => Promise<void>,
): Promise<void> {
  try {
    await createProfile();
    await linkMember();
  } catch (error) {
    const mapped = mapRegistrationError(error);
    try {
      await cleanupAccount();
    } catch {
      throw new MemberRegistrationError("cleanup_failed");
    }
    throw mapped;
  }
}
