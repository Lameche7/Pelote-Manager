export type SlotKind =
  "championship" | "tournament" | "reservation" | "permanent";
export type Slot = {
  id: string;
  kind: SlotKind;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  editable: boolean;
};
export type SlotDestination = Pick<Slot, "resourceId" | "startsAt" | "endsAt">;
export type SwapPreview =
  | { valid: true; first: SlotDestination; second: SlotDestination }
  | { valid: false; errors: string[] };

/** Read-only preliminary validation. Database checks are still required. */
export function previewSwap(first: Slot, second: Slot): SwapPreview {
  const errors: string[] = [];
  const firstDuration = Date.parse(first.endsAt) - Date.parse(first.startsAt);
  const secondDuration =
    Date.parse(second.endsAt) - Date.parse(second.startsAt);
  if (first.id === second.id)
    errors.push("Deux occupations distinctes sont nécessaires.");
  if (!first.editable || !second.editable)
    errors.push("Occupation non modifiable.");
  if (!first.resourceId || !second.resourceId)
    errors.push("Ressource manquante.");
  if (
    !Number.isFinite(firstDuration) ||
    !Number.isFinite(secondDuration) ||
    firstDuration <= 0 ||
    secondDuration <= 0
  )
    errors.push("Horaires invalides.");
  if (firstDuration !== secondDuration)
    errors.push("Durées différentes : échange direct impossible.");
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    first: {
      resourceId: second.resourceId,
      startsAt: second.startsAt,
      endsAt: second.endsAt,
    },
    second: {
      resourceId: first.resourceId,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    },
  };
}
