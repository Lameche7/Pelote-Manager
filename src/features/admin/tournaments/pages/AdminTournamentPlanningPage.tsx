import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  adminTournamentPlanningService,
  type TournamentPlanningSeries,
  type TournamentPlanningWorkspace,
} from "@/features/admin/tournaments/services/adminTournamentPlanningService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import {
  addDaysIso,
  buildMonthGridDays,
  buildTournamentWeeks,
  buildWeekDays,
  firstDayOfMonthIso,
  isIsoDateBetween,
  shiftMonthIso,
} from "@/features/tournaments/domain/planningCalendar";
import {
  generatePlanningProposal,
  validatePlanning,
  type PlanningAssignment,
  type PlanningMatch,
  type PlanningSlot,
} from "@/features/tournaments/domain/planningEngine";
import "./AdminTournamentPlanningPage.css";

const statusLabels: Record<string, string> = {
  pools_validated: "Poules validées",
  planning_generated: "Planning généré",
};

const editablePlanningStatuses = new Set([
  "pools_validated",
  "planning_generated",
]);

type CalendarView = "week" | "month" | "tournament";

type ScheduledCalendarRow = {
  assignment: PlanningAssignment;
  match: PlanningMatch;
  slot: PlanningSlot;
  series: TournamentPlanningSeries | undefined;
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

const formatDateLong = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));

const formatMonth = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));

const signature = (assignments: PlanningAssignment[]) =>
  JSON.stringify(
    [...assignments]
      .sort((left, right) => left.matchId.localeCompare(right.matchId))
      .map((assignment) => [assignment.matchId, assignment.slotId]),
  );

const contrastText = (hexColor: string) => {
  const value = hexColor.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) return "#ffffff";
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 155 ? "#111827" : "#ffffff";
};

const eventStyle = (color: string): CSSProperties => ({
  backgroundColor: color,
  color: contrastText(color),
});

export function AdminTournamentPlanningPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] =
    useState<TournamentPlanningWorkspace | null>(null);
  const [assignments, setAssignments] = useState<PlanningAssignment[]>([]);
  const [savedAssignments, setSavedAssignments] = useState<
    PlanningAssignment[]
  >([]);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [distributionRate, setDistributionRate] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [manualEdit, setManualEdit] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [seriesColors, setSeriesColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const hydrate = (loaded: TournamentPlanningWorkspace) => {
    setWorkspace(loaded);
    setAssignments(loaded.planning);
    setSavedAssignments(loaded.planning);
    setQualityScore(null);
    setDistributionRate(null);
    setDiagnostics([]);
    setManualEdit(false);
    setSelectedMatchId(null);
    setAnchorDate(loaded.tournament.poolStartsOn || loaded.tournament.startsOn);
    setSeriesColors(
      Object.fromEntries(loaded.series.map((series) => [series.id, series.color])),
    );
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
        const eligible = items.filter((item) =>
          editablePlanningStatuses.has(item.status),
        );
        setTournaments(eligible);
        const preferred =
          eligible.find((item) => item.status === "planning_generated") ??
          eligible[0];
        if (!preferred) {
          setMessage(
            "Aucun tournoi n’est encore prêt pour le Planning Engine. Validez d’abord les poules.",
          );
          return;
        }
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
  const seriesById = useMemo(
    () => new Map((workspace?.series ?? []).map((series) => [series.id, series])),
    [workspace?.series],
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
  const colorsDirty =
    workspace?.series.some(
      (series) => seriesColors[series.id] !== series.color,
    ) ?? false;

  const compatibleSlots = (match: PlanningMatch): PlanningSlot[] => {
    if (!workspace) return [];
    const teamA = availabilityByTeam.get(match.teamAId) ?? new Set<string>();
    const teamB = availabilityByTeam.get(match.teamBId) ?? new Set<string>();
    return workspace.slots
      .filter((slot) => {
        const key = slotAvailabilityKey(slot);
        return teamA.has(key) && teamB.has(key);
      })
      .sort((left, right) =>
        `${left.date}|${left.startsAt}|${left.resourceName}`.localeCompare(
          `${right.date}|${right.startsAt}|${right.resourceName}`,
        ),
      );
  };

  const scheduledRows = useMemo<ScheduledCalendarRow[]>(
    () =>
      assignments
        .map((assignment) => {
          const match = matchById.get(assignment.matchId);
          const slot = slotById.get(assignment.slotId);
          if (!match || !slot) return null;
          return {
            assignment,
            match,
            slot,
            series: seriesById.get(match.seriesId),
          };
        })
        .filter((row): row is ScheduledCalendarRow => row !== null)
        .sort((left, right) =>
          `${left.slot.date}|${left.slot.startsAt}|${left.slot.resourceName}`.localeCompare(
            `${right.slot.date}|${right.slot.startsAt}|${right.slot.resourceName}`,
          ),
        ),
    [assignments, matchById, seriesById, slotById],
  );

  const visibleRows = useMemo(
    () =>
      scheduledRows.filter(
        (row) =>
          (seriesFilter === "all" || row.match.seriesId === seriesFilter) &&
          (resourceFilter === "all" ||
            row.slot.resourceId === resourceFilter),
      ),
    [resourceFilter, scheduledRows, seriesFilter],
  );

  const weekDays = useMemo(
    () => (anchorDate ? buildWeekDays(anchorDate) : []),
    [anchorDate],
  );
  const monthDays = useMemo(
    () => (anchorDate ? buildMonthGridDays(anchorDate) : []),
    [anchorDate],
  );
  const tournamentWeeks = useMemo(
    () =>
      workspace
        ? buildTournamentWeeks(
            workspace.tournament.startsOn,
            workspace.tournament.endsOn,
          )
        : [],
    [workspace],
  );

  const weekTimes = useMemo(() => {
    if (!workspace || weekDays.length === 0) return [];
    const dates = new Set(weekDays);
    return [...new Set(
      workspace.slots
        .filter((slot) => dates.has(slot.date))
        .map((slot) => slot.startsAt),
    )].sort();
  }, [weekDays, workspace]);

  const availableWeekCells = useMemo(() => {
    if (!workspace) return new Set<string>();
    return new Set(
      workspace.slots.map((slot) => `${slot.date}|${slot.startsAt}`),
    );
  }, [workspace]);

  const selectedMatch = selectedMatchId
    ? matchById.get(selectedMatchId) ?? null
    : null;
  const selectedAssignment = selectedMatch
    ? assignments.find((assignment) => assignment.matchId === selectedMatch.id)
    : undefined;
  const selectedSlot = selectedAssignment
    ? slotById.get(selectedAssignment.slotId)
    : undefined;

  const teamName = (teamId: string) => teamById.get(teamId)?.label ?? "Équipe";
  const seriesColor = (seriesId: string) =>
    seriesColors[seriesId] ?? seriesById.get(seriesId)?.color ?? "#2563EB";

  const chooseTournament = async (id: string) => {
    if (!id) return;
    setSelectedId(id);
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await loadWorkspace(id);
      setSeriesFilter("all");
      setResourceFilter("all");
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
    setSelectedMatchId(null);
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
      setError(
        validation.diagnostics[0]?.message ?? "Le planning est invalide.",
      );
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
      const items = await tournamentAdminService.list();
      setTournaments(
        items.filter((item) => editablePlanningStatuses.has(item.status)),
      );
      setSavedAssignments(assignments);
      setManualEdit(false);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              tournament: {
                ...current.tournament,
                status: "planning_generated",
              },
              planning: assignments,
            }
          : current,
      );
      setMessage(
        "Planning enregistré. Le tournoi est maintenant à l’état Planning généré.",
      );
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

  const saveColors = async () => {
    if (!workspace || !colorsDirty) return;
    setSavingColors(true);
    setError("");
    try {
      await adminTournamentPlanningService.saveSeriesColors(
        workspace.tournament.id,
        workspace.series.map((series) => ({
          id: series.id,
          color: seriesColor(series.id),
        })),
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              series: current.series.map((series) => ({
                ...series,
                color: seriesColor(series.id),
              })),
            }
          : current,
      );
      setMessage("Couleurs des séries enregistrées.");
    } catch (colorError) {
      setError(
        colorError instanceof Error
          ? colorError.message
          : "Impossible d’enregistrer les couleurs.",
      );
    } finally {
      setSavingColors(false);
    }
  };

  const movePeriod = (direction: -1 | 1) => {
    if (!anchorDate) return;
    if (calendarView === "week") {
      setAnchorDate(addDaysIso(anchorDate, direction * 7));
      return;
    }
    if (calendarView === "month") {
      setAnchorDate(shiftMonthIso(anchorDate, direction));
    }
  };

  const periodLabel = (() => {
    if (!workspace || !anchorDate) return "";
    if (calendarView === "week" && weekDays.length === 7) {
      return `${formatDate(weekDays[0])} → ${formatDate(weekDays[6])}`;
    }
    if (calendarView === "month") return formatMonth(anchorDate);
    return `${formatDate(workspace.tournament.startsOn)} → ${formatDate(workspace.tournament.endsOn)}`;
  })();

  const rowsForDay = (date: string) =>
    visibleRows.filter((row) => row.slot.date === date);

  const renderEvent = (row: ScheduledCalendarRow, compact = false) => (
    <button
      className={`planning-event${compact ? " planning-event--compact" : ""}${selectedMatchId === row.match.id ? " planning-event--selected" : ""}`}
      key={row.assignment.matchId}
      style={eventStyle(seriesColor(row.match.seriesId))}
      type="button"
      title={`${teamName(row.match.teamAId)} — ${teamName(row.match.teamBId)} · ${row.slot.resourceName}`}
      onClick={() => setSelectedMatchId(row.match.id)}
    >
      <span className="planning-event__series">
        {row.series?.name ?? "Série"}
      </span>
      <strong>
        {teamName(row.match.teamAId)} — {teamName(row.match.teamBId)}
      </strong>
      <small>
        {formatTime(row.slot.startsAt)} · {row.slot.resourceName}
      </small>
    </button>
  );

  return (
    <section className="admin-page admin-tournament-planning">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Planning</h1>
          <p className="admin-page__lead">
            Générez le planning puis travaillez-le comme un vrai calendrier.
            Cliquez sur un match pour le déplacer ; les conflits et les
            disponibilités restent contrôlés par le Planning Engine.
          </p>
        </div>
      </header>

      {error && (
        <p className="admin-tournament-planning__alert admin-tournament-planning__alert--error">
          {error}
        </p>
      )}
      {message && <p className="admin-tournament-planning__alert">{message}</p>}

      <div className="admin-card admin-tournament-planning__toolbar">
        <label className="admin-tournament-planning__tournament-select">
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
          <button
            type="button"
            disabled={!workspace || saving}
            onClick={generate}
          >
            {assignments.length > 0
              ? "Rechercher une meilleure proposition"
              : "Générer le planning"}
          </button>
          <button
            className="admin-tournament-planning__primary"
            type="button"
            disabled={
              !workspace ||
              saving ||
              !complete ||
              (!dirty && workspace.tournament.status === "planning_generated")
            }
            onClick={() => void save()}
          >
            {saving ? "Enregistrement…" : "Enregistrer le planning"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="admin-card">Chargement du Planning Engine…</div>
      )}

      {workspace && !loading && (
        <>
          <div className="admin-tournament-planning__metrics">
            <article className="admin-card">
              <span>Rencontres</span>
              <strong>{workspace.matches.length}</strong>
            </article>
            <article className="admin-card">
              <span>Planifiées</span>
              <strong>
                {assignments.length}/{workspace.matches.length}
              </strong>
            </article>
            <article className="admin-card">
              <span>Qualité moteur</span>
              <strong>
                {qualityScore === null ? "—" : `${qualityScore}/100`}
              </strong>
            </article>
            <article className="admin-card">
              <span>Répartition</span>
              <strong>
                {distributionRate === null ? "—" : `${distributionRate}%`}
              </strong>
            </article>
          </div>

          <section className="admin-card planning-series-colors">
            <header>
              <div>
                <h2>Couleurs des séries</h2>
                <p>
                  Elles sont enregistrées sur les séries du tournoi et serviront
                  de code couleur commun au planning et aux futurs écrans.
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
            <div className="planning-series-colors__list">
              {workspace.series.map((series) => (
                <label key={series.id}>
                  <input
                    type="color"
                    value={seriesColor(series.id)}
                    onChange={(event) =>
                      setSeriesColors((current) => ({
                        ...current,
                        [series.id]: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                  <span
                    className="planning-series-colors__swatch"
                    style={{ backgroundColor: seriesColor(series.id) }}
                  />
                  <strong>{series.name}</strong>
                </label>
              ))}
            </div>
          </section>

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

          <section className="admin-card planning-calendar-shell">
            <header className="planning-calendar-shell__header">
              <div>
                <h2>Calendrier du tournoi</h2>
                <p>{periodLabel}</p>
              </div>
              <div className="planning-calendar-shell__views" role="group" aria-label="Vue du planning">
                <button
                  className={calendarView === "week" ? "is-active" : ""}
                  type="button"
                  onClick={() => setCalendarView("week")}
                >
                  Semaine
                </button>
                <button
                  className={calendarView === "month" ? "is-active" : ""}
                  type="button"
                  onClick={() => {
                    setCalendarView("month");
                    setAnchorDate(firstDayOfMonthIso(anchorDate));
                  }}
                >
                  Mois
                </button>
                <button
                  className={calendarView === "tournament" ? "is-active" : ""}
                  type="button"
                  onClick={() => setCalendarView("tournament")}
                >
                  Tournoi complet
                </button>
              </div>
            </header>

            <div className="planning-calendar-shell__controls">
              <div className="planning-calendar-shell__navigation">
                {calendarView !== "tournament" && (
                  <>
                    <button type="button" onClick={() => movePeriod(-1)}>
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAnchorDate(workspace.tournament.poolStartsOn)
                      }
                    >
                      Début du tournoi
                    </button>
                    <button type="button" onClick={() => movePeriod(1)}>
                      →
                    </button>
                  </>
                )}
              </div>
              <div className="planning-calendar-shell__filters">
                <label>
                  Série
                  <select
                    value={seriesFilter}
                    onChange={(event) => setSeriesFilter(event.target.value)}
                  >
                    <option value="all">Toutes</option>
                    {workspace.series.map((series) => (
                      <option key={series.id} value={series.id}>
                        {series.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Terrain
                  <select
                    value={resourceFilter}
                    onChange={(event) => setResourceFilter(event.target.value)}
                  >
                    <option value="all">Tous</option>
                    {workspace.resources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="planning-calendar-legend">
              {workspace.series.map((series) => (
                <span key={series.id}>
                  <i style={{ backgroundColor: seriesColor(series.id) }} />
                  {series.name}
                </span>
              ))}
            </div>

            {calendarView === "week" && (
              <div className="planning-week-scroll">
                <div className="planning-week">
                  <div className="planning-week__header planning-week__time-heading">
                    Heure
                  </div>
                  {weekDays.map((date) => (
                    <div className="planning-week__header" key={date}>
                      <strong>{formatDateLong(date)}</strong>
                    </div>
                  ))}
                  {weekTimes.length === 0 && (
                    <div className="planning-week__empty">
                      Aucun créneau configuré sur cette semaine.
                    </div>
                  )}
                  {weekTimes.map((time) => (
                    <div className="planning-week__row" key={time}>
                      <div className="planning-week__time">
                        {formatTime(time)}
                      </div>
                      {weekDays.map((date) => {
                        const events = visibleRows.filter(
                          (row) =>
                            row.slot.date === date && row.slot.startsAt === time,
                        );
                        const available = availableWeekCells.has(`${date}|${time}`);
                        return (
                          <div
                            className={`planning-week__cell${available ? " is-open" : " is-closed"}`}
                            key={`${date}-${time}`}
                          >
                            {events.map((row) => renderEvent(row))}
                            {events.length === 0 && available && (
                              <span className="planning-week__available">Créneau libre</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {calendarView === "month" && (
              <div className="planning-month-scroll">
                <div className="planning-month">
                  {[
                    "Lun",
                    "Mar",
                    "Mer",
                    "Jeu",
                    "Ven",
                    "Sam",
                    "Dim",
                  ].map((day) => (
                    <div className="planning-month__weekday" key={day}>
                      {day}
                    </div>
                  ))}
                  {monthDays.map((date) => {
                    const dayRows = rowsForDay(date);
                    const currentMonth = date.slice(0, 7) === anchorDate.slice(0, 7);
                    return (
                      <div
                        className={`planning-month__day${currentMonth ? "" : " is-outside"}`}
                        key={date}
                      >
                        <header>
                          <strong>{Number(date.slice(-2))}</strong>
                          {dayRows.length > 0 && <span>{dayRows.length} match{dayRows.length > 1 ? "s" : ""}</span>}
                        </header>
                        <div className="planning-month__events">
                          {dayRows.slice(0, 5).map((row) => renderEvent(row, true))}
                          {dayRows.length > 5 && (
                            <span className="planning-calendar__more">
                              + {dayRows.length - 5} autre{dayRows.length - 5 > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {calendarView === "tournament" && (
              <div className="planning-tournament-view">
                {tournamentWeeks.map((week, weekIndex) => (
                  <section className="planning-tournament-week" key={week.start}>
                    <header>
                      <strong>Semaine {weekIndex + 1}</strong>
                      <span>
                        {formatDate(week.start)} → {formatDate(week.end)}
                      </span>
                    </header>
                    <div className="planning-tournament-week__days">
                      {week.days.map((date) => {
                        const dayRows = rowsForDay(date);
                        const inTournament = isIsoDateBetween(
                          date,
                          workspace.tournament.startsOn,
                          workspace.tournament.endsOn,
                        );
                        return (
                          <div
                            className={`planning-tournament-day${inTournament ? "" : " is-outside"}`}
                            key={date}
                          >
                            <header>
                              <strong>{formatDate(date)}</strong>
                              <span>{dayRows.length}</span>
                            </header>
                            <div>
                              {dayRows.slice(0, 6).map((row) => renderEvent(row, true))}
                              {dayRows.length > 6 && (
                                <span className="planning-calendar__more">
                                  + {dayRows.length - 6} autre{dayRows.length - 6 > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>

          {selectedMatch && (
            <aside className="admin-card planning-match-editor">
              <header>
                <div>
                  <p className="admin-page__eyebrow">
                    {seriesById.get(selectedMatch.seriesId)?.name ?? "Série"}
                  </p>
                  <h2>
                    {teamName(selectedMatch.teamAId)} — {teamName(selectedMatch.teamBId)}
                  </h2>
                  <p>
                    {selectedSlot
                      ? `${formatDateLong(selectedSlot.date)} · ${formatTime(selectedSlot.startsAt)} · ${selectedSlot.resourceName}`
                      : "Cette rencontre n’est pas encore planifiée."}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Fermer l’éditeur du match"
                  onClick={() => setSelectedMatchId(null)}
                >
                  ×
                </button>
              </header>
              <label>
                Déplacer vers un créneau compatible
                <select
                  disabled={saving}
                  value={selectedAssignment?.slotId ?? ""}
                  onChange={(event) =>
                    changeMatchSlot(selectedMatch, event.target.value)
                  }
                >
                  <option value="">Non planifié</option>
                  {compatibleSlots(selectedMatch).map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {formatDateLong(slot.date)} · {formatTime(slot.startsAt)} · {slot.resourceName}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Un déplacement impossible est refusé immédiatement : terrain
                occupé, équipe déjà en match ou disponibilité non respectée.
              </p>
            </aside>
          )}
        </>
      )}
    </section>
  );
}
