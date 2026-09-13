import { useEffect, useState } from "react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  permanentSlotService,
  type PermanentSlotOccurrence,
  type PermanentSlotOccurrenceStatus,
} from "@/features/reservations/services/permanentSlotService";
import "./MyPermanentSlotsPage.css";

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(occurrence: PermanentSlotOccurrence): string {
  if (occurrence.isRebooked) return "Libéré · repris par un autre joueur";
  if (occurrence.status === "released") return "Libéré · encore disponible";
  if (occurrence.status === "confirmed") return "Maintien confirmé";
  return "Réservé automatiquement";
}

export function MyPermanentSlotsPage() {
  const [occurrences, setOccurrences] = useState<PermanentSlotOccurrence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadOccurrences() {
    setError(null);
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 35);
    try {
      const data = await permanentSlotService.listMyOccurrences(
        formatDateInput(from),
        formatDateInput(to),
      );
      setOccurrences(data);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Chargement impossible.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadOccurrences();
  }, []);

  async function updateOccurrence(
    occurrence: PermanentSlotOccurrence,
    status: PermanentSlotOccurrenceStatus,
  ) {
    setSavingId(occurrence.occurrenceId);
    setError(null);
    setMessage(null);
    try {
      await permanentSlotService.setOccurrenceStatus(
        occurrence.occurrenceId,
        status,
      );
      setMessage(
        status === "released"
          ? "Le créneau a été libéré ponctuellement."
          : "Le créneau est bien maintenu.",
      );
      await loadOccurrences();
    } catch (updateError: unknown) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Modification impossible.",
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <UserSpaceShell>
      <section
        className="my-permanent-slots"
        aria-labelledby="my-permanent-slots-title"
      >
        <header>
          <p className="my-permanent-slots__eyebrow">Mon espace</p>
          <h1 id="my-permanent-slots-title">Mes créneaux permanents</h1>
          <p>
            Vos créneaux restent réservés automatiquement. Vous n’avez rien à
            faire pour les conserver. Si vous ne les utilisez pas, vous pouvez
            libérer ponctuellement une occurrence pour les autres joueurs.
          </p>
        </header>

        {error && (
          <p className="my-permanent-slots__alert my-permanent-slots__alert--error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="my-permanent-slots__alert" role="status">
            {message}
          </p>
        )}

        {isLoading ? (
          <p>Chargement de vos créneaux…</p>
        ) : occurrences.length === 0 ? (
          <div className="my-permanent-slots__empty">
            <h2>Aucune occurrence à venir</h2>
            <p>Vous n’avez pas de créneau permanent prévu dans les prochaines semaines.</p>
          </div>
        ) : (
          <div className="my-permanent-slots__list">
            {occurrences.map((occurrence) => {
              const isSaving = savingId === occurrence.occurrenceId;
              const managementOpens = formatDateTime(
                occurrence.managementOpensAt,
              );
              return (
                <article
                  className={`my-permanent-slots__card my-permanent-slots__card--${occurrence.status}`}
                  key={occurrence.occurrenceId}
                >
                  <div className="my-permanent-slots__card-main">
                    <div>
                      <span className="my-permanent-slots__status">
                        {statusLabel(occurrence)}
                      </span>
                      <h2>{occurrence.label}</h2>
                      <p>
                        {formatDateTime(occurrence.startsAt)} · {occurrence.resourceName}
                      </p>
                      {!occurrence.canManageNow &&
                        !occurrence.isRebooked &&
                        occurrence.status !== "released" && (
                          <small>
                            Vous pourrez confirmer ou libérer cette occurrence à partir de {managementOpens}.
                          </small>
                        )}
                      {occurrence.isPrimary && <small>Vous êtes le titulaire principal.</small>}
                    </div>
                  </div>

                  {occurrence.canManageNow && !occurrence.isRebooked && (
                    <div className="my-permanent-slots__actions">
                      {occurrence.status === "released" ? (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            void updateOccurrence(occurrence, "confirmed")
                          }
                        >
                          {isSaving ? "Mise à jour…" : "Reprendre mon créneau"}
                        </button>
                      ) : (
                        <>
                          {occurrence.status !== "confirmed" && (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() =>
                                void updateOccurrence(occurrence, "confirmed")
                              }
                            >
                              {isSaving ? "Mise à jour…" : "Maintenir"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="my-permanent-slots__release"
                            disabled={isSaving}
                            onClick={() =>
                              void updateOccurrence(occurrence, "released")
                            }
                          >
                            {isSaving ? "Mise à jour…" : "Libérer ce créneau"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
