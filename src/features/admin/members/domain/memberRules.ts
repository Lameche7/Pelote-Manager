export type MemberGender = "male" | "female";
export type MemberCategory =
  | "M10"
  | "M12"
  | "M14"
  | "M16"
  | "M19"
  | "M22"
  | "Senior"
  | "Vétéran A/B"
  | "Vétéran Senior";

export const normalizeLicenceNumber = (value: string) =>
  value.trim().replace(/\s/gu, "").toLocaleUpperCase("fr-FR");
export const normalizeIdentity = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\s'’-]+/gu, "")
    .toLocaleUpperCase("fr-FR");

export function parseMemberDate(value: string): string | null {
  const text = value.trim();
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  const iso = match
    ? `${match[3]}-${match[2]}-${match[1]}`
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text
      : null;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

export function normalizeGender(value: string): MemberGender | null {
  const normalized = normalizeIdentity(value);
  if (["M", "H", "HOMME", "MASCULIN"].includes(normalized)) return "male";
  if (["F", "FEMME", "FEMININ"].includes(normalized)) return "female";
  return null;
}

export function calculateMemberCategory(
  birthDate: string,
  seasonEndsOn: string,
): MemberCategory {
  const age = Number(seasonEndsOn.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (age <= 9) return "M10";
  if (age <= 11) return "M12";
  if (age <= 13) return "M14";
  if (age <= 15) return "M16";
  if (age <= 18) return "M19";
  if (age <= 21) return "M22";
  if (age <= 44) return "Senior";
  if (age <= 54) return "Vétéran A/B";
  return "Vétéran Senior";
}
