import { useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import {
  adminTournamentManualRescheduleService,
  type AdminManualRescheduleTournament,
} from "../services/adminTournamentManualRescheduleService";
import {
  adminTournamentUnprogrammedService,
  type UnprogrammedTournamentMatch,
  type UnprogrammedMatchContact,
} from "../services/adminTournamentUnprogrammedService";

const displayDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${date}T12:00:00`));


const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

const printPendingMatches = (matches: UnprogrammedTournamentMatch[], contacts: UnprogrammedMatchContact[]) => {
  if (matches.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) throw new Error("Autorisez les fenêtres contextuelles pour exporter ce document.");

  const grouped = new Map<string, Map<string, UnprogrammedTournamentMatch[]>>();
  for (const match of [...matches].sort((a, b) =>
    [a.tournamentName, a.seriesName, a.previousDate, a.previousStart, a.teamA]
      .join("|").localeCompare(
        [b.tournamentName, b.seriesName, b.previousDate, b.previousStart, b.teamA].join("|"),
        "fr",
      ),
  )) {
    if (!grouped.has(match.tournamentName)) grouped.set(match.tournamentName, new Map());
    const series = grouped.get(match.tournamentName)!;
    series.set(match.seriesName, [...(series.get(match.seriesName) ?? []), match]);
  }

  const contactsByMatch = new Map<string, UnprogrammedMatchContact[]>();
  for (const contact of contacts) {
    contactsByMatch.set(contact.matchId, [...(contactsByMatch.get(contact.matchId) ?? []), contact]);
  }
  const sections = [...grouped].map(([tournament, series]) =>
    `<section><h2>${escapeHtml(tournament)}</h2>${[...series].map(([name, items]) =>
      `<h3>${escapeHtml(name)} — ${items.length} partie(s)</h3>
       <table><thead><tr><th>Équipe 1</th><th>Équipe 2</th><th>Contacts des joueurs</th><th>Ancien créneau</th><th>Motif</th></tr></thead>
       <tbody>${items.map((match) => `<tr><td>${escapeHtml(match.teamA)}</td>
       <td>${escapeHtml(match.teamB)}</td>
       <td>${(contactsByMatch.get(match.matchId) ?? []).map(contact =>
         `${escapeHtml(contact.name)} : ${escapeHtml(contact.phone || "Non renseigné")}`
       ).join("<br/>") || "Non renseigné"}</td>
       <td>${escapeHtml(match.previousDate.split("-").reverse().join("/"))} ${escapeHtml(match.previousStart)}–${escapeHtml(match.previousEnd)}</td>
       <td>${escapeHtml(match.reason || "—")}</td></tr>`).join("")}</tbody></table>`
    ).join("")}</section>`
  ).join("");

  const stamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
    <title>Parties de tournois à reprogrammer</title>
    <style>
      @page { size: A4 portrait; margin: 14mm; }
      body { font-family: Arial, sans-serif; color: #172b42; font-size: 10pt; }
      h1 { font-size: 18pt; margin: 0 0 6px; }
      h2 { font-size: 14pt; margin: 20px 0 6px; color: #154b75; }
      h3 { font-size: 11pt; margin: 12px 0 6px; }
      .subtitle { color: #566578; margin: 0 0 12px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 12px; table-layout: fixed; }
      th, td { border: 1px solid #c8d3dc; padding: 6px; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
      th { background: #e8f1f7; }
      tr { break-inside: avoid; }
      thead { display: table-header-group; }
      section { break-inside: auto; }
      @media screen { body { max-width: 840px; margin: 28px auto; padding: 0 18px; } }
    </style></head><body>
    <h1>Parties de tournois à reprogrammer</h1>
    <p class="subtitle">État au ${escapeHtml(stamp)} · ${matches.length} partie(s) sans créneau · ${grouped.size} tournoi(s)</p>
    ${sections}
    <script>window.onload = () => { window.focus(); window.print(); };<\/script>
    </body></html>`);
  win.document.close();
};

export function AdminTournamentUnprogrammedPanel() {
  const [params] = useSearchParams();
  const highlightedMatchId = params.get("match");
  const requestedResource = params.get("resource");
  const requestedStart = params.get("startsAt");
  const requestedEnd = params.get("endsAt");
  const requestedDate = requestedStart
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(requestedStart))
    : "";
  const requestedStartTime = requestedStart
    ? new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(requestedStart))
    : "";
  const requestedEndTime = requestedEnd
    ? new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(requestedEnd))
    : "";

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
  const [exporting, setExporting] = useState(false);
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

  const exportPdf = async () => {
    setExporting(true);
    setError("");
    try {
      const contacts = await adminTournamentUnprogrammedService.listContacts();
      printPendingMatches(pending, contacts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export impossible.");
    } finally {
      setExporting(false);
    }
  };

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

      <div className="admin-reschedules__unprogram-controls">
        <h2 id="parties-a-programmer">Parties à programmer ({pending.length})</h2>
        <button
          type="button"
          disabled={pending.length === 0 || exporting}
          onClick={() => void exportPdf()}
        >
          <Printer aria-hidden="true" />
          {exporting ? "Préparation…" : "Exporter la liste en PDF"}
        </button>
      </div>
      {requestedResource && requestedDate && (
        <p role="status">
          Créneau choisi depuis Réservations : {requestedDate} ·{" "}
          {requestedStartTime}–{requestedEndTime}. Sélectionnez une partie
          ci-dessous pour proposer cette programmation, sous réserve de
          disponibilité.
        </p>
      )}
      {pending.length === 0 && (
        <p>Aucune partie en attente de programmation.</p>
      )}
      <div className="admin-reschedules__list">
        {pending.map((match) => (
          <article
            className="admin-reschedules__card"
            key={match.matchId}
            id={
              match.matchId === highlightedMatchId
                ? "partie-selectionnee"
                : undefined
            }
            style={
              match.matchId === highlightedMatchId
                ? {
                    outline: "3px solid var(--color-primary, #176b4d)",
                    outlineOffset: 3,
                  }
                : undefined
            }
          >
            <h3>
              {match.matchId === highlightedMatchId
                ? "Partie sélectionnée · "
                : ""}
              {match.teamA} contre {match.teamB}
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
                  const resourceAllowed = match.resources.some(
                    (resource) => resource.id === requestedResource,
                  );
                  setDate(resourceAllowed ? requestedDate : "");
                  setResourceId(
                    resourceAllowed
                      ? requestedResource!
                      : (match.resources[0]?.id ?? ""),
                  );
                  setStart(
                    resourceAllowed && requestedStartTime
                      ? requestedStartTime
                      : match.previousStart,
                  );
                  setEnd(
                    resourceAllowed && requestedEndTime
                      ? requestedEndTime
                      : match.previousEnd,
                  );
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
