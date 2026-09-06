import readExcelFile from "read-excel-file/browser";
import {
  buildChampionshipImportPreview,
  parseChampionshipMatchRows,
  type ChampionshipImportIssue,
  type ChampionshipImportPreview,
} from "@/features/admin/championships/domain/championshipSourceImport";
import type { ChampionshipMatchesFilePreview } from "@/features/admin/championships/domain/championshipMatchUpdate";
import type { ChampionshipImportFileDescriptor } from "@/features/admin/championships/domain/championshipTransactionalImport";

const decodeCsv = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

const parseSemicolonCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ";" && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
};

const firstWorkbookSheet = async (file: File) => {
  const workbook = await readExcelFile(file);
  const sheets = workbook.map((sheet) => ({
    sheet: sheet.sheet,
    data: sheet.data as unknown[][],
  }));
  const first = sheets.find((sheet) => sheet.data.length > 0);
  if (!first)
    throw new Error("Le classeur des parties ne contient aucune donnée.");
  return first.data;
};

const sha256 = async (file: File) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const oneValue = (
  values: string[],
  label: string,
  issues: ChampionshipImportIssue[],
) => {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length === 1) return unique[0];
  issues.push({
    source: "matches",
    row: 0,
    severity: "error",
    message:
      unique.length === 0
        ? `${label} absente du fichier des parties.`
        : `Plusieurs valeurs de ${label.toLowerCase()} ont été détectées.`,
  });
  return null;
};

export const championshipSourceFileService = {
  async parse(
    matchesFile: File,
    engagementsFile: File,
  ): Promise<ChampionshipImportPreview> {
    if (!matchesFile.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Le fichier des parties doit être un classeur .xlsx.");
    }
    if (!engagementsFile.name.toLowerCase().endsWith(".csv")) {
      throw new Error("Le fichier des engagements doit être un fichier .csv.");
    }

    const [matchRows, engagementBuffer] = await Promise.all([
      firstWorkbookSheet(matchesFile),
      engagementsFile.arrayBuffer(),
    ]);
    const engagementRows = parseSemicolonCsv(decodeCsv(engagementBuffer));
    return buildChampionshipImportPreview(matchRows, engagementRows);
  },

  async parseMatches(matchesFile: File): Promise<ChampionshipMatchesFilePreview> {
    if (!matchesFile.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Le fichier des parties doit être un classeur .xlsx.");
    }
    const rows = await firstWorkbookSheet(matchesFile);
    const result = parseChampionshipMatchRows(rows);
    const issues = [...result.issues];
    const competition = oneValue(
      result.rows.map((row) => row.competition),
      "Compétition",
      issues,
    );
    const specialty = oneValue(
      result.rows.map((row) => row.specialty),
      "Spécialité",
      issues,
    );
    return {
      valid: !issues.some((issue) => issue.severity === "error"),
      competition,
      specialty,
      matches: result.rows,
      issues,
    };
  },

  async describe(
    matchesFile: File,
    engagementsFile: File,
    preview: ChampionshipImportPreview,
  ): Promise<ChampionshipImportFileDescriptor[]> {
    const [matchesChecksum, engagementsChecksum] = await Promise.all([
      sha256(matchesFile),
      sha256(engagementsFile),
    ]);
    return [
      {
        kind: "matches",
        fileName: matchesFile.name,
        checksum: matchesChecksum,
        rowCount: preview.matchCount,
      },
      {
        kind: "engagements",
        fileName: engagementsFile.name,
        checksum: engagementsChecksum,
        rowCount: preview.teamCount,
      },
    ];
  },

  async describeMatches(
    matchesFile: File,
    preview: ChampionshipMatchesFilePreview,
  ): Promise<ChampionshipImportFileDescriptor> {
    return {
      kind: "matches",
      fileName: matchesFile.name,
      checksum: await sha256(matchesFile),
      rowCount: preview.matches.length,
    };
  },
};
