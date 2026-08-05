import type {
  PlatformCostPlan,
  PlatformCostPlanStatus,
} from "../services/platformRegistryService";

const statusLabels: Record<PlatformCostPlanStatus, string> = {
  pending: "Approbation requise",
  approved: "Approuvé pour une heure",
  expired: "Approbation expirée",
  revoked: "Approbation révoquée",
  superseded: "Plan remplacé",
};

const stepLabels: Record<PlatformCostPlan["step"], string> = {
  supabase_project: "Projet Supabase",
  database_migrations: "Migrations de la base",
  club_bootstrap: "Initialisation du club",
  first_admin: "Premier administrateur",
  vercel_project: "Projet Vercel",
  environment_variables: "Variables du déploiement",
  deployment: "Déploiement",
  verification: "Vérifications finales",
};

function formatCost(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatExpiry(value: string) {
  if (!value) return "";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

type PlatformCostPlanListProps = {
  plans: PlatformCostPlan[];
  actionPlanId: string;
  onApprove: (plan: PlatformCostPlan) => Promise<void>;
  onRevoke: (plan: PlatformCostPlan) => Promise<void>;
};

export function PlatformCostPlanList({
  plans,
  actionPlanId,
  onApprove,
  onRevoke,
}: PlatformCostPlanListProps) {
  if (plans.length === 0) return null;

  return (
    <section className="platform-cost-plans" aria-label="Plans de coût">
      <div className="platform-cost-plans__heading">
        <strong>Plans de coût audités</strong>
        <small>Aucune approbation ne déclenche de création réelle.</small>
      </div>

      {plans.map((plan) => {
        const isPendingApproval =
          plan.createsBillableResource &&
          ["pending", "expired", "revoked"].includes(plan.status);
        const canRevoke = plan.status === "approved";
        const isProcessing = actionPlanId === plan.id;

        return (
          <article
            className={`platform-cost-plan platform-cost-plan--${plan.status}`}
            key={plan.id}
          >
            <div className="platform-cost-plan__heading">
              <div>
                <strong>{stepLabels[plan.step]}</strong>
                <small>
                  {plan.provider === "supabase" ? "Supabase" : "Vercel"} ·{" "}
                  {plan.planId}
                </small>
              </div>
              <span>{statusLabels[plan.status]}</span>
            </div>

            <p>{plan.publicSummary}</p>

            <dl>
              <div>
                <dt>Coût ponctuel</dt>
                <dd>{formatCost(plan.oneTimeCents, plan.currency)}</dd>
              </div>
              <div>
                <dt>Coût mensuel</dt>
                <dd>{formatCost(plan.monthlyCents, plan.currency)}</dd>
              </div>
            </dl>

            {!plan.createsBillableResource && (
              <small>Aucune nouvelle ressource facturable.</small>
            )}

            {plan.status === "approved" && plan.approvalExpiresAt && (
              <small>
                Approbation valable jusqu’au{" "}
                {formatExpiry(plan.approvalExpiresAt)}.
              </small>
            )}

            {(isPendingApproval || canRevoke) && (
              <div className="platform-cost-plan__actions">
                {isPendingApproval && (
                  <button
                    className="button button--small button--primary"
                    type="button"
                    disabled={isProcessing}
                    onClick={() => void onApprove(plan)}
                  >
                    {isProcessing ? "Traitement…" : "Approuver pour une heure"}
                  </button>
                )}
                {canRevoke && (
                  <button
                    className="button button--small button--ghost"
                    type="button"
                    disabled={isProcessing}
                    onClick={() => void onRevoke(plan)}
                  >
                    {isProcessing ? "Traitement…" : "Révoquer"}
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
