import { useEffect, useMemo, useState } from "react";
import { TournamentAvailabilityGrid } from "@/features/tournaments/components/TournamentAvailabilityGrid";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type {
  MyTournamentRegistration,
  PublicTournamentDetail,
  TournamentAvailabilitySlot,
} from "@/features/tournaments/types";

type Props = {
  tournament: PublicTournamentDetail;
  registration: MyTournamentRegistration;
  onSaved: () => Promise<void>;
};

const key = (slot: TournamentAvailabilitySlot) =>
  `${slot.date}|${slot.startsAt}|${slot.endsAt}`;

export function TournamentFinalsAvailabilityEditor({
  tournament,
  registration,
  onSaved,
}: Props) {
  const finalSlots = useMemo(
    () =>
      tournament.availableSlots.filter(
        (slot) =>
          slot.phase === "finals" &&
          Boolean(tournament.finalsStartsOn) &&
          Boolean(tournament.finalsEndsOn) &&
          slot.date >= tournament.finalsStartsOn! &&
          slot.date <= tournament.finalsEndsOn!,
      ),
    [
      tournament.availableSlots,
      tournament.finalsStartsOn,
      tournament.finalsEndsOn,
    ],
  );
  const initial = useMemo(() => {
    const keys = new Set(registration.availabilitySlots.map(key));
    return finalSlots.filter((slot) => keys.has(key(slot)));
  }, [registration.availabilitySlots, finalSlots]);
  const [selected, setSelected] = useState(initial);
  const [busyDates, setBusyDates] = useState<string[]>([]);
  const [loadingBusy, setLoadingBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => setSelected(initial), [initial]);

  useEffect(() => {
    let active = true;
    const playerIds = [
      null,
      ...registration.players
        .map((player) => player.memberId)
        .filter((id): id is string => Boolean(id)),
    ];
    setLoadingBusy(true);
    Promise.all(
      playerIds.map((id) =>
        tournamentService.getInterTournamentBusyDates(tournament.id, id),
      ),
    )
      .then((results) => {
        if (active) setBusyDates([...new Set(results.flat())]);
      })
      .catch(() => {
        if (active)
          setError("Impossible de vérifier les conflits entre tournois.");
      })
      .finally(() => {
        if (active) setLoadingBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tournament.id, registration.players]);

  const finalGrid = useMemo(
    () => ({
      ...tournament,
      availableSlots: finalSlots,
      minimumAvailabilitySlots: 0,
      minimumWeekendAvailabilitySlots: 0,
    }),
    [tournament, finalSlots],
  );
  const minimumReached =
    selected.length >= tournament.minimumFinalsAvailabilitySlots;

  async function save() {
    setError("");
    setSuccess("");
    if (loadingBusy) return;
    if (!minimumReached) {
      setError(
        `Veuillez sélectionner au moins ${tournament.minimumFinalsAvailabilitySlots} créneaux de phase finale.`,
      );
      return;
    }
    if (
      selected.some(
        (slot) =>
          busyDates.includes(slot.date) &&
          !initial.some((old) => key(old) === key(slot)),
      )
    ) {
      setError(
        "Un nouveau créneau est en conflit avec une partie d'un autre tournoi.",
      );
      return;
    }
    setSaving(true);
    try {
      await tournamentService.saveMyFinalsAvailability(tournament.id, selected);
      await onSaved();
      setSuccess(
        "Vos disponibilités pour la phase finale ont été enregistrées.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!finalSlots.length) return null;
  return (
    <section className="public-tournament-panel" id="disponibilites-finales">
      <h2>Mes disponibilités — phase finale</h2>
      <p>
        Les inscriptions sont closes, mais vous pouvez ajuster vos créneaux de
        phase finale, notamment les mercredis. Vos disponibilités de poules,
        votre équipe et vos résultats ne seront pas modifiés.
      </p>
      <TournamentAvailabilityGrid
        tournament={finalGrid}
        variant="finals"
        value={selected}
        disabled={saving || loadingBusy}
        busyDates={busyDates.filter(
          (day) => !initial.some((slot) => slot.date === day),
        )}
        onChange={setSelected}
      />
      {error && (
        <p role="alert" className="public-tournaments__error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="public-tournaments__success">
          {success}
        </p>
      )}
      <button
        className="button button--primary"
        type="button"
        disabled={saving || loadingBusy || !minimumReached}
        onClick={() => void save()}
      >
        {saving
          ? "Enregistrement…"
          : "Enregistrer mes disponibilités de phase finale"}
      </button>
    </section>
  );
}
