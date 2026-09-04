import readExcelFile from "read-excel-file/browser";
import {
  buildChampionshipImportPreview,
  type ChampionshipImportPreview,
} from "@/features/admin/championships/domain/championshipSourceImport";

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
  if (!first) throw new Error("Le classeur des parties ne contient aucune donnée.");
  return first.data;
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
};
