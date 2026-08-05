import { createManualProvisioningProvider } from "./manualProvisioningProvider.mjs";
import {
  LIVE_PROVISIONING_DISABLED_MESSAGE,
} from "./providers/live/liveProvisioningPlanner.mjs";
import { createSimulationProvisioningProvider } from "./providers/simulation/simulationProvisioningProvider.mjs";

export const PROVISIONER_SIMULATION_ACK =
  "I_UNDERSTAND_NO_RESOURCES_ARE_CREATED";

export function resolveProvisionerMode(env = process.env) {
  return (env.PLATFORM_PROVISIONER_MODE || "manual").trim().toLowerCase();
}

export function createProvisioningProvider({ env = process.env } = {}) {
  const mode = resolveProvisionerMode(env);

  if (mode === "manual") {
    return Object.freeze({
      mode,
      ...createManualProvisioningProvider(),
    });
  }

  if (mode === "simulation") {
    if (
      env.PLATFORM_PROVISIONER_SIMULATION_ACK !== PROVISIONER_SIMULATION_ACK
    ) {
      throw new Error(
        "La simulation exige une confirmation explicite indiquant qu’aucune ressource ne sera créée.",
      );
    }

    return createSimulationProvisioningProvider({
      allowedSlugPrefix:
        env.PLATFORM_PROVISIONER_SIMULATION_SLUG_PREFIX || "simulation-",
      applicationVersion:
        env.PLATFORM_PROVISIONER_APPLICATION_VERSION || "0.0.0-simulation",
    });
  }

  if (mode === "live") {
    throw new Error(LIVE_PROVISIONING_DISABLED_MESSAGE);
  }

  throw new Error(`Mode de provisionnement inconnu : ${mode}`);
}
