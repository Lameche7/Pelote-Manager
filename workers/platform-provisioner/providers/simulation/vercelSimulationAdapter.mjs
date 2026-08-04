function createSimulatedVercelProjectName(clubSlug) {
  return `sim-${clubSlug}`.slice(0, 100);
}

function requirePublicReferences(context) {
  const requiredReferences = [
    "supabaseProjectRef",
    "supabaseUrl",
    "vercelProjectName",
    "deploymentUrl",
  ];

  for (const key of requiredReferences) {
    if (!context.existingReferences?.[key]) {
      throw new Error(
        `La simulation ne peut pas valider l’instance sans la référence ${key}.`,
      );
    }
  }
}

export function simulateVercelStep(context, { applicationVersion }) {
  const vercelProjectName = createSimulatedVercelProjectName(context.clubSlug);

  if (context.step === "vercel_project") {
    return {
      status: "completed",
      references: {
        vercelProjectName,
      },
    };
  }

  if (context.step === "environment_variables") {
    return {
      status: "completed",
      references: {},
    };
  }

  if (context.step === "deployment") {
    return {
      status: "completed",
      references: {
        deploymentUrl: `https://${vercelProjectName}.pelote-manager.invalid`,
      },
    };
  }

  if (context.step === "verification") {
    requirePublicReferences(context);

    return {
      status: "completed",
      references: {
        currentVersion: applicationVersion,
      },
    };
  }

  return null;
}
