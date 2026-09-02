import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminTournamentPlayerFields } from "@/features/admin/tournaments/components/AdminTournamentPlayerFields";
import { AdminErrebotAvailabilityImport } from "@/features/admin/tournaments/components/AdminErrebotAvailabilityImport";
import { adminTournamentTeamService } from "@/features/admin/tournaments/services/adminTournamentTeamService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import { TournamentAvailabilityGrid } from "@/features/tournaments/components/TournamentAvailabilityGrid";
import type {
  AdminTournamentTeam,
  AdminTournamentTeamDraft,
  AdminTournamentTeamsPayload,
  TournamentAvailabilitySlot,
  TournamentTeamStatus,
} from "@/features/tournaments/types";
import "./AdminTournamentTeamsPage.css";

const teamStatusLabels: Record<TournamentTeamStatus, string> = {
  pending: "À valider",
  accepted: "Inscrite",
  rejected: "Refusée",
  withdrawn: "Retirée",
};

const tournamentStatusLabels: Record<string, string> = {
  preparation: "Préparation",
  configuration: "Configuration",
  registrations_open: "Inscriptions ouvertes",
  registrations_closed: "Inscriptions fermées",
  pools_generated: "Poules générées",
  pools_validated: "Poules validées",
  planning_generated: "Planning généré",
  planning_published: "Planning publié",
  in_progress: "En cours",
  completed: "Terminé",
  archived: "Archivé",
  cancelled: "Annulé",
};

const adminEditableStatuses = new Set([
  "preparation",
  "configuration",
  "registrations_open",
  "registrations_closed",
  "pools_generated",
  "pools_validated",
]);

const poolStatuses = new Set(["pools_generated", "pools_validated"]);

const blankDraft = (seriesId = ""): AdminTournamentTeamDraft => ({
  seriesId,
  status: "accepted",
  comments: "",
  players: [
    {
      firstName: "",
      lastName: "",
      clubName: "",
      email: "",
      phone: "",
      role: "front",
    },
    {
      firstName: "",
      lastName: "",
      clubName: "",
      email: "",
      phone: "",
      role: "back",
    },
  ],
  availabilityRules: [],
  availabilitySlots: [],
});

const teamToDraft = (
  team: AdminTournamentTeam,
  availabilitySlots: TournamentAvailabilitySlot[],
): AdminTournamentTeamDraft => ({
  seriesId: team.seriesId,
  status: team.status === "pending" ? "pending" : "accepted",
  comments: team.comments,
  players: team.players.map((player) => ({ ...player })),
  availabilityRules: [],
  availabilitySlots,
});

const playerName = (team: AdminTournamentTeam) =>
  team.players
    .map((player) => `${player.firstName} ${player.lastName}`.trim())
    .join(" / ");

const teamClubNames = (team: AdminTournamentTeam) => [
  ...new Set(
    team.players.map((player) => player.clubName.trim()).filter(Boolean),
  ),
];

const availabilitySummary = (
  team: AdminTournamentTeam,
  data: AdminTournamentTeamsPayload,
) => {
  const pool = `Poules ${team.poolAvailabilitySlotCount}/${data.tournament.availablePoolSlotCount}`;
  if (data.tournament.availableFinalsSlotCount === 0) return pool;
  return `${pool} · Finale ${team.finalsAvailabilitySlotCount}/${data.tournament.availableFinalsSlotCount}`;
};

const seriesAnchor = (seriesId: string) => `tournament-series-${seriesId}`;

export function AdminTournamentTeamsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState<AdminTournamentTeamsPayload | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState<AdminTournamentTeamDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadTeams = async (tournamentId: string) => {
    if (!tournamentId) {
      setData(null);
      return;
    }
    setData(await adminTournamentTeamService.get(tournamentId));
  };

  const reloadSelected = async () => {
    if (!selectedId) return;
    const [items, payload] = await Promise.all([
      tournamentAdminService.list(),
      adminTournamentTeamService.get(selectedId),
    ]);
    setTournaments(items);
    setData(payload);
  };

  useEffect(() => {
    let active = true;
    tournamentAdminService
      .list()
      .then(async (items) => {
        if (!active) return;
        setTournaments(items);
        const preferred =
          items.find((item) =>
            [
              "configuration",
              "registrations_open",
              "registrations_closed",
              "pools_generated",
              "pools_validated",
              "preparation",
            ].includes(item.status),
          ) ?? items[0];
        if (preferred) {
          setSelectedId(preferred.id);
          const payload = await adminTournamentTeamService.get(preferred.id);
          if (active) setData(payload);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les équipes.",
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

  const editable = data
    ? adminEditableStatuses.has(data.tournament.status)
    : false;
  const poolsAlreadyBuilt = data
    ? poolStatuses.has(data.tournament.status)
    : false;

  const counts = useMemo(() => {
    const result: Record<TournamentTeamStatus, number> = {
      pending: 0,
      accepted: 0,
      rejected: 0,
      withdrawn: 0,
    };
    for (const team of data?.teams ?? []) result[team.status] += 1;
    return result;
  }, [data]);

  const teamsBySeries = useMemo(() => {
    const grouped = new Map<string, AdminTournamentTeam[]>();
    for (const series of data?.series ?? []) grouped.set(series.id, []);
    for (const team of data?.teams ?? []) {
      const current = grouped.get(team.seriesId) ?? [];
      current.push(team);
      grouped.set(team.seriesId, current);
    }
    for (const teams of grouped.values()) {
      teams.sort((left, right) =>
        playerName(left).localeCompare(playerName(right), "fr", {
          sensitivity: "base",
        }),
      );
    }
    return grouped;
  }, [data]);

  const chooseTournament = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    setError("");
    setMessage("");
    setDraft(null);
    setEditingId(undefined);
    try {
      await loadTeams(id);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les équipes.",
      );
    } finally {
      setLoading(false);
    }
  };

  const beginCreate = () => {
    setEditingId(null);
    setDraft(
      blankDraft(data?.series.find((series) => series.enabled)?.id ?? ""),
    );
    setError("");
    setMessage("");
  };

  const beginEdit = async (team: AdminTournamentTeam) => {
    setLoadingDraft(true);
    setError("");
    setMessage("");
    try {
      const availabilitySlots =
        await adminTournamentTeamService.getDatedAvailability(team.id);
      setEditingId(team.id);
      setDraft(teamToDraft(team, availabilitySlots));
      window.setTimeout(() => {
        document
          .querySelector(".admin-tournament-team-form")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les disponibilités de l’équipe.",
      );
    } finally {
      setLoadingDraft(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !selectedId) return;
    if (draft.players.some((player) => !player.clubName.trim())) {
      setError("Renseignez le club de chacun des deux joueurs.");
      return;
    }
    if (
      draft.players.some(
        (player) =>
          (!player.emailFromMember && !(player.email ?? "").trim()) ||
          (!player.phoneFromMember && !(player.phone ?? "").trim()),
      )
    ) {
      setError(
        "Renseignez l’e-mail et le téléphone de chacun des deux joueurs.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await adminTournamentTeamService.save(
        selectedId,
        editingId ?? null,
        draft,
      );
      await reloadSelected();
      setDraft(null);
      setEditingId(undefined);
      const baseMessage = editingId
        ? "Équipe mise à jour."
        : "Équipe ajoutée au tournoi.";
      setMessage(
        result.poolsInvalidated
          ? `${baseMessage} Les poules ont été invalidées : régénérez-les.`
          : baseMessage,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d’enregistrer l’équipe.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (
    team: AdminTournamentTeam,
    status: TournamentTeamStatus,
  ) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await adminTournamentTeamService.setStatus(
        team.id,
        status,
      );
      await reloadSelected();
      const baseMessage = `Équipe ${teamStatusLabels[status].toLowerCase()}.`;
      setMessage(
        result.poolsInvalidated
          ? `${baseMessage} Les poules ont été invalidées : régénérez-les.`
          : baseMessage,
      );
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Impossible de modifier le statut de l’équipe.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async (team: AdminTournamentTeam) => {
    const name = playerName(team);
    const poolWarning =
      poolsAlreadyBuilt && team.status === "accepted"
        ? " Les poules actuelles seront supprimées et devront être régénérées."
        : "";
    if (
      !window.confirm(
        `Supprimer définitivement l’équipe ${name} ? Cette action est irréversible.${poolWarning}`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await adminTournamentTeamService.delete(team.id);
      await reloadSelected();
      if (editingId === team.id) {
        setDraft(null);
        setEditingId(undefined);
      }
      setMessage(
        result.poolsInvalidated
          ? "Équipe supprimée. Les poules ont été invalidées : régénérez-les."
          : "Équipe supprimée définitivement.",
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer l’équipe.",
      );
    } finally {
      setSaving(false);
    }
  };

  const jumpToSeries = (seriesId: string) => {
    document.getElementById(seriesAnchor(seriesId))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (loading && tournaments.length === 0) {
    return (
      <section className="admin-page admin-tournament-teams">
        <p role="status">Chargement des inscriptions…</p>
      </section>
    );
  }

  return (
    <section className="admin-page admin-tournament-teams">
      <header className="admin-page__header admin-tournament-teams__heading">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Équipes & inscriptions</h1>
          <p className="admin-page__lead">
            Suivez les capacités par série, les clubs des joueurs et les
            disponibilités avant la génération du planning.
          </p>
        </div>
        {editable && (
          <button
            className="admin-tournament-teams__primary"
            type="button"
            disabled={loadingDraft || saving}
            onClick={beginCreate}
          >
            Ajouter une équipe
          </button>
        )}
      </header>

      {error && (
        <p
          className="admin-tournament-teams__alert admin-tournament-teams__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="admin-tournament-teams__alert" role="status">
          {message}
        </p>
      )}
      {loadingDraft && <p role="status">Chargement de l’équipe…</p>}

      {tournaments.length === 0 ? (
        <div className="admin-card">
          <p>Créez d’abord un tournoi dans le module Tournois.</p>
        </div>
      ) : (
        <>
          <div className="admin-card admin-tournament-teams__selector">
            <label>
              Tournoi
              <select
                value={selectedId}
                disabled={saving || loadingDraft}
                onChange={(event) => void chooseTournament(event.target.value)}
              >
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name} ·{" "}
                    {tournamentStatusLabels[tournament.status] ??
                      tournament.status}
                  </option>
                ))}
              </select>
            </label>
            {data && (
              <div className="admin-tournament-teams__counters">
                <span>
                  <strong>{counts.accepted}</strong> inscrites
                </span>
                <span>
                  <strong>{counts.pending}</strong> en attente
                </span>
                <span>
                  <strong>{counts.rejected}</strong> refusées
                </span>
                <span>
                  <strong>{counts.withdrawn}</strong> retirées
                </span>
              </div>
            )}
          </div>

          {data && (
            <AdminErrebotAvailabilityImport
              tournamentId={selectedId}
              onImported={reloadSelected}
            />
          )}

          {data && (
            <div className="admin-tournament-teams__series">
              {data.series.map((series) => (
                <button
                  className="admin-card admin-tournament-series-card"
                  key={series.id}
                  type="button"
                  onClick={() => jumpToSeries(series.id)}
                >
                  <span>{series.enabled ? "Série active" : "Désactivée"}</span>
                  <h2>{series.name}</h2>
                  <strong>
                    {series.acceptedCount}/{series.capacity} inscrites
                  </strong>
                  <small>
                    {series.remainingSlots} place
                    {series.remainingSlots > 1 ? "s" : ""} disponible
                    {series.remainingSlots > 1 ? "s" : ""} · Aller au tableau ↓
                  </small>
                </button>
              ))}
            </div>
          )}

          {data && (
            <div className="admin-card admin-tournament-teams__phase-summary">
              <div>
                <span>Phase de poules</span>
                <strong>
                  {data.tournament.poolStartsOn} → {data.tournament.poolEndsOn}
                </strong>
                <small>
                  {data.tournament.availablePoolSlotCount} créneaux possibles ·
                  minimum {data.tournament.minimumAvailabilitySlots} par équipe
                </small>
              </div>
              <div>
                <span>Phase finale</span>
                <strong>
                  {data.tournament.finalsStartsOn &&
                  data.tournament.finalsEndsOn
                    ? `${data.tournament.finalsStartsOn} → ${data.tournament.finalsEndsOn}`
                    : "Non planifiée"}
                </strong>
                <small>
                  {data.tournament.availableFinalsSlotCount} créneau
                  {data.tournament.availableFinalsSlotCount > 1 ? "x" : ""}{" "}
                  possible
                  {data.tournament.availableFinalsSlotCount > 1 ? "s" : ""}
                </small>
              </div>
            </div>
          )}

          {draft && data && (
            <form
              className="admin-card admin-tournament-team-form"
              onSubmit={submit}
            >
              <header>
                <div>
                  <p className="admin-page__eyebrow">
                    {editingId ? "Modification" : "Ajout manuel"}
                  </p>
                  <h2>
                    {editingId ? "Modifier l’équipe" : "Ajouter une équipe"}
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDraft(null);
                    setEditingId(undefined);
                  }}
                >
                  Fermer
                </button>
              </header>

              {poolsAlreadyBuilt && (
                <p className="admin-tournament-teams__alert" role="status">
                  Les corrections de nom, club, coordonnées ou disponibilités
                  conservent les poules. Un ajout, une réactivation ou un
                  changement de série les invalidera automatiquement.
                </p>
              )}

              <div className="admin-tournament-team-form__grid">
                <label>
                  Série
                  <select
                    required
                    disabled={saving}
                    value={draft.seriesId}
                    onChange={(event) =>
                      setDraft({ ...draft, seriesId: event.target.value })
                    }
                  >
                    <option value="">Choisir une série</option>
                    {data.series
                      .filter((series) => series.enabled)
                      .map((series) => (
                        <option key={series.id} value={series.id}>
                          {series.name} · {series.remainingSlots} place
                          {series.remainingSlots > 1 ? "s" : ""}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="admin-tournament-team-form__players">
                {draft.players.map((player, index) => (
                  <AdminTournamentPlayerFields
                    key={player.role}
                    tournamentId={selectedId}
                    teamId={editingId ?? null}
                    player={player}
                    excludedMemberId={
                      draft.players.find(
                        (_, playerIndex) => playerIndex !== index,
                      )?.memberId ?? null
                    }
                    disabled={saving}
                    onError={setError}
                    onChange={(nextPlayer) =>
                      setDraft({
                        ...draft,
                        players: draft.players.map((item, itemIndex) =>
                          itemIndex === index ? nextPlayer : item,
                        ),
                      })
                    }
                  />
                ))}
              </div>

              <label>
                Commentaire
                <textarea
                  rows={3}
                  disabled={saving}
                  value={draft.comments}
                  onChange={(event) =>
                    setDraft({ ...draft, comments: event.target.value })
                  }
                />
              </label>

              <TournamentAvailabilityGrid
                variant="admin"
                tournament={data.tournament}
                value={draft.availabilitySlots}
                disabled={saving}
                onChange={(availabilitySlots) =>
                  setDraft({ ...draft, availabilitySlots })
                }
              />

              <button
                className="admin-tournament-teams__primary"
                type="submit"
                disabled={saving}
              >
                Enregistrer l’équipe et ses disponibilités
              </button>
            </form>
          )}

          {data && (
            <div className="admin-card admin-tournament-team-table-card">
              <header>
                <div>
                  <p className="admin-page__eyebrow">Inscriptions</p>
                  <h2>Tableau des équipes</h2>
                </div>
                <small>{data.teams.length} équipe(s) au total</small>
              </header>

              {data.teams.length === 0 ? (
                <p>Aucune équipe inscrite pour ce tournoi.</p>
              ) : (
                <div className="admin-tournament-team-table-wrap">
                  <table className="admin-tournament-team-table">
                    <thead>
                      <tr>
                        <th scope="col">Équipe</th>
                        <th scope="col">Club(s)</th>
                        <th scope="col">Coordonnées joueurs</th>
                        <th scope="col">Disponibilités</th>
                        <th scope="col">Origine</th>
                        <th scope="col">Statut</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    {data.series.map((series) => {
                      const seriesTeams = teamsBySeries.get(series.id) ?? [];
                      return (
                        <tbody
                          id={seriesAnchor(series.id)}
                          key={series.id}
                          className="admin-tournament-team-table__series"
                        >
                          <tr className="admin-tournament-team-table__series-heading">
                            <th colSpan={7} scope="rowgroup">
                              <strong>{series.name}</strong>
                              <span>
                                {series.acceptedCount}/{series.capacity}{" "}
                                inscrites
                              </span>
                            </th>
                          </tr>
                          {seriesTeams.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="admin-tournament-team-table__empty"
                              >
                                Aucune équipe dans cette série.
                              </td>
                            </tr>
                          ) : (
                            seriesTeams.map((team) => (
                              <tr key={team.id}>
                                <td className="admin-tournament-team-table__team">
                                  <strong>{playerName(team)}</strong>
                                  {team.comments && (
                                    <small>{team.comments}</small>
                                  )}
                                </td>
                                <td>
                                  {teamClubNames(team).length > 0 ? (
                                    teamClubNames(team).map((clubName) => (
                                      <small key={clubName}>{clubName}</small>
                                    ))
                                  ) : (
                                    <small>Non renseigné</small>
                                  )}
                                </td>
                                <td className="admin-tournament-team-table__contacts">
                                  {team.players.map((player) => (
                                    <div key={player.role}>
                                      <strong>
                                        {player.role === "front"
                                          ? "Avant"
                                          : "Arrière"}
                                      </strong>
                                      <span>
                                        {player.email || "E-mail manquant"}
                                      </span>
                                      <small>
                                        {player.phone || "Téléphone manquant"}
                                      </small>
                                    </div>
                                  ))}
                                </td>
                                <td>
                                  <strong>
                                    {availabilitySummary(team, data)}
                                  </strong>
                                  <small>
                                    Week-end poules:{" "}
                                    {team.weekendAvailabilitySlotCount}
                                  </small>
                                </td>
                                <td>
                                  {team.submittedBy ? "En ligne" : "Admin"}
                                </td>
                                <td>
                                  <span
                                    className={`admin-tournament-team-status admin-tournament-team-status--${team.status}`}
                                  >
                                    {teamStatusLabels[team.status]}
                                  </span>
                                </td>
                                <td>
                                  <div className="admin-tournament-team-table__actions">
                                    {editable &&
                                      team.status !== "withdrawn" && (
                                        <button
                                          type="button"
                                          disabled={saving || loadingDraft}
                                          onClick={() => void beginEdit(team)}
                                        >
                                          Modifier
                                        </button>
                                      )}
                                    {editable &&
                                      team.status !== "accepted" &&
                                      team.status !== "withdrawn" && (
                                        <button
                                          type="button"
                                          disabled={saving || loadingDraft}
                                          onClick={() =>
                                            void changeStatus(team, "accepted")
                                          }
                                        >
                                          Réactiver
                                        </button>
                                      )}
                                    {editable &&
                                      team.status !== "withdrawn" && (
                                        <button
                                          className="admin-tournament-team-card__danger"
                                          type="button"
                                          disabled={saving || loadingDraft}
                                          onClick={() =>
                                            void changeStatus(team, "withdrawn")
                                          }
                                        >
                                          Retirer
                                        </button>
                                      )}
                                    {editable && (
                                      <button
                                        className="admin-tournament-team-card__danger"
                                        type="button"
                                        disabled={saving || loadingDraft}
                                        onClick={() => void deleteTeam(team)}
                                      >
                                        Supprimer
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
