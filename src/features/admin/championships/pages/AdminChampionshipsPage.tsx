import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  buildChampionshipMatchesUpdatePayload,
  type ChampionshipMatchesUpdatePayload,
  type ChampionshipMatchesUpdatePreviewFile,
} from "@/features/admin/championships/domain/championshipMatchesUpdate";
import {
  championshipImportService,
  type AdminChampionshipDetail,
  type AdminChampionshipSummary,
  type ChampionshipUpdatePreview,
} from "@/features/admin/championships/services/championshipImportService";
import { championshipSourceFileService } from "@/features/admin/championships/services/championshipSourceFileService";
import { ROUTES } from "@/shared/config";
import "./AdminChampionshipsPage.css";

const statusLabel: Record<string, string> = {
  preparation: "Préparation",
  active: "En cours",
  completed: "Terminé",
  archived: "Archivé",
};

const matchStatusLabel: Record<string, string> = {
  to_schedule: "À organiser",
  scheduled: "Programmée",
  postponed: "Reportée",
  played: "Jouée",
  forfeit: "Forfait",
  cancelled: "Annulée",
};

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatDateTime = (date: string | null, time: string | null) => {
  const formattedDate = formatDate(date);
  if (formattedDate === "—") return formattedDate;
  return time ? `${formattedDate} · ${time.slice(0, 5)}` : formattedDate;
};

export function AdminChampionshipsPage() {
  const [items, setItems] = useState<AdminChampionshipSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminChampionshipDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [clubFilter, setClubFilter] = useState("");
  const [updateFile, setUpdateFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] =
    useState<ChampionshipMatchesUpdatePreviewFile | null>(null);
  const [updatePayload, setUpdatePayload] =
    useState<ChampionshipMatchesUpdatePayload | null>(null);
  const [updatePreview, setUpdatePreview] =
    useState<ChampionshipUpdatePreview | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  const loadList = async () => {
    const result = await championshipImportService.list();
    setItems(result);
    return result;
  };

  useEffect(() => {
    let active = true;
    void loadList()
      .then((result) => {
        if (active && result.length === 1) setSelectedId(result[0].id);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les championnats.",
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailBusy(true);
    setError("");
    void championshipImportService
      .detail(selectedId)
      .then((result) => {
        if (active) {
          setDetail(result);
          setDivisionFilter("all");
          setPhaseFilter("all");
          setClubFilter("");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger le championnat.",
          );
        }
      })
      .finally(() => {
        if (active) setDetailBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const phases = useMemo(() => {
    if (!detail) return [];
    return Array.from(
      new Set(
        detail.matches
          .filter(
            (match) =>
              divisionFilter === "all" || match.divisionId === divisionFilter,
          )
          .map((match) => match.phase),
      ),
    ).sort((a, b) => a.localeCompare(b, "fr"));
  }, [detail, divisionFilter]);

  const filteredMatches = useMemo(() => {
    if (!detail) return [];
    const clubNeedle = clubFilter.trim().toLocaleLowerCase("fr-FR");
    return detail.matches.filter((match) => {
      if (divisionFilter !== "all" && match.divisionId !== divisionFilter) {
        return false;
      }
      if (phaseFilter !== "all" && match.phase !== phaseFilter) return false;
      if (
        clubNeedle &&
        !match.team1Label.toLocaleLowerCase("fr-FR").includes(clubNeedle) &&
        !match.team2Label.toLocaleLowerCase("fr-FR").includes(clubNeedle)
      ) {
        return false;
      }
      return true;
    });
  }, [clubFilter, detail, divisionFilter, phaseFilter]);

  const filteredTeams = useMemo(() => {
    if (!detail) return [];
    return detail.teams.filter(
      (team) => divisionFilter === "all" || team.divisionId === divisionFilter,
    );
  }, [detail, divisionFilter]);

  const selectUpdateFile = (event: ChangeEvent<HTMLInputElement>) => {
    setUpdateFile(event.target.files?.[0] ?? null);
    setFilePreview(null);
    setUpdatePayload(null);
    setUpdatePreview(null);
    setUpdateMessage("");
    setError("");
  };

  const analyseUpdate = async () => {
    if (!selectedId || !updateFile) return;
    setUpdateBusy(true);
    setError("");
    setUpdateMessage("");
    setUpdatePreview(null);
    try {
      const parsed = await championshipSourceFileService.parseMatchesUpdate(
        updateFile,
      );
      setFilePreview(parsed);
      if (!parsed.valid) return;
      const descriptor =
        await championshipSourceFileService.describeMatchesUpdate(
          updateFile,
          parsed.matches.length,
        );
      const payload = buildChampionshipMatchesUpdatePayload(parsed, descriptor);
      setUpdatePayload(payload);
      setUpdatePreview(
        await championshipImportService.previewMatchesUpdate(
          selectedId,
          payload,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’analyser la mise à jour.",
      );
    } finally {
      setUpdateBusy(false);
    }
  };

  const applyUpdate = async () => {
    if (!selectedId || !updatePayload || !updatePreview?.valid) return;
    setUpdateBusy(true);
    setError("");
    try {
      const result = await championshipImportService.applyMatchesUpdate(
        selectedId,
        updatePayload,
      );
      setUpdateMessage(
        result.alreadyImported
          ? "Ce fichier avait déjà été appliqué : aucune donnée n’a été dupliquée."
          : `Mise à jour appliquée : ${result.summary.changedCount} rencontre(s) modifiée(s) et ${result.summary.newCount} ajoutée(s).`,
      );
      setUpdatePreview(null);
      setUpdatePayload(null);
      setFilePreview(null);
      setUpdateFile(null);
      const [nextDetail] = await Promise.all([
        championshipImportService.detail(selectedId),
        loadList(),
      ]);
      setDetail(nextDetail);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’appliquer la mise à jour.",
      );
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <section className="admin-page admin-championships">
      <header className="admin-page__header admin-championships__header">
        <div>
          <p className="admin-page__eyebrow">Championnats</p>
          <h1>Gestion des championnats</h1>
          <p className="admin-page__lead">
            Consultez le championnat complet et actualisez les résultats ou les
            phases finales avec le nouveau fichier officiel des parties.
          </p>
        </div>
        <Link
          className="admin-championships__primary"
          to={ROUTES.adminChampionshipImport}
        >
          Importer un championnat
        </Link>
      </header>

      {error && <p className="admin-championships__alert">{error}</p>}
      {busy && <div className="admin-card">Chargement des championnats…</div>}

      {!busy && !error && items.length === 0 && (
        <div className="admin-card admin-championships__empty">
          <h2>Aucun championnat importé</h2>
          <p>
            Importez les fichiers officiels des parties et des engagements pour
            créer le premier championnat.
          </p>
          <Link to={ROUTES.adminChampionshipImport}>Commencer l’import</Link>
        </div>
      )}

      {!busy && items.length > 0 && (
        <div className="admin-championships__grid">
          {items.map((item) => (
            <article
              className={`admin-card admin-championships__card${selectedId === item.id ? " admin-championships__card--selected" : ""}`}
              key={item.id}
            >
              <div className="admin-championships__card-head">
                <div>
                  <span>{item.seasonLabel || "Saison non précisée"}</span>
                  <h2>{item.name}</h2>
                  <p>{item.specialty}</p>
                </div>
                <strong>{statusLabel[item.status] ?? item.status}</strong>
              </div>
              <dl>
                <div>
                  <dt>Séries</dt>
                  <dd>{item.divisionCount}</dd>
                </div>
                <div>
                  <dt>Équipes</dt>
                  <dd>{item.teamCount}</dd>
                </div>
                <div>
                  <dt>Parties</dt>
                  <dd>{item.matchCount}</dd>
                </div>
              </dl>
              <div className="admin-championships__card-actions">
                <button type="button" onClick={() => setSelectedId(item.id)}>
                  {selectedId === item.id ? "Ouvert" : "Consulter / actualiser"}
                </button>
                {item.sourceUrl && (
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Source officielle
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {detailBusy && (
        <div className="admin-card">Chargement du championnat complet…</div>
      )}

      {detail && !detailBusy && (
        <>
          <div className="admin-card admin-championships__detail-head">
            <div>
              <span>Championnat sélectionné</span>
              <h2>{detail.name}</h2>
              <p>{detail.specialty}</p>
            </div>
            <div>
              <span>Dernière mise à jour</span>
              <strong>
                {detail.lastImportAt
                  ? new Date(detail.lastImportAt).toLocaleString("fr-FR")
                  : "Import initial"}
              </strong>
            </div>
          </div>

          <div className="admin-card admin-championships__update">
            <div>
              <p className="admin-page__eyebrow">Actualisation</p>
              <h2>Mettre à jour avec le nouveau parties.xlsx</h2>
              <p>
                Pas besoin de réimporter les engagements. Pelote Manager compare
                le fichier à l’état actuel avant toute écriture : nouveaux
                résultats, reports, changements de lieu et nouvelles phases.
              </p>
            </div>
            <div className="admin-championships__update-controls">
              <label>
                Nouveau fichier des parties (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={selectUpdateFile}
                  disabled={updateBusy}
                />
                <span>
                  {updateFile?.name ?? "Aucun fichier de mise à jour sélectionné"}
                </span>
              </label>
              <button
                type="button"
                onClick={() => void analyseUpdate()}
                disabled={!updateFile || updateBusy}
              >
                {updateBusy ? "Analyse en cours…" : "Comparer avant mise à jour"}
              </button>
            </div>

            {filePreview && !filePreview.valid && (
              <div className="admin-championships__update-issues" role="alert">
                <strong>Le fichier ne peut pas encore être utilisé.</strong>
                {filePreview.issues.map((issue, index) => (
                  <p key={`${issue.row}-${index}`}>{issue.message}</p>
                ))}
              </div>
            )}

            {updatePreview && (
              <div className="admin-championships__diff">
                <div className="admin-championships__diff-kpis">
                  <div>
                    <strong>{updatePreview.summary.resultAddedCount}</strong>
                    <span>nouveaux résultats</span>
                  </div>
                  <div>
                    <strong>{updatePreview.summary.changedCount}</strong>
                    <span>rencontres modifiées</span>
                  </div>
                  <div>
                    <strong>{updatePreview.summary.rescheduledCount}</strong>
                    <span>dates / reports modifiés</span>
                  </div>
                  <div>
                    <strong>{updatePreview.summary.newCount}</strong>
                    <span>nouvelles rencontres</span>
                  </div>
                  <div>
                    <strong>{updatePreview.summary.newPhaseCount}</strong>
                    <span>nouvelles phases</span>
                  </div>
                  <div>
                    <strong>{updatePreview.summary.unchangedCount}</strong>
                    <span>inchangées</span>
                  </div>
                </div>

                {updatePreview.alreadyImported && (
                  <p className="admin-championships__success">
                    Ce fichier a déjà été appliqué. Pelote Manager ne le
                    dupliquera pas.
                  </p>
                )}

                {updatePreview.issues.length > 0 && (
                  <div className="admin-championships__update-issues">
                    {updatePreview.issues.map((issue, index) => (
                      <p key={`${issue.code}-${index}`}>{issue.message}</p>
                    ))}
                  </div>
                )}

                {updatePreview.changes.length > 0 && (
                  <div className="admin-championships__change-list">
                    <h3>Détail des changements</h3>
                    {updatePreview.changes.slice(0, 100).map((change, index) => (
                      <div key={`${change.kind}-${index}`}>
                        <strong>
                          {change.kind === "new" ? "Nouvelle" : "Modification"}
                          {" · "}
                          {change.category} · {change.phase}
                        </strong>
                        <span>
                          {change.team1} {change.team1Number} — {change.team2}{" "}
                          {change.team2Number}
                          {change.score ? ` · ${change.score}` : ""}
                        </span>
                        <small>{change.fields.join(", ")}</small>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="admin-championships__apply"
                  disabled={
                    updateBusy ||
                    !updatePreview.valid ||
                    updatePreview.alreadyImported
                  }
                  onClick={() => void applyUpdate()}
                >
                  Appliquer cette mise à jour
                </button>
              </div>
            )}

            {updateMessage && (
              <p className="admin-championships__success">{updateMessage}</p>
            )}
          </div>

          <div className="admin-card admin-championships__consultation">
            <div className="admin-championships__consultation-head">
              <div>
                <p className="admin-page__eyebrow">Consultation</p>
                <h2>Calendrier et résultats</h2>
                <p>
                  {filteredMatches.length} rencontre(s) affichée(s) sur{" "}
                  {detail.matches.length}.
                </p>
              </div>
              <div className="admin-championships__filters">
                <label>
                  Série
                  <select
                    value={divisionFilter}
                    onChange={(event) => {
                      setDivisionFilter(event.target.value);
                      setPhaseFilter("all");
                    }}
                  >
                    <option value="all">Toutes les séries</option>
                    {detail.divisions.map((division) => (
                      <option key={division.id} value={division.id}>
                        {division.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Phase
                  <select
                    value={phaseFilter}
                    onChange={(event) => setPhaseFilter(event.target.value)}
                  >
                    <option value="all">Toutes les phases</option>
                    {phases.map((phase) => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Club
                  <input
                    type="search"
                    value={clubFilter}
                    placeholder="Ex. Lourdes"
                    onChange={(event) => setClubFilter(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="admin-championships__matches-table-wrap">
              <table className="admin-championships__matches-table">
                <thead>
                  <tr>
                    <th>Série / phase</th>
                    <th>Date</th>
                    <th>Rencontre</th>
                    <th>Score</th>
                    <th>Lieu</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.slice(0, 250).map((match) => (
                    <tr key={match.id}>
                      <td>
                        <strong>{match.divisionName}</strong>
                        <span>
                          {match.phase}
                          {match.poolCode ? ` · Poule ${match.poolCode}` : ""}
                        </span>
                      </td>
                      <td>
                        {formatDateTime(
                          match.reportOn ?? match.agreementOn ?? match.scheduledOn,
                          match.reportTime ??
                            match.agreementTime ??
                            match.scheduledTime,
                        )}
                      </td>
                      <td>
                        <strong>{match.team1Label}</strong>
                        <span>{match.team2Label}</span>
                      </td>
                      <td>{match.scoreRaw ?? "—"}</td>
                      <td>
                        {match.agreementVenue ?? match.venue ?? "—"}
                      </td>
                      <td>{matchStatusLabel[match.status] ?? match.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredMatches.length > 250 && (
              <p className="admin-championships__limit-note">
                Les 250 premières rencontres sont affichées. Utilisez les
                filtres pour cibler une série, une phase ou un club.
              </p>
            )}
          </div>

          <details className="admin-card admin-championships__teams">
            <summary>
              Équipes et joueurs · {filteredTeams.length} équipe(s)
            </summary>
            <div className="admin-championships__team-grid">
              {filteredTeams.map((team) => (
                <article key={team.id}>
                  <strong>{team.sourceLabel}</strong>
                  <span>
                    {team.poolCode ? `Poule ${team.poolCode}` : "Hors poule"}
                  </span>
                  <ul>
                    {team.players.map((player) => (
                      <li key={player.id}>
                        {player.firstName} {player.lastName} ({player.licenceNumber})
                        {player.linked ? " · compte lié" : ""}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}