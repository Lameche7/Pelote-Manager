import { useEffect, useMemo, useState } from "react";
import {
  adminTournamentPlanningService,
  type TournamentPlanningWorkspace,
} from "@/features/admin/tournaments/services/adminTournamentPlanningService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import {
  generatePlanningProposal,
  validatePlanning,
  type PlanningAssignment,
  type PlanningMatch,
  type PlanningSlot,
} from "@/features/tournaments/domain/planningEngine";
import "./AdminTournamentPlanningPage.css";

const statusLabels: Record<string, string> = {
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

const slotAvailabilityKey = (slot: {
  date: string;
  startsAt: string;
  endsAt: string;
}) => `${slot.date}|${slot.startsAt}|${slot.endsAt}`;

const formatTime = (value: string) => value.slice(0, 5);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${value}T12:00:00`));

const signature = (assignments: PlanningAssignment[]) =>
  JSON.stringify(
    [...assignments]
      .sort((left, right) => left.matchId.localeCompare(right.matchId))
      .map((assignment) => [assignment.matchId, assignment.slotId]),
  );

export function AdminTournamentPlanningPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] = useState<TournamentPlanningWorkspace | null>(
    null,
  );
  const [assignments, setAssignments] = useState<PlanningAssignment[]>([]);
  const [savedAssignments, setSavedAssignments] = useState<PlanningAssignment[]>(
    [],
  );
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [distributionRate, setDistributionRate] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [manualEdit, setManualEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const hydrate = (loaded: TournamentPlanningWorkspace) => {
    setWorkspace(loaded);
    setAssignments(loaded.planning);
    setSavedAssignments(loaded.planning);
    setQualityScore(loaded.planning.length > 0 ? 100 : null);
    setDistributionRate(null);
    setDiagnostics([]);
    setManualEdit(false);
  };

  const loadWorkspace = async (tournamentId: string) => {
    await adminTournamentPlanningService.prepare(tournamentId);
    const loaded = await adminTournamentPlanningService.get(tournamentId);
    hydrate(loaded);
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
            ["pools_validated", "planning_generated"].includes(item.status),
          ) ?? items[0];
        if (!preferred) return;
        setSelectedId(preferred.id);
        await adminTournamentPlanningService.prepare(preferred.id);
        const loaded = await adminTournamentPlanningService.get(preferred.id);
        if (active) hydrate(loaded);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger le planning.",
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

  const teamById = useMemo(
    () => new Map((workspace?.teams ?? []).map((team) => [team.id, team])),
    [workspace?.teams],
  );
  const matchById = useMemo(
    () => new Map((workspace?.matches ?? []).map((match) => [match.id, match])),
    [workspace?.matches],
  );
  const slotById = useMemo(
    () => new Map((workspace?.slots ?? []).map((slot) => [slot.id, slot])),
    [workspace?.slots],
  );
  const availabilityByTeam = useMemo(
    () =>
      new Map(
        (workspace?.availability ?? []).map((team) => [
          team.teamId,
          new Set(team.slots.map(slotAvailabilityKey)),
        ]),
      ),
    [workspace?.availability],
  );

  const dirty = signature(assignments) !== signature(savedAssignments);
  const complete =
    (workspace?.matches.length ?? 0) > 0 &&
    assignments.length === workspace?.matches.length;

  const compatibleSlots = (match: PlanningMatch): PlanningSlot[] => {
    if (!workspace) return [];
    const teamA = availabilityByTeam.get(match.teamAId) ?? new Set<string>();
    const teamB = availabilityByTeam.get(match.teamBId) ?? new Set<string>();
    return workspace.slots.filter((slot) => {
      const key = slotAvailabilityKey(slot);
      return teamA.has(key) && teamB.has(key);
    });
  };

  const scheduledRows = useMemo(
    () =>
      assignments
        .map((assignment) => ({
          assignment,
          match: matchById.get(assignment.matchId),
          slot: slotById.get(assignment.slotId),
        }))
        .filter(
          (
            row,
          ): row is {
            assignment: PlanningAssignment;
            match: PlanningMatch;
            slot: PlanningSlot;
          } => Boolean(row.match && row.slot),
        )
        .sort((left, right) =>
          `${left.slot.date}|${left.slot.startsAt}|${left.slot.resourceName}`.localeCompare(
            `${right.slot.date}|${right.slot.startsAt}|${right.slot.resourceName}`,
          ),
        ),
    [assignments, matchById, slotById],
  );

  const chooseTournament = async (id: string) => {
    setSelectedId(id);
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await loadWorkspace(id);
    } catch (loadError) {
      setWorkspace(null);
      setAssignments([]);
      setSavedAssignments([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger le planning.",
      );
    } finally {
      setLoading(false);
    }
  };

  const generate = () => {
    if (!workspace) return;
    setError("");
    setMessage("");
    const proposal = generatePlanningProposal({
      matches: workspace.matches,
      slots: workspace.slots,
      availability: workspace.availability,
      minimumRestMinutes: workspace.tournament.minimumRestMinutes,
      iterations: 500,
    });
    setAssignments(proposal.assignments);
    setQualityScore(proposal.quality.score);
    setDistributionRate(proposal.quality.distributionRate);
    setDiagnostics(proposal.diagnostics.map((item) => item.message));
    setManualEdit(false);
    if (proposal.unscheduledMatchIds.length === 0) {
      setMessage(
        `Proposition complète : ${proposal.quality.scheduledMatches} matchs planifiés, qualité ${proposal.quality.score}/100.`,
      );
    } else {
      setError(
        `${proposal.unscheduledMatchIds.length} rencontre(s) restent impossibles à placer. Consultez les diagnostics.`,
      );
    }
  };

  const changeMatchSlot = (match: PlanningMatch, slotId: string) => {
    if (!workspace) return;
    const next = [
      ...assignments.filter((assignment) => assignment.matchId !== match.id),
      ...(slotId ? [{ matchId: match.id, slotId }] : []),
    ];
    const validation = validatePlanning({
      matches: workspace.matches,
      slots: workspace.slots,
      availability: workspace.availability,
      assignments: next,
      minimumRestMinutes: workspace.tournament.minimumRestMinutes,
    });
    if (!validation.valid) {
      setError(validation.diagnostics[0]?.message ?? "Déplacement impossible.");
      return;
    }
    setAssignments(next);
    setManualEdit(true);
    setQualityScore(null);
    setDistributionRate(null);
    setDiagnostics([]);
    setError("");
    setMessage("Modification locale valide. Enregistrez pour la conserver.");
  };

  const save = async () => {
    if (!workspace || !complete) return;
    const validation = validatePlanning({
      matches: workspace.matches,
      slots: workspace.slots,
      availability: workspace.availability,
      assignments,
      minimumRestMinutes: workspace.tournament.minimumRestMinutes,
    });
    if (!validation.valid) {
      setError(validation.diagnostics[0]?.message ?? "Le planning est invalide.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentPlanningService.save(
        workspace.tournament.id,
        assignments,
        workspace.slots,
        manualEdit ? "manual" : "generated",
      );
      const [items, loaded] = await Promise.all([
        tournamentAdminService.list(),
        adminTournamentPlanningService.get(workspace.tournament.id),
      ]);
      setTournaments(items);
      hydrate(loaded);
      setMessage("Planning enregistré. Le tournoi est maintenant à l’état Planning généré.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d’enregistrer le planning.",
      );
    } finally {
      setSaving(false);
    }
  };

  const teamName = (teamId: string) => teamById.get(teamId)?.label ?? "Équipe";

  return (
    <section className="admin-page admin-tournament-planning">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Planning</h1>
          <p className="admin-page__lead">
            Le moteur place toutes les rencontres des poules validées sur les
            terrains et créneaux du tournoi, uniquement dans les disponibilités
            communes. L’administrateur peut ensuite déplacer chaque match.
          </p>
        </div>
      </header>

      {error && <p className="admin-tournament-planning__alert admin-tournament-planning__alert--error">{error}</p>}
      {message && <p className="admin-tournament-planning__alert">{message}</p>}

      <div className="admin-card admin-tournament-planning__toolbar">
        <label>
          Tournoi
          <select
            disabled={loading || saving}
            value={selectedId}
            onChange={(event) => void chooseTournament(event.target.value)}
          >
            <option value="">Choisir un tournoi</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name} · {statusLabels[tournament.status] ?? tournament.status}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-tournament-planning__toolbar-actions">
          <button type="button" disabled={!workspace || saving} onClick={generate}>
            {assignments.length > 0 ? "Rechercher une meilleure proposition" : "Générer le planning"}
          </button>
          <button
            className="admin-tournament-planning__primary"
            type="button"
            disabled={!workspace || saving || !complete || (!dirty && workspace.tournament.status === "planning_generated")}
            onClick={() => void save()}
          >
            {saving ? "Enregistrement…" : "Enregistrer le planning"}
          </button>
        </div>
      </div>

      {loading && <div className="admin-card">Chargement du Planning Engine…</div>}

      {workspace && !loading && (
        <>
          <div className="admin-tournament-planning__metrics">
            <article className="admin-card">
              <span>Rencontres</span>
              <strong>{workspace.matches.length}</strong>
            </article>
            <article className="admin-card">
              <span>Planifiées</span>
              <strong>{assignments.length}/{workspace.matches.length}</strong>
            </article>
            <article className="admin-card">
              <span>Qualité</span>
              <strong>{qualityScore === null ? "—" : `${qualityScore}/100`}</strong>
            </article>
            <article className="admin-card">
              <span>Répartition</span>
              <strong>{distributionRate === null ? "—" : `${distributionRate}%`}</strong>
            </article>
          </div>

          {diagnostics.length > 0 && (
            <div className="admin-card admin-tournament-planning__diagnostics">
              <h2>Diagnostics</h2>
              <ul>
                {diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic}-${index}`}>{diagnostic}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="admin-card admin-tournament-planning__matches">
            <header>
              <div>
                <h2>Rencontres & affectations</h2>
                <p>
                  Chaque changement est contrôlé immédiatement. Un même terrain
                  ne peut accueillir qu’un match à la fois et une équipe ne peut
                  pas être programmée deux fois au même horaire.
                </p>
              </div>
            </header>
            <div className="admin-tournament-planning__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rencontre</th>
                    <th>Créneau</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.matches.map((match) => {
                    const current = assignments.find(
                      (assignment) => assignment.matchId === match.id,
                    );
                    return (
                      <tr key={match.id}>
                        <td>
                          <strong>{teamName(match.teamAId)}</strong>
                          <span> vs </span>
                          <strong>{teamName(match.teamBId)}</strong>
                        </td>
                        <td>
                          <select
                            disabled={saving}
                            value={current?.slotId ?? ""}
                            onChange={(event) =>
                              changeMatchSlot(match, event.target.value)
                            }
                          >
                            <option value="">Non planifié</option>
                            {compatibleSlots(match).map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {formatDate(slot.date)} · {formatTime(slot.startsAt)} · {slot.resourceName}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {scheduledRows.length > 0 && (
            <div className="admin-card admin-tournament-planning__agenda">
              <h2>Vue chronologique</h2>
              <div className="admin-tournament-planning__agenda-list">
                {scheduledRows.map(({ assignment, match, slot }) => (
                  <article key={assignment.matchId}>
                    <time>{formatDate(slot.date)} · {formatTime(slot.startsAt)}</time>
                    <strong>{teamName(match.teamAId)} — {teamName(match.teamBId)}</strong>
                    <span>{slot.resourceName}</span>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
