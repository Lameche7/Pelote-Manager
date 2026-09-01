export type ErrebotAvailabilityPhase = "pools" | "finals";

export type ErrebotAvailabilitySourceSlot = {
  phase: ErrebotAvailabilityPhase;
  playDate: string;
  startsAt: string;
  endsAt: string;
  sourceSlotId: string | null;
};

export type ErrebotAvailabilityImportRow = {
  externalTeamId: string;
  phase: ErrebotAvailabilityPhase;
  playDate: string;
  startsAt: string;
  endsAt: string;
};

export type ErrebotAvailabilityDeclaration = {
  externalTeamId: string;
  phase: ErrebotAvailabilityPhase;
  slotCount: number;
};

export type ErrebotAvailabilityImportIssue = {
  row: number;
  sheet?: string;
  message: string;
};

export type ErrebotAvailabilitySheetSummary = {
  sheet: string;
  phase: ErrebotAvailabilityPhase;
  teamCount: number;
  slotCount: number;
};

export type ErrebotAvailabilityImportParseResult = {
  rows: ErrebotAvailabilityImportRow[];
  declarations: ErrebotAvailabilityDeclaration[];
  sourceSlots: ErrebotAvailabilitySourceSlot[];
  issues: ErrebotAvailabilityImportIssue[];
  sheets: ErrebotAvailabilitySheetSummary[];
};

export type ErrebotAvailabilityWorkbookSheet = {
  sheet: string;
  data: unknown[][];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const TEAM_HEADERS = new Set([
  "id equipe",
  "equipe",
  "numero equipe",
  "no equipe",
  "n equipe",
  "team",
  "team id",
]);

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, " ").trim();
};

const phaseForSheet = (sheet: string): ErrebotAvailabilityPhase | null => {
  const normalized = fold(sheet);
  if (normalized.includes("poule")) return "pools";
  if (normalized.includes("final")) return "finals";
  return null;
};

const normalizeTime = (hours: number, minutes: number) => {
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const addMinutes = (value: string, minutesToAdd: number) => {
  const [hours, minutes] = value.split(":").map(Number);
  const total = hours * 60 + minutes + minutesToAdd;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const parseSlotHeader = (value: unknown, slotDurationMinutes: number) => {
  const clean = cellText(value);
  const match = clean.match(
    /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s+(\d{1,2})\s*(?:h|:)\s*(\d{2})(?:\s*\((\d+)\))?/i,
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const startsAt = normalizeTime(Number(match[4]), Number(match[5]));
  if (!startsAt || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  const endsAt = addMinutes(startsAt, slotDurationMinutes);
  if (!endsAt) return null;

  return {
    playDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startsAt,
    endsAt,
    sourceSlotId: match[6] ?? null,
  };
};

const selectedAvailability = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const clean = fold(cellText(value));
  if (!clean) return false;
  if (
    clean === "0" ||
    clean === "non" ||
    clean === "no" ||
    clean === "false" ||
    clean === "indisponible" ||
    clean === "pas disponible"
  ) {
    return false;
  }

  // Errebot matérialise la disponibilité par une valeur dans la cellule. On
  // accepte X, 1, Oui, V, une coche ou tout autre marqueur non vide, tout en
  // traitant explicitement les valeurs négatives ci-dessus.
  return true;
};

const externalTeamId = (value: unknown) =>
  cellText(value).match(/\d+/)?.[0] ?? "";

const findHeaderRow = (data: unknown[][], slotDurationMinutes: number) => {
  const maximum = Math.min(data.length, 20);
  for (let rowIndex = 0; rowIndex < maximum; rowIndex += 1) {
    const row = data[rowIndex] ?? [];
    const teamColumn = row.findIndex((value) =>
      TEAM_HEADERS.has(fold(cellText(value))),
    );
    const slotColumns = row
      .map((value, column) => ({
        column,
        slot: parseSlotHeader(value, slotDurationMinutes),
      }))
      .filter(
        (
          item,
        ): item is {
          column: number;
          slot: NonNullable<ReturnType<typeof parseSlotHeader>>;
        } => item.slot !== null,
      );
    if (teamColumn >= 0 && slotColumns.length > 0) {
      return { rowIndex, teamColumn, slotColumns };
    }
  }
  return null;
};

export const parseErrebotAvailabilityWorkbook = (
  workbook: ErrebotAvailabilityWorkbookSheet[],
  slotDurationMinutes: number,
  finalsRequired = true,
): ErrebotAvailabilityImportParseResult => {
  const rows: ErrebotAvailabilityImportRow[] = [];
  const declarations: ErrebotAvailabilityDeclaration[] = [];
  const sourceSlots: ErrebotAvailabilitySourceSlot[] = [];
  const issues: ErrebotAvailabilityImportIssue[] = [];
  const sheets: ErrebotAvailabilitySheetSummary[] = [];
  const seenRows = new Set<string>();
  const seenDeclarations = new Set<string>();
  const seenSourceSlots = new Set<string>();
  const detectedPhases = new Set<ErrebotAvailabilityPhase>();

  for (const workbookSheet of workbook) {
    const phase = phaseForSheet(workbookSheet.sheet);
    if (!phase) continue;
    detectedPhases.add(phase);

    const header = findHeaderRow(workbookSheet.data, slotDurationMinutes);
    if (!header) {
      issues.push({
        row: 0,
        sheet: workbookSheet.sheet,
        message:
          "Impossible de trouver la colonne « ID équipe » et les colonnes de créneaux datés.",
      });
      continue;
    }

    for (const item of header.slotColumns) {
      const key = `${phase}|${item.slot.playDate}|${item.slot.startsAt}|${item.slot.endsAt}`;
      if (seenSourceSlots.has(key)) continue;
      seenSourceSlots.add(key);
      sourceSlots.push({
        phase,
        playDate: item.slot.playDate,
        startsAt: item.slot.startsAt,
        endsAt: item.slot.endsAt,
        sourceSlotId: item.slot.sourceSlotId,
      });
    }

    let teamCount = 0;
    let slotCount = 0;

    workbookSheet.data
      .slice(header.rowIndex + 1)
      .forEach((sheetRow, offset) => {
        const rowNumber = header.rowIndex + offset + 2;
        const teamId = externalTeamId(sheetRow?.[header.teamColumn]);
        if (!teamId) return;

        const declarationKey = `${teamId}|${phase}`;
        if (seenDeclarations.has(declarationKey)) {
          issues.push({
            row: rowNumber,
            sheet: workbookSheet.sheet,
            message: `L’équipe Errebot ${teamId} apparaît plusieurs fois dans cet onglet.`,
          });
          return;
        }
        seenDeclarations.add(declarationKey);
        teamCount += 1;

        let selectedSlotCount = 0;
        for (const item of header.slotColumns) {
          if (!selectedAvailability(sheetRow?.[item.column])) continue;

          const key = `${teamId}|${phase}|${item.slot.playDate}|${item.slot.startsAt}|${item.slot.endsAt}`;
          if (seenRows.has(key)) continue;
          seenRows.add(key);
          selectedSlotCount += 1;
          slotCount += 1;
          rows.push({
            externalTeamId: teamId,
            phase,
            playDate: item.slot.playDate,
            startsAt: item.slot.startsAt,
            endsAt: item.slot.endsAt,
          });
        }

        declarations.push({
          externalTeamId: teamId,
          phase,
          slotCount: selectedSlotCount,
        });
      });

    sheets.push({
      sheet: workbookSheet.sheet,
      phase,
      teamCount,
      slotCount,
    });
  }

  if (!detectedPhases.has("pools")) {
    issues.push({
      row: 0,
      message: "Aucun onglet de poules Errebot n’a été reconnu.",
    });
  }
  if (finalsRequired && !detectedPhases.has("finals")) {
    issues.push({
      row: 0,
      message: "Aucun onglet de phases finales Errebot n’a été reconnu.",
    });
  }
  if (declarations.length === 0 && issues.length === 0) {
    issues.push({ row: 0, message: "Aucune équipe Errebot n’a été trouvée." });
  }

  return { rows, declarations, sourceSlots, issues, sheets };
};
