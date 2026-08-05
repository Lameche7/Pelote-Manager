import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { usePlatformAuth } from "../auth/usePlatformAuth";
import { PlatformBudgetForecastPanel } from "../components/PlatformBudgetForecastPanel";
import { PlatformCostPlanList } from "../components/PlatformCostPlanList";
import { PlatformLiveExecutionConfirmationPanel } from "../components/PlatformLiveExecutionConfirmationPanel";
import {
  platformRegistryService,
  type PlatformClub,
  type PlatformClubStatus,
  type PlatformCostPlan,
  type PlatformLiveExecutionConfirmation,
  type PlatformProvisioningJob,
  type PlatformProvisioningStatus,
  type PlatformProvisioningStep,
  type PlatformSubscriptionPlan,
} from "../services/platformRegistryService";
import "./PlatformPages.css";

const statusLabels: Record<PlatformClubStatus, string> = {
  provisioning: "À provisionner",
  trial: "Essai",
  active: "Actif",
  suspended: "Suspendu",
  cancelled: "Résilié",
};

const planLabels: Record<PlatformSubscriptionPlan, string> = {
  standard: "Standard",
  premium: "Premium",
  custom: "Sur mesure",
};

const provisioningStatusLabels: Record<PlatformProvisioningStatus, string> = {
  pending: "En attente",
  running: "En cours",
  waiting_external: "Action extérieure requise",
  completed: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
};

const provisioningStepLabels: Record<PlatformProvisioningStep, string> = {
  requested: "Demande enregistrée",
  supabase_project: "Création du projet Supabase",
  database_migrations: "Installation de la base",
  club_bootstrap: "Initialisation du club",
  first_admin: "Rattachement du premier administrateur",
  vercel_project: "Création du projet Vercel",
  environment_variables: "Configuration du déploiement",
  deployment: "Déploiement de l’application",
  verification: "Vérifications finales",
  completed: "Instance prête pour essai",
};

const openProvisioningStatuses = new Set<PlatformProvisioningStatus>([
  "pending",
  "running",
  "waiting_external",
]);

export function PlatformDashboardPage() {
  const { email, logout } = usePlatformAuth();
  const [clubs, setClubs] = useState<PlatformClub[]>([]);
  const [provisioningJobs, setProvisioningJobs] = useState<
    PlatformProvisioningJob[]
  >([]);
  const [costPlans, setCostPlans] = useState<PlatformCostPlan[]>([]);
  const [liveConfirmations, setLiveConfirmations] = useState<
    PlatformLiveExecutionConfirmation[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [provisioningClubId, setProvisioningClubId] = useState("");
  const [costPlanActionId, setCostPlanActionId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] =
    useState<PlatformSubscriptionPlan>("standard");
  const [notes, setNotes] = useState("");

  const latestProvisioningByClub = useMemo(() => {
    const latest = new Map<string, PlatformProvisioningJob>();

    for (const job of provisioningJobs) {
      if (!latest.has(job.clubId)) latest.set(job.clubId, job);
    }

    return latest;
  }, [provisioningJobs]);

  const costPlansByClub = useMemo(() => {
    const grouped = new Map<string, PlatformCostPlan[]>();

    for (const plan of costPlans) {
      const clubPlans = grouped.get(plan.clubId) ?? [];
      clubPlans.push(plan);
      grouped.set(plan.clubId, clubPlans);
    }

    return grouped;
  }, [costPlans]);

  const latestLiveConfirmationByClub = useMemo(() => {
    const latest = new Map<string, PlatformLiveExecutionConfirmation>();

    for (const confirmation of liveConfirmations) {
      if (!latest.has(confirmation.clubId)) {
        latest.set(confirmation.clubId, confirmation);
      }
    }

    return latest;
  }, [liveConfirmations]);

  const loadPlatform = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const [
        nextClubs,
        nextProvisioningJobs,
        nextCostPlans,
        nextLiveConfirmations,
      ] = await Promise.all([
        platformRegistryService.listClubs(),
        platformRegistryService.listProvisioningJobs(),
        platformRegistryService.listCostPlans(),
        platformRegistryService.listLiveExecutionConfirmations(),
      ]);
      setClubs(nextClubs);
      setProvisioningJobs(nextProvisioningJobs);
      setCostPlans(nextCostPlans);
      setLiveConfirmations(nextLiveConfirmations);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Registre indisponible.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlatform();
  }, [loadPlatform]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      await platformRegistryService.createClub({
        name,
        slug,
        contactEmail,
        subscriptionPlan,
        notes,
      });
      setName("");
      setSlug("");
      setContactEmail("");
      setSubscriptionPlan("standard");
      setNotes("");
      setMessage(
        "Club enregistré. Aucune instance ni donnée métier n’a encore été créée.",
      );
      await loadPlatform();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Création impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleProvisioning = async (club: PlatformClub) => {
    setProvisioningClubId(club.id);
    setMessage("");
    setErrorMessage("");

    try {
      await platformRegistryService.requestProvisioning(club.id);
      setMessage(
        `Provisionnement préparé pour ${club.name}. Le futur service sécurisé pourra traiter cette demande sans exposer ses clés au navigateur.`,
      );
      await loadPlatform();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Préparation du provisionnement impossible.",
      );
    } finally {
      setProvisioningClubId("");
    }
  };

  const handleApproveCostPlan = async (plan: PlatformCostPlan) => {
    setCostPlanActionId(plan.id);
    setMessage("");
    setErrorMessage("");

    try {
      await platformRegistryService.approveCostPlan(plan.id);
      setMessage(
        "Plan approuvé pour une heure. Cette approbation est auditée mais aucune création réelle n’est activée.",
      );
      await loadPlatform();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Approbation impossible.",
      );
    } finally {
      setCostPlanActionId("");
    }
  };

  const handleRevokeCostPlan = async (plan: PlatformCostPlan) => {
    setCostPlanActionId(plan.id);
    setMessage("");
    setErrorMessage("");

    try {
      await platformRegistryService.revokeCostPlanApproval(plan.id);
      setMessage("Approbation révoquée et opération inscrite dans l’audit.");
      await loadPlatform();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Révocation impossible.",
      );
    } finally {
      setCostPlanActionId("");
    }
  };

  const handleStatus = async (clubId: string, status: PlatformClubStatus) => {
    setErrorMessage("");
    setMessage("");

    try {
      await platformRegistryService.updateStatus(clubId, status);
      setMessage(`Statut mis à jour : ${statusLabels[status]}.`);
      await loadPlatform();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Mise à jour impossible.",
      );
    }
  };

  const openProvisioningCount = provisioningJobs.filter((job) =>
    openProvisioningStatuses.has(job.status),
  ).length;
  const pendingCostPlanCount = costPlans.filter(
    (plan) =>
      plan.createsBillableResource &&
      ["pending", "expired", "revoked"].includes(plan.status),
  ).length;

  return (
    <main className="platform-page">
      <header className="platform-header">
        <div>
          <p className="platform-kicker">Pelote Manager</p>
          <h1>Plateforme propriétaire</h1>
          <span>Clubs clients, abonnements, instances et versions.</span>
        </div>
        <div className="platform-header__account">
          <small>{email}</small>
          <button
            className="button button--small button--ghost"
            type="button"
            onClick={() => void logout()}
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <section
        className="platform-summary"
        aria-label="Résumé de la plateforme"
      >
        <article>
          <strong>{clubs.length}</strong>
          <span>
            club{clubs.length > 1 ? "s" : ""} enregistré
            {clubs.length > 1 ? "s" : ""}
          </span>
        </article>
        <article>
          <strong>
            {clubs.filter((club) => club.status === "active").length}
          </strong>
          <span>actifs</span>
        </article>
        <article>
          <strong>{openProvisioningCount}</strong>
          <span>
            provisionnement{openProvisioningCount > 1 ? "s" : ""} en attente
          </span>
        </article>
        <article>
          <strong>{pendingCostPlanCount}</strong>
          <span>
            plan{pendingCostPlanCount > 1 ? "s" : ""} de coût à examiner
          </span>
        </article>
      </section>

      <PlatformBudgetForecastPanel clubs={clubs} plans={costPlans} />

      {(message || errorMessage) && (
        <div
          className={`platform-message ${
            errorMessage
              ? "platform-message--error"
              : "platform-message--success"
          }`}
        >
          {errorMessage || message}
        </div>
      )}

      <div className="platform-grid">
        <section className="platform-card">
          <p className="platform-kicker">Nouveau client</p>
          <h2>Enregistrer un club</h2>
          <p>
            Cette étape crée uniquement sa fiche commerciale et technique dans
            la plateforme centrale.
          </p>

          <form className="platform-form" onSubmit={handleCreate}>
            <label>
              Nom du club
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Identifiant technique
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="club-de-tarbes"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
              />
              <small>Lettres minuscules, chiffres et tirets uniquement.</small>
            </label>
            <label>
              Email du contact principal
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </label>
            <label>
              Formule
              <select
                value={subscriptionPlan}
                onChange={(event) =>
                  setSubscriptionPlan(
                    event.target.value as PlatformSubscriptionPlan,
                  )
                }
              >
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="custom">Sur mesure</option>
              </select>
            </label>
            <label>
              Notes internes
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "Enregistrement…" : "Enregistrer le club"}
            </button>
          </form>
        </section>

        <section className="platform-card platform-card--wide">
          <p className="platform-kicker">Registre central</p>
          <h2>Clubs clients</h2>

          {isLoading ? (
            <p>Chargement du registre…</p>
          ) : clubs.length === 0 ? (
            <p>Aucun club client n’est encore enregistré.</p>
          ) : (
            <div className="platform-club-list">
              {clubs.map((club) => {
                const provisioningJob = latestProvisioningByClub.get(club.id);
                const clubCostPlans = costPlansByClub.get(club.id) ?? [];
                const liveConfirmation = latestLiveConfirmationByClub.get(
                  club.id,
                );
                const canRequestProvisioning =
                  !provisioningJob &&
                  !club.supabaseProjectRef &&
                  !club.deploymentUrl &&
                  club.status !== "cancelled";
                const canActivate = Boolean(
                  club.supabaseProjectRef &&
                  club.deploymentUrl &&
                  club.currentVersion,
                );

                return (
                  <article className="platform-club" key={club.id}>
                    <div className="platform-club__heading">
                      <div>
                        <h3>{club.name}</h3>
                        <small>{club.slug}</small>
                      </div>
                      <span
                        className={`platform-status platform-status--${club.status}`}
                      >
                        {statusLabels[club.status]}
                      </span>
                    </div>

                    <dl>
                      <div>
                        <dt>Formule</dt>
                        <dd>{planLabels[club.subscriptionPlan]}</dd>
                      </div>
                      <div>
                        <dt>Contact</dt>
                        <dd>{club.contactEmail || "Non renseigné"}</dd>
                      </div>
                      <div>
                        <dt>Supabase</dt>
                        <dd>{club.supabaseProjectRef || "Non provisionné"}</dd>
                      </div>
                      <div>
                        <dt>Déploiement</dt>
                        <dd>{club.deploymentUrl || "Non déployé"}</dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>{club.currentVersion || "Non installée"}</dd>
                      </div>
                    </dl>

                    {provisioningJob && (
                      <div
                        className={`platform-provisioning platform-provisioning--${provisioningJob.status}`}
                      >
                        <strong>
                          {provisioningStatusLabels[provisioningJob.status]}
                        </strong>
                        <span>
                          {provisioningStepLabels[provisioningJob.currentStep]}
                        </span>
                        {provisioningJob.lastErrorMessage && (
                          <small>{provisioningJob.lastErrorMessage}</small>
                        )}
                      </div>
                    )}

                    <PlatformCostPlanList
                      plans={clubCostPlans}
                      actionPlanId={costPlanActionId}
                      onApprove={handleApproveCostPlan}
                      onRevoke={handleRevokeCostPlan}
                    />

                    <PlatformLiveExecutionConfirmationPanel
                      club={club}
                      provisioningJob={provisioningJob}
                      plans={clubCostPlans}
                      confirmation={liveConfirmation}
                      onChanged={loadPlatform}
                    />

                    <div className="platform-club__actions">
                      {canRequestProvisioning && (
                        <button
                          className="button button--small button--primary"
                          type="button"
                          disabled={provisioningClubId === club.id}
                          onClick={() => void handleProvisioning(club)}
                        >
                          {provisioningClubId === club.id
                            ? "Préparation…"
                            : "Préparer l’instance"}
                        </button>
                      )}
                      {club.status !== "active" && canActivate && (
                        <button
                          className="button button--small button--primary"
                          type="button"
                          onClick={() => void handleStatus(club.id, "active")}
                        >
                          Activer
                        </button>
                      )}
                      {club.status !== "suspended" &&
                        club.status !== "cancelled" && (
                          <button
                            className="button button--small button--ghost"
                            type="button"
                            onClick={() =>
                              void handleStatus(club.id, "suspended")
                            }
                          >
                            Suspendre
                          </button>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
