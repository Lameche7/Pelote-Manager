import { useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  adminTournamentManualRescheduleService,
  type AdminManualRescheduleTournament,
} from "../services/adminTournamentManualRescheduleService";
import {
  adminTournamentUnprogrammedService,
  type UnprogrammedTournamentMatch,
} from "../services/adminTournamentUnprogrammedService";

const displayDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${date}T12:00:00`));

export function AdminTournamentUnprogrammedPanel() {
  const [params] = useSearchParams();
  const highlightedMatchId = params.get("match");
  const requestedResource = params.get("resource");
  const requestedStart = params.get("startsAt");
  const requestedEnd = params.get("endsAt");
  const requestedDate = requestedStart ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(requestedStart)) : "";
  const requestedStartTime = requestedStart ? new Intl.DateTimeFormat("fr-FR", {timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(requestedStart)) : "";
  const requestedEndTime = requestedEnd ? new Intl.DateTimeFormat("fr-FR", {timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(requestedEnd)) : "";

  const [tournaments, setTournaments] = useState<
    AdminManualRescheduleTournament[]
  >([]);
  const [pending, setPending] = useState<UnprogrammedTournamentMatch[]>([]);
  const [matchId, setMatchId] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("19:30");
  const [end, setEnd] = useState("20:30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [context, waiting] = await Promise.all([
      adminTournamentManualRescheduleService.getContext(),
      adminTournamentUnprogrammedService.list(),
    ]);
    setTournaments(context);
    setPending(waiting);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "Chargement impossible.",
      );
    });
  }, [load]);

  const matches = tournaments.flatMap((tournament) =>
    tournament.matches.map((match) => ({
      ...match,
      label: [
        tournament.name,
        `${match.teamALabel} contre ${match.teamBLabel}`,
        `${displayDate(match.playDate)} ${match.startsAt}`,
      ].join(" · "),
    })),
  );

  const unprogram = async () => {
    if (!matchId || reason.trim().length < 3) {
      setError(
        "Choisissez une partie et indiquez un motif d'au moins 3 caractères.",
      );
      return;
    }
    const match = matches.find((item) => item.id === matchId);
    if (
      !match ||
      !window.confirm(
        `Libérer le créneau du ${displayDate(match.playDate)} à ${match.startsAt} ? La partie restera à programmer.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentUnprogrammedService.unprogram(
        matchId,
        reason.trim(),
      );
      setMatchId("");
      setReason("");
      await load();
      setMessage(
        "Créneau libéré. La partie figure désormais dans « Parties à programmer ».",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Libération impossible.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reprogram = async (match: UnprogrammedTournamentMatch) => {
    if (!resourceId || !date || !start || !end) {
      setError("Choisissez le terrain, la date et les horaires.");
      return;
    }
    if (
      !window.confirm(
        "Programmer cette partie sur le nouveau créneau ? Le calendrier sera synchronisé.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentUnprogrammedService.reprogram({
        matchId: match.matchId,
        resourceId,
        date,
        start,
        end,
      });
      setEditing("");
      await load();
      setMessage("Partie reprogrammée et occupation du calendrier rétablie.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reprogrammation impossible.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-reschedules__unprogrammed">
      <h2>Libérer un créneau sans reprogrammer la partie</h2>
      <p>
        Pour une partie qui ne peut pas se jouer : son créneau redevient
        disponible, sans supprimer la rencontre ni ses équipes.
      </p>
      <div className="admin-reschedules__unprogram-controls">
        <label>
          Partie programmée
          <select
            value={matchId}
            onChange={(event) => setMatchId(event.target.value)}
            disabled={busy}
          >
            <option value="">Sélectionner une partie</option>
            {matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Motif
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Indisponibilité des joueurs…"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          disabled={busy || !matchId || reason.trim().length < 3}
          onClick={() => void unprogram()}
        >
          {busy ? "Traitement…" : "Déprogrammer / libérer le créneau"}
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-reschedules__error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="admin-reschedules__success">
          {message}
        </p>
      )}

      <h2 id="parties-a-programmer">Parties à programmer ({pending.length})</h2>
      {requestedResource && requestedDate && (
        <p role="status">Créneau choisi depuis Réservations : {requestedDate} · {requestedStartTime}–{requestedEndTime}. Sélectionnez une partie ci-dessous pour proposer cette programmation, sous réserve de disponibilité.</p>
      )}
      {pending.length === 0 && (
        <p>Aucune partie en attente de programmation.</p>
      )}
      <div className="admin-reschedules__list">
        {pending.map((match) => (
          <article className="admin-reschedules__card" key={match.matchId} id={match.matchId === highlightedMatchId ? "partie-selectionnee" : undefined} style={match.matchId === highlightedMatchId ? { outline: "3px solid var(--color-primary, #176b4d)", outlineOffset: 3 } : undefined}>
            <h3>
              {match.matchId === highlightedMatchId ? "Partie sélectionnée · " : ""}{match.teamA} contre {match.teamB}
            </h3>
            <p>
              {match.tournamentName} · {match.seriesName}
            </p>
            <p>
              Ancien créneau : {displayDate(match.previousDate)} ·{" "}
              {match.previousStart}–{match.previousEnd}
            </p>
            <p>Motif : {match.reason}</p>
            {editing !== match.matchId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(match.matchId);
                  const resourceAllowed = match.resources.some((resource) => resource.id === requestedResource);
                  setDate(resourceAllowed ? requestedDate : "");
                  setResourceId(resourceAllowed ? requestedResource! : match.resources[0]?.id ?? "");
                  setStart(resourceAllowed && requestedStartTime ? requestedStartTime : match.previousStart);
                  setEnd(resourceAllowed && requestedEndTime ? requestedEndTime : match.previousEnd);
                  setError("");
                }}
              >
                Programmer cette partie
              </button>
            ) : (
              <div className="admin-reschedules__unprogram-controls">
                <label>
                  Terrain
                  <select
                    value={resourceId}
                    onChange={(event) => setResourceId(event.target.value)}
                    disabled={busy}
                  >
                    {match.resources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  Début
                  <input
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  Fin
                  <input
                    type="time"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !resourceId || !date}
                  onClick={() => void reprogram(match)}
                >
                  Confirmer la programmation
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing("")}
                >
                  Annuler
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
