import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminTournamentTeamService } from "@/features/admin/tournaments/services/adminTournamentTeamService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import type {
  AdminTournamentTeam,
  AdminTournamentTeamDraft,
  AdminTournamentTeamsPayload,
  TournamentAvailabilityRule,
  TournamentTeamStatus,
} from "@/features/tournaments/types";
import "./AdminTournamentTeamsPage.css";

const weekdays = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

const teamStatusLabels: Record<TournamentTeamStatus, string> = {
  pending: "À valider",
  accepted: "Validée",
  rejected: "Refusée",
  withdrawn: "Retirée",
};

const availabilityLabels = {
  preferred: "Préféré",
  possible: "Possible",
  unavailable: "Indisponible",
} as const;

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

const emptyAvailability = (): TournamentAvailabilityRule => ({
  kind: "preferred",
  weekday: 1,
  startsAt: "17:30",
  endsAt: "22:30",
});

const blankDraft = (seriesId = ""): AdminTournamentTeamDraft => ({
  seriesId,
  status: "accepted",
  contactEmail: "",
  contactPhone: "",
  comments: "",
  players: [
    { firstName: "", lastName: "", email: "", phone: "", role: "front" },
    { firstName: "", lastName: "", email: "", phone: "", role: "back" },
  ],
  availabilityRules: [],
});

const teamToDraft = (team: AdminTournamentTeam): AdminTournamentTeamDraft => ({
  seriesId: team.seriesId,
  status: team.status === "pending" ? "pending" : "accepted",
  contactEmail: team.contactEmail,
  contactPhone: team.contactPhone,
  comments: team.comments,
  players: team.players.map((player) => ({ ...player })),
  availabilityRules: team.availabilityRules.map((rule) => ({ ...rule })),
});

const playerName = (team: AdminTournamentTeam) =>
  team.players
    .map((player) => `${player.firstName} ${player.lastName}`.trim())
    .join(" / ");

export function AdminTournamentTeamsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState<AdminTournamentTeamsPayload | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState<AdminTournamentTeamDraft | null>(null);
  const [loading, setLoading] = useState(true);
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
    ? [
        "preparation",
        "configuration",
        "registrations_open",
        "registrations_closed",
      ].includes(data.tournament.status)
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

  const beginEdit = (team: AdminTournamentTeam) => {
    setEditingId(team.id);
    setDraft(teamToDraft(team));
    setError("");
    setMessage("");
  };

  const setAvailability = (index: number, rule: TournamentAvailabilityRule) => {
    if (!draft) return;
    setDraft({
      ...draft,
      availabilityRules: draft.availabilityRules.map((item, itemIndex) =>
        itemIndex === index ? rule : item,
      ),
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !selectedId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentTeamService.save(
        selectedId,
        editingId ?? null,
        draft,
      );
      await loadTeams(selectedId);
      setDraft(null);
      setEditingId(undefined);
      setMessage(
        editingId ? "Équipe mise à jour." : "Équipe ajoutée au tournoi.",
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
      await adminTournamentTeamService.setStatus(team.id, status);
      await loadTeams(selectedId);
      setMessage(`Équipe ${teamStatusLabels[status].toLowerCase()}.`);
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
            Validez les inscriptions, ajoutez une équipe manuellement et
            contrôlez les disponibilités avant la génération des poules.
          </p>
        </div>
        {editable && (
          <button
            className="admin-tournament-teams__primary"
            type="button"
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
                disabled={saving}
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
                  <strong>{counts.accepted}</strong> validées
                </span>
                <span>
                  <strong>{counts.pending}</strong> à valider
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
            <div className="admin-tournament-teams__series">
              {data.series.map((series) => (
                <article className="admin-card" key={series.id}>
                  <span>{series.enabled ? "Série active" : "Désactivée"}</span>
                  <h2>{series.name}</h2>
                  <strong>
                    {series.acceptedCount}/{series.capacity} validées
                  </strong>
                  <small>
                    {series.reservedCount ?? 0} place
                    {(series.reservedCount ?? 0) > 1 ? "s" : ""} réservée
                    {(series.reservedCount ?? 0) > 1 ? "s" : ""} avec les
                    dossiers en attente
                  </small>
                </article>
              ))}
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
                  onClick={() => {
                    setDraft(null);
                    setEditingId(undefined);
                  }}
                >
                  Fermer
                </button>
              </header>
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
                <label>
                  Statut à l’enregistrement
                  <select
                    disabled={saving}
                    value={draft.status}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        status: event.target
                          .value as AdminTournamentTeamDraft["status"],
                      })
                    }
                  >
                    <option value="accepted">Validée</option>
                    <option value="pending">À valider</option>
                  </select>
                </label>
                <label>
                  E-mail de contact
                  <input
                    required
                    type="email"
                    disabled={saving}
                    value={draft.contactEmail}
                    onChange={(event) =>
                      setDraft({ ...draft, contactEmail: event.target.value })
                    }
                  />
                </label>
                <label>
                  Téléphone de contact
                  <input
                    disabled={saving}
                    value={draft.contactPhone}
                    onChange={(event) =>
                      setDraft({ ...draft, contactPhone: event.target.value })
                    }
                  />
                </label>
              </div>

              <div className="admin-tournament-team-form__players">
                {draft.players.map((player, index) => (
                  <fieldset key={player.role}>
                    <legend>
                      {player.role === "front" ? "Avant" : "Arrière"}
                    </legend>
                    <div className="admin-tournament-team-form__grid">
                      <label>
                        Prénom
                        <input
                          required
                          disabled={saving}
                          value={player.firstName}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              players: draft.players.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      firstName: event.target.value,
                                    }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Nom
                        <input
                          required
                          disabled={saving}
                          value={player.lastName}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              players: draft.players.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, lastName: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        E-mail
                        <input
                          type="email"
                          disabled={saving}
                          value={player.email ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              players: draft.players.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, email: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Téléphone
                        <input
                          disabled={saving}
                          value={player.phone ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              players: draft.players.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, phone: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                  </fieldset>
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

              <div className="admin-tournament-team-form__availability">
                <header>
                  <div>
                    <h3>Disponibilités</h3>
                    <p>
                      Règles récurrentes utilisées ensuite par les moteurs de
                      poules et de planning.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        availabilityRules: [
                          ...draft.availabilityRules,
                          emptyAvailability(),
                        ],
                      })
                    }
                  >
                    + Ajouter une règle
                  </button>
                </header>
                {draft.availabilityRules.map((rule, index) => (
                  <div
                    className="admin-tournament-team-form__availability-row"
                    key={`${index}-${rule.kind}-${rule.weekday}`}
                  >
                    <select
                      aria-label={`Type disponibilité ${index + 1}`}
                      disabled={saving}
                      value={rule.kind}
                      onChange={(event) =>
                        setAvailability(index, {
                          ...rule,
                          kind: event.target
                            .value as TournamentAvailabilityRule["kind"],
                        })
                      }
                    >
                      {Object.entries(availabilityLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    <select
                      aria-label={`Jour disponibilité ${index + 1}`}
                      disabled={saving}
                      value={rule.weekday}
                      onChange={(event) =>
                        setAvailability(index, {
                          ...rule,
                          weekday: Number(event.target.value),
                        })
                      }
                    >
                      {weekdays.map((weekday) => (
                        <option key={weekday.value} value={weekday.value}>
                          {weekday.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Début disponibilité ${index + 1}`}
                      type="time"
                      disabled={saving}
                      value={rule.startsAt}
                      onChange={(event) =>
                        setAvailability(index, {
                          ...rule,
                          startsAt: event.target.value,
                        })
                      }
                    />
                    <input
                      aria-label={`Fin disponibilité ${index + 1}`}
                      type="time"
                      disabled={saving}
                      value={rule.endsAt}
                      onChange={(event) =>
                        setAvailability(index, {
                          ...rule,
                          endsAt: event.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          availabilityRules: draft.availabilityRules.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                    >
                      Retirer
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="admin-tournament-teams__primary"
                type="submit"
                disabled={saving}
              >
                Enregistrer l’équipe
              </button>
            </form>
          )}

          {data && (
            <div className="admin-tournament-team-list">
              {data.teams.length === 0 ? (
                <div className="admin-card">
                  <p>Aucune équipe inscrite pour ce tournoi.</p>
                </div>
              ) : (
                data.teams.map((team) => (
                  <article
                    className="admin-card admin-tournament-team-card"
                    key={team.id}
                  >
                    <header>
                      <div>
                        <span
                          className={`admin-tournament-team-status admin-tournament-team-status--${team.status}`}
                        >
                          {teamStatusLabels[team.status]}
                        </span>
                        <h2>{playerName(team)}</h2>
                        <p>
                          {team.seriesName} ·{" "}
                          {team.submittedBy
                            ? "Inscription en ligne"
                            : "Ajout administrateur"}
                        </p>
                      </div>
                      {editable && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => beginEdit(team)}
                        >
                          Modifier
                        </button>
                      )}
                    </header>
                    <dl>
                      <div>
                        <dt>Contact</dt>
                        <dd>
                          {team.contactEmail}
                          {team.contactPhone ? ` · ${team.contactPhone}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Disponibilités</dt>
                        <dd>{team.availabilityRules.length}</dd>
                      </div>
                    </dl>
                    {team.comments && (
                      <p className="admin-tournament-team-card__comments">
                        {team.comments}
                      </p>
                    )}
                    {team.availabilityRules.length > 0 && (
                      <div className="admin-tournament-team-card__rules">
                        {team.availabilityRules.map((rule, index) => (
                          <span key={`${team.id}-rule-${index}`}>
                            {availabilityLabels[rule.kind]} ·{" "}
                            {
                              weekdays.find(
                                (weekday) => weekday.value === rule.weekday,
                              )?.label
                            }{" "}
                            {rule.startsAt}–{rule.endsAt}
                          </span>
                        ))}
                      </div>
                    )}
                    {editable && (
                      <div className="admin-tournament-team-card__actions">
                        {team.status !== "accepted" && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void changeStatus(team, "accepted")}
                          >
                            Valider
                          </button>
                        )}
                        {team.status !== "rejected" && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void changeStatus(team, "rejected")}
                          >
                            Refuser
                          </button>
                        )}
                        {team.status !== "withdrawn" && (
                          <button
                            className="admin-tournament-team-card__danger"
                            type="button"
                            disabled={saving}
                            onClick={() => void changeStatus(team, "withdrawn")}
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
