import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Printer } from "lucide-react";
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
import { adminTournamentRescheduleService, type AdminTournamentRescheduleRequest } from "@/features/admin/tournaments/services/adminTournamentRescheduleService";
import { tournamentResultsAdminService, type AdminTournamentResultsWorkspace } from "@/features/admin/tournaments/services/tournamentResultsAdminService";
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
  const [printWorkspaces, setPrintWorkspaces] = useState<AdminTournamentResultsWorkspace[]>([]);
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
  const [printing, setPrinting] = useState(false);

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
      Object.fromEntries(
        loaded.series.map((series) => [series.id, series.color]),
      ),
    );
  };

  const loadWorkspace = async (tournamentId: string) => {
    await adminTournamentPlanningService.prepare(tournamentId);
    const loaded = await adminTournamentPlanningService.get(tournamentId);
    hydrate(loaded);
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      tournamentAdminService.list(),
      tournamentResultsAdminService.getWorkspace(),
    ])
      .then(async ([items, printable]) => {
        if (!active) return;
        setPrintWorkspaces(printable);
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

  const selectedPrintWorkspace = useMemo(
    () => printWorkspaces.find((item) => item.id === selectedId) ?? null,
    [printWorkspaces, selectedId],
  );
  const selectableTournaments = useMemo(() => {
    const byId = new Map(tournaments.map((item) => [item.id, item]));
    printWorkspaces.forEach((item) => {
      if (!byId.has(item.id)) {
        byId.set(item.id, {
          id: item.id,
          name: item.name,
          status: item.status as TournamentSummary["status"],
        } as TournamentSummary);
      }
    });
    return [...byId.values()];
  }, [printWorkspaces, tournaments]);

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
    () =>
      new Map((workspace?.series ?? []).map((series) => [series.id, series])),
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
          (resourceFilter === "all" || row.slot.resourceId === resourceFilter),
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
    return [
      ...new Set(
        workspace.slots
          .filter((slot) => dates.has(slot.date))
          .map((slot) => slot.startsAt),
      ),
    ].sort();
  }, [weekDays, workspace]);

  const availableWeekCells = useMemo(() => {
    if (!workspace) return new Set<string>();
    return new Set(
      workspace.slots.map((slot) => `${slot.date}|${slot.startsAt}`),
    );
  }, [workspace]);

  const selectedMatch = selectedMatchId
    ? (matchById.get(selectedMatchId) ?? null)
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
    const engineTournament = tournaments.some((item) => item.id === id);
    if (!engineTournament) {
      setWorkspace(null);
      setAssignments([]);
      setSavedAssignments([]);
      setLoading(false);
      setMessage("Planning existant chargé en lecture seule. Vous pouvez l’imprimer.");
      return;
    }
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


  const printPlanning = async () => {
    const printable = selectedPrintWorkspace;
    if (!printable) {
      setError("Aucun planning publié n’est disponible pour ce tournoi.");
      return;
    }

    setPrinting(true);
    setError("");
    try {
      const requests = await adminTournamentRescheduleService.list(printable.id);
      const activeRequests = requests.filter((request) =>
        request.status === "pending" || request.status === "approved",
      );
      const requestsByMatch = new Map<string, AdminTournamentRescheduleRequest[]>();
      activeRequests.forEach((request) => {
        requestsByMatch.set(request.matchId, [...(requestsByMatch.get(request.matchId) ?? []), request]);
      });

      const date = (value: string) => {
        const [year, month, day] = value.split("-");
        return year && month && day ? `${day}/${month}/${year}` : value;
      };
      const reportLabel = (request: AdminTournamentRescheduleRequest) => {
        const target = `${date(request.target.playDate)} ${request.target.startsAt}`;
        return `${request.proposalKind === "swap" ? "Échange" : "Report"} → ${target}`;
      };
      const matches = [...printable.matches].sort((a, b) =>
        `${a.playDate}|${a.startsAt}|${a.resourceName}`.localeCompare(
          `${b.playDate}|${b.startsAt}|${b.resourceName}`,
        ),
      );

      const pdfText = (value: string) =>
        value
          .replace(/[–—]/g, "-")
          .replace(/[‘’]/g, "'")
          .replace(/œ/g, "oe")
          .replace(/Œ/g, "OE")
          .replace(/…/g, "...")
          .replace(/→/g, "->")
          .replace(/·/g, "-")
          .normalize("NFC")
          .replace(/[^\x20-\xFF]/g, "")
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
      const line = (x: number, y: number, size: number, value: string) =>
        `BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET\n`;
      const fittedLine = (
        x: number,
        y: number,
        width: number,
        value: string,
        preferredSize = 5.8,
        minimumSize = 4.1,
      ) => {
        const estimatedWidth = (text: string, size: number) =>
          [...text].reduce((sum, character) => {
            if (" ilI.,'".includes(character)) return sum + size * 0.25;
            if ("MW@%".includes(character)) return sum + size * 0.8;
            return sum + size * 0.5;
          }, 0);
        const available = Math.max(4, width - 4);
        const naturalWidth = estimatedWidth(value, preferredSize);
        const size =
          naturalWidth <= available
            ? preferredSize
            : Math.max(minimumSize, preferredSize * (available / naturalWidth));
        return line(x, y, size, value);
      };

      const pageWidth = 842;
      const pageHeight = 595;
      const left = 22;
      const top = 555;
      const rowHeight = 12;
      const rowsPerPage = 39;
      const widths = [83, 62, 35, 135, 42, 42, 135, 264];
      const headers = ["Créneau", "Série", "Poule", "Équipe 1", "Score 1", "Score 2", "Équipe 2", "Report en cours"];
      const pages: string[] = [];

      for (let pageStart = 0; pageStart < matches.length; pageStart += rowsPerPage) {
        const pageMatches = matches.slice(pageStart, pageStart + rowsPerPage);
        let stream = "";
        stream += line(left, top + 14, 11, `${printable.name} - Planning des rencontres`);
        const stamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date());
        stream += line(left, top + 2, 6.5, `PDF généré le ${stamp} · ${matches.length} rencontre(s) · ${activeRequests.length} report(s) en cours`);

        let x = left;
        stream += "0.31 0.51 0.74 rg\n";
        stream += `${left} ${top - 14} ${widths.reduce((sum, width) => sum + width, 0)} ${rowHeight} re f\n`;
        headers.forEach((header, index) => {
          stream += "1 1 1 rg\n";
          stream += line(x + 2, top - 10, 6.2, header);
          x += widths[index];
        });

        pageMatches.forEach((match, rowIndex) => {
          const y = top - 14 - (rowIndex + 1) * rowHeight;
          const shade = rowIndex % 2 === 0 ? "0.86 0.90 0.95" : "0.72 0.80 0.89";
          stream += `${shade} rg\n${left} ${y} ${widths.reduce((sum, width) => sum + width, 0)} ${rowHeight} re f\n`;
          const reports = requestsByMatch.get(match.id) ?? [];
          const score = match.result?.score.sets ?? [];
          const values = [
            `${date(match.playDate)} ${match.startsAt}`,
            match.seriesName,
            match.phase === "pools" ? String(match.poolNumber ?? "") : "Finales",
            match.teamALabel,
            score.length ? score.map((set) => set.teamA).join("/") : "",
            score.length ? score.map((set) => set.teamB).join("/") : "",
            match.teamBLabel,
            reports.map(reportLabel).join(" · "),
          ];
          x = left;
          values.forEach((value, index) => {
            stream += "0.09 0.13 0.20 rg\n";
            const minimumSize = index === 3 || index === 6 || index === 7 ? 3.8 : 4.6;
            stream += fittedLine(x + 2, y + 3.5, widths[index], value, 5.8, minimumSize);
            x += widths[index];
          });
        });
        pages.push(stream);
      }

      const objects: string[] = [];
      objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
      const pageObjectIds: number[] = [];
      const contentObjectIds: number[] = [];
      let nextId = 4;
      pages.forEach(() => {
        pageObjectIds.push(nextId++);
        contentObjectIds.push(nextId++);
      });
      objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
      objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
      pages.forEach((stream, index) => {
        objects[pageObjectIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`;
        objects[contentObjectIds[index]] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
      });

      let pdf = "%PDF-1.4\n%âãÏÓ\n";
      const offsets: number[] = [0];
      for (let id = 1; id < objects.length; id += 1) {
        offsets[id] = pdf.length;
        pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
      }
      const xref = pdf.length;
      pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for (let id = 1; id < objects.length; id += 1) {
        pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
      }
      pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

      const bytes = Uint8Array.from(pdf, (character) => character.charCodeAt(0) & 0xff);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `planning-${printable.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournoi"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage("PDF du planning généré.");
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "Impossible de générer le PDF du planning.");
    } finally {
      setPrinting(false);
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
        `Proposition complète : ${proposal.quality.scheduledMatches} parties planifiés, qualité ${proposal.quality.score}/100.`,
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
            {selectableTournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name} ·{" "}
                {statusLabels[tournament.status] ?? tournament.status}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-tournament-planning__toolbar-actions">
          <button
            type="button"
            disabled={!selectedPrintWorkspace || printing || selectedPrintWorkspace.matches.length === 0}
            onClick={() => void printPlanning()}
          >
            <Printer aria-hidden="true" />
            {printing ? "Génération…" : "Générer le PDF"}
          </button>
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
              <div
                className="planning-calendar-shell__views"
                role="group"
                aria-label="Vue du planning"
              >
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
                            row.slot.date === date &&
                            row.slot.startsAt === time,
                        );
                        const available = availableWeekCells.has(
                          `${date}|${time}`,
                        );
                        return (
                          <div
                            className={`planning-week__cell${available ? " is-open" : " is-closed"}`}
                            key={`${date}-${time}`}
                          >
                            {events.map((row) => renderEvent(row))}
                            {events.length === 0 && available && (
                              <span className="planning-week__available">
                                Créneau libre
                              </span>
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
                  {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(
                    (day) => (
                      <div className="planning-month__weekday" key={day}>
                        {day}
                      </div>
                    ),
                  )}
                  {monthDays.map((date) => {
                    const dayRows = rowsForDay(date);
                    const currentMonth =
                      date.slice(0, 7) === anchorDate.slice(0, 7);
                    return (
                      <div
                        className={`planning-month__day${currentMonth ? "" : " is-outside"}`}
                        key={date}
                      >
                        <header>
                          <strong>{Number(date.slice(-2))}</strong>
                          {dayRows.length > 0 && (
                            <span>
                              {dayRows.length} match
                              {dayRows.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </header>
                        <div className="planning-month__events">
                          {dayRows
                            .slice(0, 5)
                            .map((row) => renderEvent(row, true))}
                          {dayRows.length > 5 && (
                            <span className="planning-calendar__more">
                              + {dayRows.length - 5} autre
                              {dayRows.length - 5 > 1 ? "s" : ""}
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
                  <section
                    className="planning-tournament-week"
                    key={week.start}
                  >
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
                              {dayRows.map((row) => renderEvent(row, true))}
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
                    {teamName(selectedMatch.teamAId)} —{" "}
                    {teamName(selectedMatch.teamBId)}
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
                      {formatDateLong(slot.date)} · {formatTime(slot.startsAt)}{" "}
                      · {slot.resourceName}
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
