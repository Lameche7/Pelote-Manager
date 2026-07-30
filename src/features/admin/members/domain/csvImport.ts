import {
  normalizeGender,
  normalizeIdentity,
  normalizeLicenceNumber,
  parseMemberDate,
  type MemberGender,
} from "./memberRules.js";

export const MEMBER_IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 10_000,
} as const;
export type CsvEncoding = "utf-8" | "windows-1252";
export type CsvSeparator = "," | ";" | "\t";
export type MemberColumn =
  | "licence_number"
  | "last_name"
  | "first_name"
  | "birth_date"
  | "gender"
  | "email"
  | "phone"
  | "ranking";
export type ColumnMapping = Partial<Record<MemberColumn, number>>;
export type ParsedMemberRow = {
  licenceNumber: string;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  gender: MemberGender | null;
  email: string;
  phone: string;
  ranking: string;
};

const aliases: Record<MemberColumn, string[]> = {
  licence_number: [
    "licence",
    "numero licence",
    "n licence",
    "no licence",
    "licence ffpb",
    "licence number",
  ],
  last_name: ["nom", "nom de famille", "last name"],
  first_name: ["prenom", "first name"],
  birth_date: [
    "date de naissance",
    "date naissance",
    "naissance",
    "birth date",
  ],
  gender: ["sexe", "genre", "gender"],
  email: ["e mail", "email", "mail", "courriel"],
  phone: ["telephone", "portable", "mobile"],
  ranking: ["classement", "ranking", "niveau"],
};
const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .toLowerCase();
export function decodeCsv(buffer: ArrayBuffer, forced?: CsvEncoding) {
  const bytes = new Uint8Array(buffer);
  let encoding: CsvEncoding = forced ?? "utf-8";
  if (!forced) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      encoding = "windows-1252";
    }
  }
  try {
    return {
      text: new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(
        bytes,
      ),
      encoding,
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252" as const,
    };
  }
}
export function detectSeparator(text: string): CsvSeparator {
  const line = text.split(/\r?\n/u, 1)[0] ?? "";
  return ([";", ",", "\t"] as CsvSeparator[]).sort(
    (a, b) => line.split(b).length - line.split(a).length,
  )[0];
}
export function parseCsv(
  text: string,
  separator = detectSeparator(text),
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((header, index) => {
    const key = (Object.keys(aliases) as MemberColumn[]).find((k) =>
      aliases[k].includes(normalizeHeader(header)),
    );
    if (key && mapping[key] === undefined) mapping[key] = index;
  });
  return mapping;
}
export function mapMemberRow(
  row: string[],
  mapping: ColumnMapping,
): ParsedMemberRow {
  const get = (key: MemberColumn) =>
    (mapping[key] === undefined ? "" : (row[mapping[key]!] ?? "")).trim();
  return {
    licenceNumber: normalizeLicenceNumber(get("licence_number")),
    lastName: get("last_name"),
    firstName: get("first_name"),
    birthDate: parseMemberDate(get("birth_date")),
    gender: normalizeGender(get("gender")),
    email: get("email"),
    phone: get("phone"),
    ranking: get("ranking"),
  };
}
export function findFileDuplicates(rows: ParsedMemberRow[]): Set<number> {
  const counts = new Map<string, number>();
  rows.forEach((r) =>
    counts.set(r.licenceNumber, (counts.get(r.licenceNumber) ?? 0) + 1),
  );
  return new Set(
    rows.flatMap((r, i) => ((counts.get(r.licenceNumber) ?? 0) > 1 ? [i] : [])),
  );
}
export const sameIdentity = (
  a: ParsedMemberRow,
  b: { lastName: string; firstName: string; birthDate: string | null },
) =>
  normalizeIdentity(a.lastName) === normalizeIdentity(b.lastName) &&
  normalizeIdentity(a.firstName) === normalizeIdentity(b.firstName) &&
  a.birthDate === b.birthDate;
