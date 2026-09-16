import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminTournamentManualRescheduleService,
  type AdminManualRescheduleMatch,
  type AdminManualRescheduleSlot,
  type AdminManualRescheduleTournament,
} from "@/features/admin/tournaments/services/adminTournamentManualRescheduleService";
import "./AdminTournamentManualRescheduleForm.css";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const dateLabel = (value: string) =>
  dateFormatter.format(new Date(`${value}T12:00:00`));

const matchLabel = (match: AdminManualRescheduleMatch) =>
  `${match.teamALabel} vs ${match.teamBLabel} · ${dateLabel(match.playDate)} · ${match.startsAt}–${match.endsAt}`;

const slotKey = (slot: AdminManualRescheduleSlot) =>
  [slot.resourceId, slot.playDate, slot.startsAt, slot.endsAt].join("|");

export function AdminTournamentManualRescheduleForm({
  onCreated,
}: {
  onCreated: () => Promise<void>;
}) {
  const [tournaments, setTournaments] = useState<
    AdminManualRescheduleTournament[]
  >([]);
  const [tournamentId, setTournamentId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [requesterTeamId, setRequesterTeamId] = useState("");
  const [slots, setSlots] = useState<AdminManualRescheduleSlot[]>([]);
  const [selectedSlotKey, setSelectedSlotKey] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadContext = useCallback(async () => {
    const items = await adminTournamentManualRescheduleService.getContext();
    setTournaments(items);
    setTournamentId((current) => {
      if (current && items.some((item) => item.id === current)) return current;
      return items.find((item) => item.matches.length > 0)?.id ?? items[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminTournamentManualRescheduleService
      .getContext()
      .then((items) => {
        if (!active) return;
        setTournaments(items);
        setTournamentId(
          items.find((item) => item.matches.length > 0)?.id ?? items[0]?.id ?? "",
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les parties à reporter.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const tournament = useMemo(
    () => tournaments.find((item) => item.id === tournamentId) ?? null,
    [tournamentId, tournaments],
  );
  const match = useMemo(
    () => tournament?.matches.find((item) => item.id === matchId) ?? null,
    [matchId, tournament],
  );
  const selectedSlot = useMemo(
    () => slots.find((slot) => slotKey(slot) === selectedSlotKey) ?? null,
    [selectedSlotKey, slots],
  );

  useEffect(() => {
    setMatchId("");
    setRequesterTeamId("");
    setSlots([]);
    setSelectedSlotKey("");
    setSuccess("");
  }, [tournamentId]);

  useEffect(() => {
    setRequesterTeamId("");
    setSlots([]);
    setSelectedSlotKey("");
    setSuccess("");
    if (!matchId) return;

    let active = true;
    setLoadingSlots(true);
    setError("");
    adminTournamentManualRescheduleService
      .getSlots(matchId)
      .then((items) => {
        if (active) setSlots(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les créneaux disponibles.",
        );
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [matchId]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!match || !requesterTeamId || !selectedSlot) {
      setError("Choisissez la partie, l’équipe demandeuse et le nouveau créneau.");
      return;
    }
    if (contactNote.trim().length < 3) {
      setError("Indiquez comment la demande a été recueillie hors application.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await adminTournamentManualRescheduleService.create({
        matchId: match.id,
        requesterTeamId,
        slot: selectedSlot,
        contactNote,
      });
      setSuccess(
        "Demande créée. L’accord de l’équipe demandeuse est enregistré hors application ; l’autre équipe peut maintenant répondre dans PILOTOKI ou être contactée par l’organisation.",
      );
      setMatchId("");
      setRequesterTeamId("");
      setSlots([]);
      setSelectedSlotKey("");
      setContactNote("");
      await Promise.all([loadContext(), onCreated()]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de créer cette demande de report.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-manual-reschedule" aria-labelledby="admin-manual-reschedule-title">
      <header>
        <div>
          <p className="admin-page__eyebrow">Création manuelle</p>
          <h2 id="admin-manual-reschedule-title">Créer un report de A à Z</h2>
          <p>
            Pour une demande reçue par téléphone, au club ou par message, même si
            les joueurs n’ont pas encore de compte PILOTOKI.
          </p>
        </div>
      </header>

      {loading ? (
        <p role="status">Chargement des parties…</p>
      ) : tournaments.length === 0 ? (
        <p>Aucun tournoi publié ne permet actuellement de créer un report.</p>
      ) : (
        <form onSubmit={create}>
          <label>
            <span>Tournoi</span>
            <select
              value={tournamentId}
              onChange={(event) => setTournamentId(event.target.value)}
              disabled={saving}
            >
              {tournaments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Partie à reporter</span>
            <select
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
              disabled={saving || !tournament || tournament.matches.length === 0}
              required
            >
              <option value="">Choisir une partie</option>
              {tournament?.matches.map((item) => (
                <option key={item.id} value={item.id}>
                  {matchLabel(item)}
                </option>
              ))}
            </select>
            {tournament && tournament.matches.length === 0 && (
              <small>Aucune partie future disponible dans ce tournoi.</small>
            )}
          </label>

          {match && (
            <div className="admin-manual-reschedule__current">
              <span>Créneau actuel</span>
              <strong>
                {dateLabel(match.playDate)} · {match.startsAt}–{match.endsAt} · {match.resourceName}
              </strong>
            </div>
          )}

          <label>
            <span>Équipe à l’origine de la demande</span>
            <select
              value={requesterTeamId}
              onChange={(event) => setRequesterTeamId(event.target.value)}
              disabled={saving || !match}
              required
            >
              <option value="">Choisir l’équipe</option>
              {match && (
                <>
                  <option value={match.teamAId}>{match.teamALabel}</option>
                  <option value={match.teamBId}>{match.teamBLabel}</option>
                </>
              )}
            </select>
          </label>

          <label>
            <span>Nouveau créneau</span>
            <select
              value={selectedSlotKey}
              onChange={(event) => setSelectedSlotKey(event.target.value)}
              disabled={saving || loadingSlots || !match}
              required
            >
              <option value="">
                {loadingSlots ? "Recherche des créneaux…" : "Choisir un créneau disponible"}
              </option>
              {slots.map((slot) => (
                <option key={slotKey(slot)} value={slotKey(slot)}>
                  {dateLabel(slot.playDate)} · {slot.startsAt}–{slot.endsAt} · {slot.resourceName}
                </option>
              ))}
            </select>
            {match && !loadingSlots && slots.length === 0 && (
              <small>Aucun créneau libre compatible n’est disponible.</small>
            )}
          </label>

          <label className="admin-manual-reschedule__note">
            <span>Comment la demande a-t-elle été recueillie ?</span>
            <input
              type="text"
              minLength={3}
              maxLength={500}
              value={contactNote}
              onChange={(event) => setContactNote(event.target.value)}
              placeholder="Ex. appel de Jean Dupont le 16/09, demande de déplacement"
              disabled={saving}
              required
            />
            <small>
              Cette note est conservée dans l’audit et vaut accord de l’équipe
              demandeuse. L’autre équipe devra ensuite accepter dans l’application
              ou être contactée hors application.
            </small>
          </label>

          {error && (
            <p className="admin-manual-reschedule__error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="admin-manual-reschedule__success" role="status">
              {success}
            </p>
          )}

          <button
            className="admin-manual-reschedule__submit"
            type="submit"
            disabled={saving || !match || !requesterTeamId || !selectedSlot}
          >
            {saving ? "Création…" : "Créer la demande de report"}
          </button>
        </form>
      )}
    </section>
  );
}
