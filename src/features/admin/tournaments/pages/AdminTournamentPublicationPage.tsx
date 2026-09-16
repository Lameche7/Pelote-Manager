import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminTournamentPublicationService,
  type TournamentPublicationPreview,
  type TournamentPublicationSummary,
  type TournamentSeriesColor,
} from "@/features/admin/tournaments/services/adminTournamentPublicationService";
import { ROUTES } from "@/shared/config";
import "./AdminTournamentPublicationPage.css";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatTime = (value: string) => value.slice(0, 5);

const occupationTypeLabels: Record<string, string> = {
  reservation: "Réservation",
  match: "Match",
  closure: "Fermeture",
  maintenance: "Maintenance",
  club_event: "Évènement club",
  animation: "Animation",
};

const colorSignature = (values: TournamentSeriesColor[]) =>
  values
    .map((series) => `${series.id}:${series.color.toUpperCase()}`)
    .sort()
    .join("|");

export function AdminTournamentPublicationPage() {
  const [tournaments, setTournaments] = useState<
    TournamentPublicationSummary[]
  >([]);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<TournamentPublicationPreview | null>(
    null,
  );
  const [seriesColors, setSeriesColors] = useState<TournamentSeriesColor[]>([]);
  const [savedSeriesColors, setSavedSeriesColors] = useState<
    TournamentSeriesColor[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadTournamentDetails = async (tournamentId: string) => {
    const [loadedPreview, loadedColors] = await Promise.all([
      adminTournamentPublicationService.preview(tournamentId),
      adminTournamentPublicationService.listSeriesColors(tournamentId),
    ]);
    setPreview(loadedPreview);
    setSeriesColors(loadedColors);
    setSavedSeriesColors(loadedColors);
  };

  const refresh = async (preferredId?: string) => {
    const items = await adminTournamentPublicationService.list();
    setTournaments(items);
    const preferred =
      items.find((item) => item.id === preferredId) ??
      items.find((item) => item.status === "planning_generated") ??
      items[0];

    if (!preferred) {
      setSelectedId("");
      setPreview(null);
      setSeriesColors([]);
      setSavedSeriesColors([]);
      return;
    }

    setSelectedId(preferred.id);
    await loadTournamentDetails(preferred.id);
  };

  useEffect(() => {
    let active = true;
    adminTournamentPublicationService
      .list()
      .then(async (items) => {
        if (!active) return;
        setTournaments(items);
        const preferred =
          items.find((item) => item.status === "planning_generated") ??
          items[0];
        if (!preferred) return;
        setSelectedId(preferred.id);
        const [loadedPreview, loadedColors] = await Promise.all([
          adminTournamentPublicationService.preview(preferred.id),
          adminTournamentPublicationService.listSeriesColors(preferred.id),
        ]);
        if (active) {
          setPreview(loadedPreview);
          setSeriesColors(loadedColors);
          setSavedSeriesColors(loadedColors);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger la publication des tournois.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedSummary = useMemo(
    () => tournaments.find((item) => item.id === selectedId) ?? null,
    [selectedId, tournaments],
  );

  const complete =
    preview !== null &&
    preview.matchCount > 0 &&
    preview.matchCount === preview.plannedMatchCount;
  const hasConflicts = (preview?.conflicts.length ?? 0) > 0;
  const canPublish =
    preview?.tournament.status === "planning_generated" && complete;
  const isPublished = preview?.tournament.status === "planning_published";
  const colorsDirty =
    colorSignature(seriesColors) !== colorSignature(savedSeriesColors);

  const chooseTournament = async (id: string) => {
    setSelectedId(id);
    setPreview(null);
    setSeriesColors([]);
    setSavedSeriesColors([]);
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await loadTournamentDetails(id);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de vérifier ce tournoi.",
      );
    } finally {
      setLoading(false);
    }
  };

  const saveColors = async () => {
    if (!preview || !colorsDirty || seriesColors.length === 0) return;
    setSavingColors(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentPublicationService.saveSeriesColors(
        preview.tournament.id,
        seriesColors,
      );
      setSavedSeriesColors(seriesColors.map((series) => ({ ...series })));
      setMessage(
        "Couleurs des séries enregistrées. Elles sont utilisées immédiatement dans le planning, les réservations et le Mode TV.",
      );
    } catch (colorError) {
      setError(
        colorError instanceof Error
          ? colorError.message
          : "Impossible d’enregistrer les couleurs des séries.",
      );
    } finally {
      setSavingColors(false);
    }
  };

  const publish = async () => {
    if (!preview || !canPublish) return;

    const priorityCopy = hasConflicts
      ? `\n\n${preview.conflicts.length} occupation(s) concurrente(s) seront automatiquement libérées : les réservations concernées seront annulées avec le motif « Priorité tournoi », les autres tournois seront retirés du calendrier et les événements ou blocages seront supplantés.`
      : "";
    const confirmed = window.confirm(
      `Publier ${preview.matchCount} matchs de « ${preview.tournament.name} » dans le calendrier des réservations ?${priorityCopy}\n\nLe tournoi devient prioritaire sur les occupations existantes aux mêmes horaires.`,
    );
    if (!confirmed) return;

    setPublishing(true);
    setError("");
    setMessage("");
    try {
      if (hasConflicts) {
        const result = await adminTournamentPublicationService.publishPriority(
          preview.tournament.id,
        );
        await refresh(preview.tournament.id);
        const impacts = [
          result.cancelledReservationCount > 0
            ? `${result.cancelledReservationCount} réservation(s) annulée(s)`
            : "",
          result.displacedTournamentCount > 0
            ? `${result.displacedTournamentCount} autre(s) tournoi(s) retiré(s)`
            : "",
          result.archivedEventCount > 0
            ? `${result.archivedEventCount} événement(s) archivé(s)`
            : "",
          result.cancelledBlockCount > 0
            ? `${result.cancelledBlockCount} blocage(s) supplanté(s)`
            : "",
        ].filter(Boolean);
        setMessage(
          `${result.publishedCount} matchs publiés en priorité.${impacts.length > 0 ? ` ${impacts.join(" · ")}.` : ""}`,
        );
      } else {
        const count = await adminTournamentPublicationService.publish(
          preview.tournament.id,
        );
        await refresh(preview.tournament.id);
        setMessage(
          `${count} matchs publiés. Les créneaux sont maintenant bloqués dans le calendrier des réservations.`,
        );
      }
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Impossible de publier le planning.",
      );
      await loadTournamentDetails(preview.tournament.id).catch(() => undefined);
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async () => {
    if (!preview || !isPublished) return;
    const confirmed = window.confirm(
      `Retirer « ${preview.tournament.name} » du calendrier des réservations ?\n\nLes matchs redeviendront modifiables dans l’atelier Planning.`,
    );
    if (!confirmed) return;

    setPublishing(true);
    setError("");
    setMessage("");
    try {
      const count = await adminTournamentPublicationService.unpublish(
        preview.tournament.id,
      );
      await refresh(preview.tournament.id);
      setMessage(
        `${count} matchs retirés du calendrier. Le planning peut de nouveau être modifié.`,
      );
    } catch (unpublishError) {
      setError(
        unpublishError instanceof Error
          ? unpublishError.message
          : "Impossible de retirer le planning du calendrier.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const resolveConflictingTournament = async (
    tournamentId: string,
    tournamentName: string,
  ) => {
    if (!preview) return;
    const selectedTournamentId = preview.tournament.id;
    const confirmed = window.confirm(
      `Retirer « ${tournamentName} » du calendrier pour libérer ses créneaux ?\n\nLe tournoi et ses matchs seront conservés. Seules ses occupations publiées seront retirées du calendrier.`,
    );
    if (!confirmed) return;

    setPublishing(true);
    setError("");
    setMessage("");
    try {
      const count =
        await adminTournamentPublicationService.unpublish(tournamentId);
      await refresh(selectedTournamentId);
      setMessage(
        `${count} matchs de « ${tournamentName} » ont été retirés du calendrier. Les conflits ont été recalculés.`,
      );
    } catch (unpublishError) {
      setError(
        unpublishError instanceof Error
          ? unpublishError.message
          : "Impossible de retirer le tournoi en conflit du calendrier.",
      );
      await loadTournamentDetails(selectedTournamentId).catch(() => undefined);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="admin-page admin-tournament-publication">
      <header className="admin-page__header admin-tournament-publication__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Publication du planning</h1>
          <p className="admin-page__lead">
            Vérifiez les impacts puis publiez le planning validé dans le
            calendrier global. Un tournoi publié est prioritaire sur les autres
            occupations aux mêmes horaires.
          </p>
        </div>
        <Link
          className="admin-tournament-publication__calendar-link"
          to={ROUTES.reservations}
        >
          Voir le calendrier des réservations
        </Link>
      </header>

      {error && (
        <p className="admin-tournament-publication__alert admin-tournament-publication__alert--error">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-tournament-publication__alert">{message}</p>
      )}

      <div className="admin-card admin-tournament-publication__selector">
        <label>
          Tournoi
          <select
            disabled={loading || publishing}
            value={selectedId}
            onChange={(event) => void chooseTournament(event.target.value)}
          >
            {tournaments.length === 0 && (
              <option value="">Aucun planning à publier</option>
            )}
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name} ·{" "}
                {tournament.status === "planning_published"
                  ? "Publié"
                  : "À publier"}
              </option>
            ))}
          </select>
        </label>
        {selectedSummary && (
          <span
            className={`admin-tournament-publication__status ${selectedSummary.status === "planning_published" ? "is-published" : ""}`}
          >
            {selectedSummary.status === "planning_published"
              ? "Planning publié"
              : "Planning généré"}
          </span>
        )}
      </div>

      {loading && <div className="admin-card">Vérification du calendrier…</div>}

      {!loading && tournaments.length === 0 && (
        <div className="admin-card admin-tournament-publication__empty">
          <h2>Aucun tournoi prêt à publier</h2>
          <p>
            Enregistrez d’abord un planning complet dans l’atelier Tournois →
            Planning.
          </p>
        </div>
      )}

      {preview && !loading && (
        <>
          <div className="admin-tournament-publication__metrics">
            <article className="admin-card">
              <span>Rencontres</span>
              <strong>{preview.matchCount}</strong>
            </article>
            <article className="admin-card">
              <span>Planifiées</span>
              <strong>
                {preview.plannedMatchCount}/{preview.matchCount}
              </strong>
            </article>
            <article className="admin-card">
              <span>Impacts calendrier</span>
              <strong className={hasConflicts ? "is-error" : "is-success"}>
                {preview.conflicts.length}
              </strong>
            </article>
            <article className="admin-card">
              <span>Publiées</span>
              <strong>{preview.publishedMatchCount}</strong>
            </article>
          </div>

          <section className="admin-card admin-tournament-publication__summary">
            <div>
              <h2>{preview.tournament.name}</h2>
              <p>
                {formatDate(preview.tournament.startsOn)} →{" "}
                {formatDate(preview.tournament.endsOn)}
              </p>
            </div>

            {isPublished ? (
              <div className="admin-tournament-publication__published-actions">
                <span className="admin-tournament-publication__published-copy">
                  Les matchs sont actuellement visibles et bloquants dans le
                  calendrier des réservations.
                </span>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => void unpublish()}
                >
                  {publishing
                    ? "Retrait en cours…"
                    : "Retirer du calendrier pour modifier"}
                </button>
              </div>
            ) : (
              <div className="admin-tournament-publication__publish-actions">
                <div>
                  {!complete && (
                    <p className="is-error">
                      Le planning n’est pas complet : toutes les rencontres
                      doivent être affectées avant publication.
                    </p>
                  )}
                  {complete && !hasConflicts && (
                    <p className="is-success">
                      Aucun impact détecté. Le planning peut être publié.
                    </p>
                  )}
                  {complete && hasConflicts && (
                    <p className="is-error">
                      {preview.conflicts.length} occupation(s) seront libérées
                      automatiquement : le tournoi est prioritaire.
                    </p>
                  )}
                </div>
                <button
                  className="admin-tournament-publication__primary"
                  type="button"
                  disabled={!canPublish || publishing}
                  onClick={() => void publish()}
                >
                  {publishing
                    ? "Publication en cours…"
                    : hasConflicts
                      ? `Publier ${preview.matchCount} matchs en priorité`
                      : `Publier ${preview.matchCount} matchs dans le calendrier`}
                </button>
              </div>
            )}
          </section>

          {seriesColors.length > 0 && (
            <section className="admin-card admin-tournament-publication__series-colors">
              <header>
                <div>
                  <h2>Couleurs des séries</h2>
                  <p>
                    Modifiables même après publication. La même couleur est
                    utilisée dans le planning, les réservations, les résultats
                    et le Mode TV.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!colorsDirty || savingColors}
                  onClick={() => void saveColors()}
                >
                  {savingColors ? "Enregistrement…" : "Enregistrer les couleurs"}
                </button>
              </header>
              <div className="admin-tournament-publication__series-color-list">
                {seriesColors.map((series) => (
                  <label key={series.id}>
                    <input
                      type="color"
                      value={series.color}
                      disabled={savingColors}
                      onChange={(event) =>
                        setSeriesColors((current) =>
                          current.map((item) =>
                            item.id === series.id
                              ? {
                                  ...item,
                                  color: event.target.value.toUpperCase(),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    <span style={{ backgroundColor: series.color }} />
                    <strong>{series.name}</strong>
                  </label>
                ))}
              </div>
            </section>
          )}

          {preview.conflicts.length > 0 && (
            <section className="admin-card admin-tournament-publication__conflicts">
              <header>
                <div>
                  <h2>Occupations remplacées à la publication</h2>
                  <p>
                    Le tournoi est prioritaire. Ces occupations seront libérées
                    dans la même transaction juste avant la publication des
                    matchs. Si la publication échoue, aucune modification ne
                    sera conservée.
                  </p>
                </div>
                <strong>{preview.conflicts.length}</strong>
              </header>
              <div className="admin-tournament-publication__conflict-list">
                {preview.conflicts.map((conflict) => (
                  <article key={`${conflict.matchId}-${conflict.occupationId}`}>
                    <div>
                      <strong>{conflict.matchLabel}</strong>
                      <span>
                        {formatDate(conflict.playDate)} ·{" "}
                        {formatTime(conflict.startsAt)}–
                        {formatTime(conflict.endsAt)} · {conflict.resourceName}
                      </span>
                    </div>
                    <div>
                      <span className="admin-tournament-publication__occupation-type">
                        {occupationTypeLabels[conflict.occupationType] ??
                          conflict.occupationType}
                      </span>
                      <strong>{conflict.occupationTitle}</strong>
                      <small>
                        {formatDateTime(conflict.occupationStartsAt)} →{" "}
                        {formatDateTime(conflict.occupationEndsAt)}
                      </small>
                      {conflict.conflictTournamentId &&
                        conflict.conflictTournamentName &&
                        conflict.conflictTournamentStatus ===
                          "planning_published" && (
                          <button
                            type="button"
                            className="admin-tournament-publication__resolve-conflict"
                            disabled={publishing}
                            onClick={() =>
                              void resolveConflictingTournament(
                                conflict.conflictTournamentId!,
                                conflict.conflictTournamentName!,
                              )
                            }
                          >
                            Retirer « {conflict.conflictTournamentName} » du
                            calendrier maintenant
                          </button>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
