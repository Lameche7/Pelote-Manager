import { useMemo, useState } from "react";
import {
  platformRegistryService,
  type PlatformClub,
  type PlatformCostPlan,
  type PlatformLiveExecutionConfirmation,
  type PlatformLiveExecutionPreview,
  type PlatformProvisioningJob,
} from "../services/platformRegistryService";
import "./PlatformLiveExecutionConfirmationPanel.css";

function formatCost(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

type PlatformLiveExecutionConfirmationPanelProps = {
  club: PlatformClub;
  provisioningJob?: PlatformProvisioningJob;
  plans: PlatformCostPlan[];
  confirmation?: PlatformLiveExecutionConfirmation;
  onChanged: () => Promise<void>;
};

export function PlatformLiveExecutionConfirmationPanel({
  club,
  provisioningJob,
  plans,
  confirmation,
  onChanged,
}: PlatformLiveExecutionConfirmationPanelProps) {
  const [preview, setPreview] = useState<PlatformLiveExecutionPreview>();
  const [typedSlug, setTypedSlug] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const currentPlans = useMemo(
    () => plans.filter((plan) => plan.status !== "superseded"),
    [plans],
  );
  const allBillablePlansApproved = currentPlans.every(
    (plan) => !plan.createsBillableResource || plan.status === "approved",
  );
  const canPrepare = Boolean(
    provisioningJob &&
      ["pending", "running", "waiting_external"].includes(
        provisioningJob.status,
      ) &&
      currentPlans.length > 0 &&
      allBillablePlansApproved,
  );
  const activeConfirmation =
    confirmation?.status === "confirmed" ? confirmation : undefined;
  const exactInputMatches = Boolean(
    preview &&
      typedSlug === preview.clubSlug &&
      typedPhrase === preview.confirmationPhrase,
  );

  if (!provisioningJob || currentPlans.length === 0) return null;

  const prepareConfirmation = async () => {
    setIsWorking(true);
    setErrorMessage("");

    try {
      const nextPreview =
        await platformRegistryService.previewLiveExecutionConfirmation(
          provisioningJob.id,
        );
      setPreview(nextPreview);
      setTypedSlug("");
      setTypedPhrase("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Prévisualisation renforcée impossible.",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const confirmExecution = async () => {
    if (!preview || !exactInputMatches) return;

    setIsWorking(true);
    setErrorMessage("");

    try {
      await platformRegistryService.confirmLiveExecution({
        provisioningJobId: preview.provisioningJobId,
        planSetKey: preview.planSetKey,
        clubSlug: typedSlug,
        confirmationPhrase: typedPhrase,
      });
      setPreview(undefined);
      setTypedSlug("");
      setTypedPhrase("");
      await onChanged();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Confirmation renforcée impossible.",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const revokeConfirmation = async () => {
    if (!activeConfirmation) return;

    setIsWorking(true);
    setErrorMessage("");

    try {
      await platformRegistryService.revokeLiveExecutionConfirmation(
        activeConfirmation.id,
      );
      await onChanged();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Révocation impossible.",
      );
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <section
      className="platform-live-confirmation"
      aria-label={`Confirmation renforcée pour ${club.name}`}
    >
      <div className="platform-live-confirmation__heading">
        <div>
          <strong>Confirmation renforcée</strong>
          <small>Étape supplémentaire avant toute future dépense réelle.</small>
        </div>
        <span>Mode réel désactivé</span>
      </div>

      {activeConfirmation ? (
        <div className="platform-live-confirmation__active">
          <p>
            Confirmation enregistrée pour {activeConfirmation.currentPlanCount}{" "}
            plan{activeConfirmation.currentPlanCount > 1 ? "s" : ""}.
          </p>
          <dl>
            <div>
              <dt>Coût ponctuel</dt>
              <dd>
                {formatCost(
                  activeConfirmation.oneTimeCents,
                  activeConfirmation.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Coût mensuel</dt>
              <dd>
                {formatCost(
                  activeConfirmation.monthlyCents,
                  activeConfirmation.currency,
                )}
              </dd>
            </div>
          </dl>
          <small>
            Valable jusqu’au {formatDate(activeConfirmation.expiresAt)}. Les
            plans et approbations seront revérifiés par le worker.
          </small>
          <button
            className="button button--small button--ghost"
            type="button"
            disabled={isWorking}
            onClick={() => void revokeConfirmation()}
          >
            {isWorking ? "Révocation…" : "Révoquer la confirmation"}
          </button>
        </div>
      ) : preview ? (
        <div className="platform-live-confirmation__preview">
          <p>
            Cette confirmation vise exactement {preview.currentPlanCount} plan
            {preview.currentPlanCount > 1 ? "s" : ""} courant
            {preview.currentPlanCount > 1 ? "s" : ""}.
          </p>
          <dl>
            <div>
              <dt>Coût ponctuel</dt>
              <dd>{formatCost(preview.oneTimeCents, preview.currency)}</dd>
            </div>
            <div>
              <dt>Coût mensuel</dt>
              <dd>{formatCost(preview.monthlyCents, preview.currency)}</dd>
            </div>
          </dl>
          <p>
            Retapez le slug <code>{preview.clubSlug}</code>, puis la phrase :
          </p>
          <code className="platform-live-confirmation__phrase">
            {preview.confirmationPhrase}
          </code>
          <label>
            Slug du club
            <input
              autoComplete="off"
              value={typedSlug}
              onChange={(event) => setTypedSlug(event.target.value)}
            />
          </label>
          <label>
            Phrase de confirmation
            <input
              autoComplete="off"
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
            />
          </label>
          <div className="platform-live-confirmation__actions">
            <button
              className="button button--small button--ghost"
              type="button"
              disabled={isWorking}
              onClick={() => setPreview(undefined)}
            >
              Annuler
            </button>
            <button
              className="button button--small button--primary"
              type="button"
              disabled={isWorking || !exactInputMatches}
              onClick={() => void confirmExecution()}
            >
              {isWorking
                ? "Confirmation…"
                : `Confirmer pour ${preview.validityMinutes} minutes`}
            </button>
          </div>
        </div>
      ) : (
        <div className="platform-live-confirmation__ready">
          <p>
            Tous les plans courants doivent être approuvés avant de préparer la
            confirmation finale.
          </p>
          <button
            className="button button--small button--primary"
            type="button"
            disabled={isWorking || !canPrepare}
            onClick={() => void prepareConfirmation()}
          >
            {isWorking
              ? "Prévisualisation…"
              : "Préparer la confirmation renforcée"}
          </button>
        </div>
      )}

      {errorMessage && (
        <p className="platform-live-confirmation__error">{errorMessage}</p>
      )}

      <small className="platform-live-confirmation__notice">
        Même confirmée, cette opération ne peut créer aucun projet Supabase ou
        Vercel dans la PR43.
      </small>
    </section>
  );
}
