import readExcelFile from "read-excel-file/browser";
import {
  buildChampionshipImportPreview,
  parseChampionshipMatchRows,
  type ChampionshipImportPreview,
} from "@/features/admin/championships/domain/championshipSourceImport";
import type {
  ChampionshipMatchesUpdateFileDescriptor,
  ChampionshipMatchesUpdatePreviewFile,
} from "@/features/admin/championships/domain/championshipMatchesUpdate";
import {
  parseChampionshipStandingRows,
  type ChampionshipStandingsFileDescriptor,
  type ChampionshipStandingsPreviewFile,
} from "@/features/admin/championships/domain/championshipStandingsImport";
import type { ChampionshipImportFileDescriptor } from "@/features/admin/championships/domain/championshipTransactionalImport";

const decodeCsv = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

const parseSeparatedCsv = (text: string) => {
  const delimiter = text.split(/\r?\n/u)[0]?.includes(";") ? ";" : ",";
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
    } else if (char === delimiter && !quoted) {
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
  const first = workbook.find((sheet) => sheet.data.length > 0);
  if (!first) throw new Error("Le classeur ne contient aucune donnée.");
  return first.data as unknown[][];
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

const ensureMatchesFile = (file: File) => {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Le fichier des parties doit être un classeur .xlsx.");
  }
};

const standingsRows = async (file: File) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return firstWorkbookSheet(file);
  if (lower.endsWith(".csv")) {
    return parseSeparatedCsv(decodeCsv(await file.arrayBuffer()));
  }
  throw new Error("Le classement officiel doit être un fichier .xlsx ou .csv.");
};

export const championshipSourceFileService = {
  async parse(
    matchesFile: File,
    engagementsFile: File,
  ): Promise<ChampionshipImportPreview> {
    ensureMatchesFile(matchesFile);
    if (!engagementsFile.name.toLowerCase().endsWith(".csv")) {
      throw new Error("Le fichier des engagements doit être un fichier .csv.");
    }

    const [matchRows, engagementBuffer] = await Promise.all([
      firstWorkbookSheet(matchesFile),
      engagementsFile.arrayBuffer(),
    ]);
    const engagementRows = parseSeparatedCsv(decodeCsv(engagementBuffer));
    return buildChampionshipImportPreview(matchRows, engagementRows);
  },

  async parseMatchesUpdate(
    matchesFile: File,
  ): Promise<ChampionshipMatchesUpdatePreviewFile> {
    ensureMatchesFile(matchesFile);
    const matchRows = await firstWorkbookSheet(matchesFile);
    const parsed = parseChampionshipMatchRows(matchRows);
    const first = parsed.rows[0];
    const issues = [...parsed.issues];

    if (!first) {
      issues.push({
        source: "matches",
        row: 0,
        severity: "error",
        message: "Aucune partie n’a été détectée dans le fichier.",
      });
    } else {
      parsed.rows.forEach((match) => {
        if (
          match.competition !== first.competition ||
          match.specialty !== first.specialty
        ) {
          issues.push({
            source: "matches",
            row: match.row,
            severity: "error",
            message:
              "Le fichier contient plusieurs compétitions ou spécialités différentes.",
          });
        }
      });
    }

    return {
      competition: first?.competition ?? null,
      specialty: first?.specialty ?? null,
      matches: parsed.rows,
      issues,
      valid: !issues.some((issue) => issue.severity === "error"),
    };
  },

  async parseStandings(file: File): Promise<ChampionshipStandingsPreviewFile> {
    return parseChampionshipStandingRows(await standingsRows(file));
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

  async describeMatchesUpdate(
    matchesFile: File,
    rowCount: number,
  ): Promise<ChampionshipMatchesUpdateFileDescriptor> {
    return {
      kind: "matches",
      fileName: matchesFile.name,
      checksum: await sha256(matchesFile),
      rowCount,
    };
  },

  async describeStandings(
    file: File,
    rowCount: number,
    sourceUrl: string | null,
  ): Promise<ChampionshipStandingsFileDescriptor> {
    return {
      kind: "standings",
      fileName: file.name,
      checksum: await sha256(file),
      rowCount,
      sourceUrl,
    };
  },
};
