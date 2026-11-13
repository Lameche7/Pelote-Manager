import { useEffect, useMemo, useState } from "react";
import { TournamentAvailabilityGrid } from "@/features/tournaments/components/TournamentAvailabilityGrid";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type {
  MyTournamentFinalsAvailability,
  PublicTournamentDetail,
  TournamentAvailabilitySlot,
} from "@/features/tournaments/types";

type Props = {
  tournament: PublicTournamentDetail;
  registration: MyTournamentFinalsAvailability;
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
  const [busyDates, setBusyDates] = useState<
    Array<{ date: string; title: string }>
  >([]);
  const [loadingBusy, setLoadingBusy] = useState(true);
  const [conflictsLoaded, setConflictsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => setSelected(initial), [initial]);

  useEffect(() => {
    let active = true;
    setLoadingBusy(true);
    setConflictsLoaded(false);
    tournamentService
      .getTeamBusyDates(tournament.id)
      .then((results) => {
        if (!active) return;
        setBusyDates(results);
        setConflictsLoaded(true);
        const conflicts = new Set(results.map((row) => row.date));
        setSelected((current) =>
          current.filter((slot) => !conflicts.has(slot.date)),
        );
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
  }, [tournament.id, registration.teamId]);

  const blockedDays = useMemo(
    () => new Set(busyDates.map((row) => row.date)),
    [busyDates],
  );
  const busyReasons = useMemo(() => {
    const reasons: Record<string, string> = {};
    for (const conflict of busyDates) {
      const reason = `Partie programmée — ${conflict.title}`;
      reasons[conflict.date] = reasons[conflict.date]
        ? `${reasons[conflict.date]} ; ${reason}`
        : reason;
    }
    return reasons;
  }, [busyDates]);
  const previouslySelectedBlocked = initial.some((slot) =>
    blockedDays.has(slot.date),
  );

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
    selected.filter((slot) => !blockedDays.has(slot.date)).length >=
    tournament.minimumFinalsAvailabilitySlots;

  async function save() {
    setError("");
    setSuccess("");
    if (loadingBusy || !conflictsLoaded) return;
    if (!minimumReached) {
      setError(
        `Veuillez sélectionner au moins ${tournament.minimumFinalsAvailabilitySlots} créneaux de phase finale.`,
      );
      return;
    }
    if (selected.some((slot) => blockedDays.has(slot.date))) {
      setError(
        "Une date déjà programmée dans un autre tournoi doit rester décochée.",
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
      {previouslySelectedBlocked && (
        <p role="status">
          Certaines dates déjà cochées sont désormais bloquées par une partie
          extérieure. Elles sont décochées dans cette grille et seront retirées
          de vos disponibilités uniquement lorsque vous enregistrerez.
        </p>
      )}
      <TournamentAvailabilityGrid
        tournament={finalGrid}
        variant="finals"
        value={selected}
        disabled={saving || loadingBusy || !conflictsLoaded}
        busyDates={[...blockedDays]}
        busyReasons={busyReasons}
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
        disabled={saving || loadingBusy || !conflictsLoaded || !minimumReached}
        onClick={() => void save()}
      >
        {saving
          ? "Enregistrement…"
          : "Enregistrer mes disponibilités de phase finale"}
      </button>
    </section>
  );
}
