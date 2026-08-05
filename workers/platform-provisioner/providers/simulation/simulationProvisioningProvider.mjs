import { simulateSupabaseStep } from "./supabaseSimulationAdapter.mjs";
import { simulateVercelStep } from "./vercelSimulationAdapter.mjs";

export function createSimulationProvisioningProvider({
  allowedSlugPrefix,
  applicationVersion,
}) {
  const normalizedPrefix = String(allowedSlugPrefix || "").trim();
  const normalizedVersion = String(applicationVersion || "").trim();

  if (!normalizedPrefix) {
    throw new Error(
      "Le préfixe réservé aux clubs de simulation est obligatoire.",
    );
  }

  if (!normalizedVersion) {
    throw new Error("La version simulée de l’application est obligatoire.");
  }

  return Object.freeze({
    mode: "simulation",

    async executeStep(context) {
      if (!context.clubSlug?.startsWith(normalizedPrefix)) {
        throw new Error(
          `La simulation est réservée aux clubs dont l’identifiant commence par ${normalizedPrefix}.`,
        );
      }

      const supabaseResult = simulateSupabaseStep(context);
      if (supabaseResult) return supabaseResult;

      const vercelResult = simulateVercelStep(context, {
        applicationVersion: normalizedVersion,
      });
      if (vercelResult) return vercelResult;

      throw new Error(
        `Aucune simulation n’est définie pour l’étape ${context.step}.`,
      );
    },
  });
}
