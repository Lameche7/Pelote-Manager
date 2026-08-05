import {
  LIVE_STEP_ADAPTER,
  assertLiveAdapter,
  createLiveStepPlan,
} from "./liveAdapterContract.mjs";
import { authorizeLiveStepPlan } from "./costApprovalGuard.mjs";
import { authorizeLiveExecutionConfirmation } from "./liveExecutionConfirmationGuard.mjs";

export const LIVE_PROVISIONING_DISABLED_MESSAGE =
  "Le mode réel Supabase/Vercel n’est pas disponible dans la PR43 : l’exécution reste désactivée.";

export function createLiveProvisioningPlanner({
  supabaseAdapter,
  vercelAdapter,
  costPolicy,
}) {
  const adapters = Object.freeze({
    supabase: assertLiveAdapter(supabaseAdapter, "supabase"),
    vercel: assertLiveAdapter(vercelAdapter, "vercel"),
  });

  if (!costPolicy?.currency) {
    throw new Error("La politique budgétaire du mode réel est obligatoire.");
  }

  return Object.freeze({
    mode: "live-planning-only",

    async planStep(context) {
      const adapterName = LIVE_STEP_ADAPTER[context?.step];

      if (!adapterName) {
        throw new Error(
          `Aucun fournisseur réel n’est défini pour ${String(context?.step)}.`,
        );
      }

      const planInput = await adapters[adapterName].planStep(context);

      return createLiveStepPlan({
        adapterName,
        context,
        ...planInput,
      });
    },

    authorizePlan(plan, approval, options = {}) {
      return authorizeLiveStepPlan({
        plan,
        policy: costPolicy,
        approval,
        ...options,
      });
    },

    authorizeExecution(confirmation, expected, options = {}) {
      return authorizeLiveExecutionConfirmation({
        confirmation,
        expected,
        ...options,
      });
    },

    async applyPlan() {
      throw new Error(LIVE_PROVISIONING_DISABLED_MESSAGE);
    },
  });
}
