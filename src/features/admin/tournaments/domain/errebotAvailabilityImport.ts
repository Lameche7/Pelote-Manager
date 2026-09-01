export type ErrebotAvailabilityImportRow = {
  externalTeamId: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
};

export type ErrebotAvailabilityImportIssue = {
  row: number;
  message: string;
};

export type ErrebotAvailabilityImportParseResult = {
  rows: ErrebotAvailabilityImportRow[];
  issues: ErrebotAvailabilityImportIssue[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const TEAM_HEADERS = new Set([
  "equipe",
  "numero equipe",
  "no equipe",
  "n equipe",
  "id equipe",
  "team",
  "team id",
]);
const DATE_HEADERS = new Set(["date", "jour", "play date"]);
const START_HEADERS = new Set([
  "heure",
  "horaire",
  "debut",
  "heure debut",
  "starts at",
]);
const END_HEADERS = new Set(["fin", "heure fin", "ends at"]);

const findColumn = (headers: string[], aliases: Set<string>) =>
  headers.findIndex((header) => aliases.has(fold(header)));

const chooseDelimiter = (header: string) => {
  const candidates = [";", "\t", ","];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: header.split(delimiter).length,
    }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
};

const normalizeDate = (value: string) => {
  const clean = value.trim();
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return clean;
  const french = clean.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!french) return null;
  return `${french[3]}-${french[2].padStart(2, "0")}-${french[1].padStart(2, "0")}`;
};

const normalizeTime = (value: string) => {
  const clean = value.trim().toLowerCase().replace("h", ":");
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const addMinutes = (value: string, minutesToAdd: number) => {
  const [hours, minutes] = value.split(":").map(Number);
  const total = hours * 60 + minutes + minutesToAdd;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export const parseErrebotAvailabilityImport = (
  source: string,
  slotDurationMinutes: number,
): ErrebotAvailabilityImportParseResult => {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], issues: [{ row: 0, message: "Le fichier est vide." }] };
  }

  const delimiter = chooseDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((cell) => cell.trim());
  const teamColumn = findColumn(header, TEAM_HEADERS);
  const dateColumn = findColumn(header, DATE_HEADERS);
  const startColumn = findColumn(header, START_HEADERS);
  const endColumn = findColumn(header, END_HEADERS);

  if (teamColumn < 0 || dateColumn < 0 || startColumn < 0) {
    return {
      rows: [],
      issues: [
        {
          row: 1,
          message:
            "En-têtes attendus : N° équipe, Date et Heure. La colonne Fin est facultative.",
        },
      ],
    };
  }

  const rows: ErrebotAvailabilityImportRow[] = [];
  const issues: ErrebotAvailabilityImportIssue[] = [];
  const seen = new Set<string>();

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const cells = line.split(delimiter).map((cell) => cell.trim());
    const externalTeamId = cells[teamColumn]?.match(/\d+/)?.[0] ?? "";
    const playDate = normalizeDate(cells[dateColumn] ?? "");
    const startsAt = normalizeTime(cells[startColumn] ?? "");
    const explicitEnd = endColumn >= 0 ? normalizeTime(cells[endColumn] ?? "") : null;
    const endsAt =
      explicitEnd ?? (startsAt ? addMinutes(startsAt, slotDurationMinutes) : null);

    if (!externalTeamId || !playDate || !startsAt || !endsAt) {
      issues.push({
        row: rowNumber,
        message: "Numéro d’équipe, date ou horaire non reconnu.",
      });
      return;
    }

    const key = `${externalTeamId}|${playDate}|${startsAt}|${endsAt}`;
    if (seen.has(key)) {
      issues.push({ row: rowNumber, message: "Créneau en doublon dans le fichier." });
      return;
    }
    seen.add(key);
    rows.push({ externalTeamId, playDate, startsAt, endsAt });
  });

  return { rows, issues };
};
