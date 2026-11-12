import type { ClubAccess } from "./adminAccessService";

/**
 * Choisit un club parmi les habilitations déjà validées par le serveur.
 * Un identifiant fourni par l'interface ne confère jamais de droits.
 */
export function resolveAuthorizedClub(
  accesses: readonly ClubAccess[],
  requestedClubId: string | null | undefined,
): ClubAccess | null {
  if (!accesses.length) return null;
  if (requestedClubId) {
    return accesses.find((access) => access.clubId === requestedClubId) ?? null;
  }
  return accesses.length === 1 ? accesses[0] : null;
}

export function requiresClubSelection(
  accesses: readonly ClubAccess[],
): boolean {
  return accesses.length > 1;
}
