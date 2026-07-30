import { localInputToStoredDateTime } from "./eventDateTime.js";

export type EventSaveResult = { ok: true } | { ok: false; message: string };

export async function submitEventDraft<
  T extends { startsAt: string; endsAt: string },
>(draft: T, save: (value: T) => Promise<unknown>): Promise<EventSaveResult> {
  try {
    await save({
      ...draft,
      startsAt: localInputToStoredDateTime(draft.startsAt),
      endsAt: localInputToStoredDateTime(draft.endsAt),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer l’évènement.",
    };
  }
}
