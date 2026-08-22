import { useCallback, useEffect, useMemo, useState } from "react";
import { generatePlanningProposal } from "@/features/tournaments/domain/planningEngine";
import {
  tournamentFinalStageAdminService,
  type TournamentFinalMatch,
  type TournamentFinalSeriesState,
  type TournamentFinalStageState,
} from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";

const roundLabels: Record<string, string> = {
  preliminary: "Barrages",
  round_of_32: "1/16 de finale",
  round_of_16: "1/8 de finale",
  quarterfinal: "Quarts de finale",
  semifinal: "Demi-finales",
  final: "Finale",
};

const roundLabel = (value: string) =>
  roundLabels[value] ?? value.replaceAll("_", " ");

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const formatDate = (value: string | null) =>
  value ? shortDate.format(new Date(`${value}T12:00:00`)) : "";

const currentMatches = (series: TournamentFinalSeriesState) => {
  if (series.currentRoundNumber === null) return [];
  return series.matches.filter(
    (match) => match.roundNumber === series.currentRoundNumber,
  );
};

const seriesReadyForGeneration = (series: TournamentFinalSeriesState) =>
  series.qualifierCount >= 2 &&
  series.poolMatchCount > 0 &&
  series.validatedPoolMatchCount === series.poolMatchCount &&
  !series.cutoffTie;

function MatchRow({ match }: { match: TournamentFinalMatch }) {
  const status = match.winnerTeamId
    ? "Résultat validé"
    : match.published
      ? "Publié"
      : match.planned
        ? "Planifié"
        : "À planifier";

  return (
    <div className="final-stage-match">
      <div className="final-stage-match__teams">
        <span>
          {match.seedA ? `N°${match.seedA} · ` : ""}
          {match.teamALabel}
        </span>
        <strong>vs</strong>
        <span>
          {match.seedB ? `N°${match.seedB} · ` : ""}
          {match.teamBLabel}
        </span>
      </div>
      <div className="final-stage-match__meta">
        <span>{status}</span>
        {match.playDate && (
          <span>
            {formatDate(match.playDate)} · {match.startsAt?.slice(0, 5)}
            {match.resourceName ? ` · ${match.resourceName}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function AdminTournamentFinalStageControl({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const [stage, setStage] = useState<TournamentFinalStageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!tournamentId) {
      setStage(null);
      return;
    }
    const loaded =
      await tournamentFinalStageAdminService.getState(tournamentId);
    setStage(loaded);
  }, [tournamentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    tournamentFinalStageAdminService
      .getState(tournamentId)
      .then((loaded) => {
        if (active) setStage(loaded);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger la phase finale.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const allReady = useMemo(
    () =>
      Boolean(
        stage &&
        stage.finalsStartsOn &&
        stage.finalsEndsOn &&
        stage.series.length > 0 &&
        stage.series.every(seriesReadyForGeneration),
      ),
    [stage],
  );

  const current = useMemo(
    () =>
      stage?.series.flatMap((series) =>
        currentMatches(series).map((match) => ({ series, match })),
      ) ?? [],
    [stage],
  );

  const unresolved = current.filter(
    ({ match }) => match.resultStatus !== "validated",
  );
  const canPublish =
    unresolved.length > 0 &&
    unresolved.every(({ match }) => match.planned) &&
    unresolved.some(({ match }) => !match.published);
  const canPlan =
    unresolved.length > 0 && unresolved.some(({ match }) => !match.published);
  const canAdvance =
    stage?.series.some((series) => {
      const matches = currentMatches(series);
      return (
        matches.length > 0 &&
        matches.every((match) => match.resultStatus === "validated") &&
        !(matches.length === 1 && matches[0]?.round === "final")
      );
    }) ?? false;
  const finalsComplete =
    Boolean(stage?.generated) &&
    stage?.series.every((series) => {
      const matches = currentMatches(series);
      return (
        matches.length === 1 &&
        matches[0]?.round === "final" &&
        matches[0]?.resultStatus === "validated"
      );
    });

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "L’action n’a pas pu être réalisée.",
      );
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const count =
        await tournamentFinalStageAdminService.generate(tournamentId);
      return `Phase finale générée : ${count} première${count > 1 ? "s" : ""} partie${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}.`;
    });

  const plan = () =>
    run(async () => {
      const workspace =
        await tournamentFinalStageAdminService.getPlanning(tournamentId);
      const proposal = generatePlanningProposal({
        matches: workspace.matches,
        slots: workspace.slots,
        availability: workspace.availability,
        minimumRestMinutes: workspace.tournament.minimumRestMinutes,
        iterations: 500,
      });

      if (proposal.unscheduledMatchIds.length > 0) {
        const firstDiagnostic = proposal.diagnostics[0]?.message;
        throw new Error(
          firstDiagnostic
            ? `${proposal.unscheduledMatchIds.length} partie(s) ne peuvent pas être placées. ${firstDiagnostic}`
            : `${proposal.unscheduledMatchIds.length} partie(s) ne peuvent pas être placées avec les disponibilités actuelles.`,
        );
      }

      const count = await tournamentFinalStageAdminService.savePlanning(
        tournamentId,
        proposal.assignments,
        workspace.slots,
      );
      return `Planning du tour enregistré : ${count} partie${count > 1 ? "s" : ""} planifiée${count > 1 ? "s" : ""}.`;
    });

  const publish = () =>
    run(async () => {
      const count =
        await tournamentFinalStageAdminService.publish(tournamentId);
      return `Tour publié : ${count} partie${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""} au calendrier.`;
    });

  const advance = () =>
    run(async () => {
      const count =
        await tournamentFinalStageAdminService.advance(tournamentId);
      if (count === 0) {
        return "Aucun nouveau tour à créer : vérifiez que tous les résultats du tour courant sont validés.";
      }
      return `Tour suivant préparé : ${count} nouvelle${count > 1 ? "s" : ""} partie${count > 1 ? "s" : ""}.`;
    });

  if (loading) {
    return (
      <section className="admin-card final-stage-control">
        <p role="status">Vérification de la fin des poules…</p>
      </section>
    );
  }

  if (!stage) return null;

  return (
    <section className="admin-card final-stage-control">
      <header className="final-stage-control__header">
        <div>
          <p>Étape suivante</p>
          <h2>Passage en phase finale</h2>
        </div>
        {stage.generated && <span>Tableau figé</span>}
      </header>

      {error && (
        <p
          className="qualification-alert qualification-alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="qualification-alert" role="status">
          {message}
        </p>
      )}

      {!stage.generated ? (
        <>
          <div className="final-stage-readiness">
            {stage.series.map((series) => (
              <div key={series.seriesId}>
                <strong>{series.seriesName}</strong>
                <span>
                  Résultats : {series.validatedPoolMatchCount}/
                  {series.poolMatchCount}
                </span>
                <span>
                  Qualifiés : {series.qualifierCount || "non configuré"}
                </span>
                <span>
                  {series.cutoffTie
                    ? "⚠ Égalité à départager à la limite"
                    : seriesReadyForGeneration(series)
                      ? "✓ Série prête"
                      : "En attente"}
                </span>
              </div>
            ))}
          </div>

          {!stage.finalsStartsOn || !stage.finalsEndsOn ? (
            <p className="final-stage-control__hint">
              Les dates de phase finale doivent être configurées avant de
              poursuivre.
            </p>
          ) : (
            <p className="final-stage-control__hint">
              Phase finale prévue du {formatDate(stage.finalsStartsOn)} au{" "}
              {formatDate(stage.finalsEndsOn)}.
            </p>
          )}

          <button
            className="qualification-save"
            type="button"
            disabled={busy || !allReady}
            onClick={() => void generate()}
          >
            {busy ? "Génération…" : "Générer la phase finale"}
          </button>
        </>
      ) : (
        <>
          <div className="final-stage-series-list">
            {stage.series.map((series) => {
              const matches = currentMatches(series);
              const currentRound = matches[0]?.round;
              return (
                <section key={series.seriesId} className="final-stage-series">
                  <header>
                    <div>
                      <p>{series.seriesName}</p>
                      <h3>
                        {currentRound
                          ? roundLabel(currentRound)
                          : "Phase finale"}
                      </h3>
                    </div>
                    <span>{series.qualifierCount} qualifiés</span>
                  </header>

                  <details>
                    <summary>Têtes de série</summary>
                    <div className="final-stage-seeds">
                      {series.seeds.map((seed) => (
                        <span key={seed.seed}>
                          <strong>N°{seed.seed}</strong> {seed.teamLabel}
                        </span>
                      ))}
                    </div>
                  </details>

                  <div className="final-stage-matches">
                    {matches.map((match) => (
                      <MatchRow key={match.id} match={match} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {finalsComplete ? (
            <p className="final-stage-control__complete">
              🏆 Toutes les finales ont un résultat validé. La phase finale est
              terminée.
            </p>
          ) : (
            <div className="final-stage-actions">
              {canPlan && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void plan()}
                >
                  Proposer le planning du tour
                </button>
              )}
              {canPublish && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void publish()}
                >
                  Publier le tour
                </button>
              )}
              {canAdvance && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void advance()}
                >
                  Préparer le tour suivant
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
