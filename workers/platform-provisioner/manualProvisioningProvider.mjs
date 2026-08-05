const instructions = Object.freeze({
  supabase_project:
    "Créer ou rattacher le projet Supabase isolé du club, puis enregistrer uniquement sa référence publique.",
  database_migrations:
    "Appliquer les migrations de l’instance dans le projet Supabase du club.",
  club_bootstrap:
    "Exécuter le bootstrap vierge avec l’identité propre du club.",
  first_admin:
    "Créer puis rattacher le premier administrateur dans l’instance du club.",
  vercel_project: "Créer ou rattacher le projet Vercel dédié à cette instance.",
  environment_variables:
    "Configurer les variables du club et ses clés publiques dans le déploiement serveur.",
  deployment: "Déployer l’application du club.",
  verification:
    "Vérifier l’isolation, la connexion administrateur et l’absence de données de démonstration.",
});

export function createManualProvisioningProvider() {
  return {
    async executeStep(context) {
      const instruction = instructions[context.step];

      if (!instruction) {
        throw new Error(
          `Aucune opération manuelle n’est définie pour ${context.step}.`,
        );
      }

      return {
        status: "waiting_external",
        message: instruction,
        references: {},
      };
    },
  };
}
