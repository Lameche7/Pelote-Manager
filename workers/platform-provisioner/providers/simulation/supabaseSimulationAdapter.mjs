import { createHash } from "node:crypto";

function createSimulatedProjectRef(idempotencyKey) {
  const suffix = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 17);

  return `sim${suffix}`;
}

export function simulateSupabaseStep(context) {
  if (context.step === "supabase_project") {
    const supabaseProjectRef = createSimulatedProjectRef(
      context.idempotencyKey,
    );

    return {
      status: "completed",
      references: {
        supabaseProjectRef,
        supabaseUrl: `https://${supabaseProjectRef}.supabase.invalid`,
      },
    };
  }

  if (
    ["database_migrations", "club_bootstrap", "first_admin"].includes(
      context.step,
    )
  ) {
    return {
      status: "completed",
      references: {},
    };
  }

  return null;
}
