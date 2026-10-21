import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type {
  CalendarOccupation,
  ReservableResource,
} from "@/features/reservations/domain/calendar";
import { previewSwap, type Slot } from "../services/slotExchangePreview";
import { slotExchangeService } from "../services/slotExchangeService";
import {
  listExchangeCandidates,
  type ExchangeCandidate,
} from "../services/slotExchangeCandidatesService";

// Exchange writes remain gated by server-side authorization and conflict checks.
const EXCHANGE_WRITES_ENABLED = true;

const tournamentRange = (tournament: TournamentSummary) => ({
  from: new Date(tournament.startsOn + "T00:00:00"),
  until: new Date(
    new Date(tournament.endsOn + "T00:00:00").getTime() + 86400000,
  ),
});
async function loadCandidatesForRange(
  resourceId: string,
  from: Date,
  until: Date,
) {
  const result: ExchangeCandidate[] = [];
  const seen = new Set<string>();
  let cursor = from.getTime();
  while (cursor < until.getTime()) {
    const next = Math.min(cursor + 30 * 86400000, until.getTime());
    const batch = await listExchangeCandidates(
      resourceId,
      new Date(cursor).toISOString(),
      new Date(next).toISOString(),
    );
    for (const item of batch) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
    cursor = next;
  }
  return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
const today = () => new Date().toLocaleDateString("en-CA");
const formatDate = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const classify = (item: CalendarOccupation): Slot["kind"] =>
  item.occupationType === "reservation" ? "reservation" : "tournament";
const toSlot = (item: ExchangeCandidate): Slot => ({
  id: item.id,
  kind:
    item.sourceKind === "championship"
      ? "championship"
      : item.sourceKind === "reservation"
        ? "reservation"
        : item.sourceKind === "tournament"
          ? "tournament"
          : classify(item),
  resourceId: item.resourceId,
  startsAt: item.startsAt,
  endsAt: item.endsAt,
  editable: item.startsAt > new Date().toISOString(),
});

export function AdminSlotExchangePage() {
  const [params] = useSearchParams();
  const requestedResource = params.get("resource");
  const requestedStart = params.get("startsAt");
  const requestedEnd = params.get("endsAt");
  const validStart = requestedStart && !Number.isNaN(Date.parse(requestedStart)) ? requestedStart : null;
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(() => validStart ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(validStart)) : today());
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [tournamentId, setTournamentId] = useState("");
  const [items, setItems] = useState<ExchangeCandidate[]>([]);
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    tournamentAdminService
      .list()
      .then(setTournaments)
      .catch((e) => {
        setError(
          e instanceof Error
            ? e.message
            : "Impossible de charger les tournois.",
        );
      });
  }, []);
  const selectedTournament = tournaments.find((t) => t.id === tournamentId);
  const range = selectedTournament
    ? tournamentRange(selectedTournament)
    : {
        from: new Date(date + "T00:00:00"),
        until: new Date(new Date(date + "T00:00:00").getTime() + 7 * 86400000),
      };
  useEffect(() => {
    let active = true;
    reservationCalendarService
      .listResources()
      .then((data) => {
        if (active) {
          setResources(data);
          setResourceId(data.find((item) => item.id === requestedResource)?.id ?? data[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Terrains indisponibles.");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!resourceId || (!date && !selectedTournament)) return;
    let active = true;
    setLoading(true);
    setError("");
    setFirstId("");
    setSecondId("");
    loadCandidatesForRange(resourceId, range.from, range.until)
      .then((data) => {
        if (active) {
          setItems(data);
          if (requestedResource === resourceId && requestedStart && requestedEnd) {
            const matches = data.filter((item) => item.resourceId === resourceId && new Date(item.startsAt).getTime() === new Date(requestedStart).getTime() && new Date(item.endsAt).getTime() === new Date(requestedEnd).getTime());
            if (matches.length === 1) setFirstId(matches[0].id);
          }
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Impossible de charger le planning.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resourceId, date, tournamentId, tournaments]);
  const first = items.find((item) => item.id === firstId);
  const second = items.find((item) => item.id === secondId);
  const preview = useMemo(
    () =>
      first && second
        ? previewSwap(toSlot(first), toSlot(second))
        : null,
    [first, second],
  );
  async function confirmExchange() {
    if (busy || loading || !EXCHANGE_WRITES_ENABLED || !first || !second || !preview?.valid || !first.exchangeSupported || !second.exchangeSupported)
      return;
    if (!window.confirm(`Confirmer l’échange définitif ?\n${first.title} → ${formatDate(preview.first.startsAt)}\n${second.title} → ${formatDate(preview.second.startsAt)}`))
      return;
    setBusy(true);
    setAttempted(true);
    setError("");
    setSuccess("");
    try {
      const outcome = await slotExchangeService.exchangeTwoReservations(
        first.id,
        second.id,
      );
      setSuccess(
        outcome.notificationWarning ??
          `Échange enregistré. ${outcome.notificationsPublished} notification(s) publiée(s).`,
      );
        setFirstId("");
      setSecondId("");
      setItems(
        await loadCandidatesForRange(resourceId, range.from, range.until),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échange impossible.");
    } finally {
      setBusy(false);
    }
  }
  const option = (item: ExchangeCandidate) =>
    `${formatDate(item.startsAt)} — ${item.title} (${item.sourceKind === "championship" ? "Championnat" : item.sourceKind === "tournament" ? "Tournoi" : item.sourceKind === "reservation" ? "Réservation" : item.sourceKind})`;
  return (
    <main style={{ maxWidth: 1050, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: 24 }}>
      <h1>Échanger deux créneaux</h1>
      <p>
        Choisis deux occupations du calendrier, vérifie leurs nouveaux horaires puis confirme l’échange. Le serveur contrôle les droits et les conflits avant toute modification.
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 20, minWidth: 0 }}
      >
        <label>
          Terrain{" "}
          <select
            style={{ maxWidth: "100%", minWidth: 0 }}
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tournoi{" "}
          <select
            style={{ maxWidth: "100%", minWidth: 0 }}
            value={tournamentId}
            onChange={(e) => setTournamentId(e.target.value)}
          >
            <option value="">Recherche sur 7 jours</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.startsOn} → {t.endsOn})
              </option>
            ))}
          </select>
        </label>
        {!selectedTournament && (
          <label>
            À partir du{" "}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        <span>
          {selectedTournament
            ? `Occupations du tournoi entier (${selectedTournament.startsOn} au ${selectedTournament.endsOn})`
            : "Occupations sur 7 jours"}
        </span>
      </div>
      {error && <p role="alert" style={{ padding: 16, border: "2px solid #b91c1c", borderRadius: 8, fontWeight: 700, whiteSpace: "pre-wrap" }}>Échange non effectué : {error}</p>}
      {success && <p role="status" style={{ padding: 16, border: "2px solid #15803d", borderRadius: 8, fontWeight: 700, whiteSpace: "pre-wrap" }}>{success}</p>}
      {attempted && busy && <p role="status">Vérification et enregistrement de l’échange en cours…</p>}
      {loading ? (
        <p>Chargement du planning…</p>
      ) : (
        <p>{items.length} occupation(s) trouvée(s).</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: 16,
        }}
      >
        {(
          [
            { label: "Occupation A", value: firstId, set: setFirstId },
            { label: "Occupation B", value: secondId, set: setSecondId },
          ] as const
        ).map((field) => (
          <fieldset
            key={field.label}
            style={{ minWidth: 0, padding: 20, borderRadius: 12, border: "1px solid #888" }}
          >
            <legend>{field.label}</legend>
            <select
              aria-label={field.label}
              style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: 8 }}
              value={field.value}
              onChange={(e) => {
                field.set(e.target.value);
                          }}
            >
              <option value="">Sélectionner une occupation…</option>
              {items
                .filter(
                  (item) =>
                    item.id !==
                    (field.label === "Occupation A" ? secondId : firstId),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {option(item)}
                  </option>
                ))}
            </select>
            {items.find((item) => item.id === field.value) && (
              <p>{items.find((item) => item.id === field.value)?.title}</p>
            )}
          </fieldset>
        ))}
      </div>
      {preview && (
        <section aria-live="polite" style={{ marginTop: 20 }}>
          {preview.valid ? (
            <>
              <h2>Échange prévu</h2>
              <p>
                {first?.title} → {formatDate(preview.first.startsAt)}
              </p>
              <p>
                {second?.title} → {formatDate(preview.second.startsAt)}
              </p>
              {EXCHANGE_WRITES_ENABLED &&
              first?.exchangeSupported &&
              second?.exchangeSupported &&
              ["reservation", "championship", "tournament"].includes(
                first.sourceKind,
              ) &&
              ["reservation", "championship", "tournament"].includes(
                second.sourceKind,
              ) ? (
                <>
                  <p>
                    La confirmation demande au serveur de vérifier les droits et
                    les conflits avant tout changement.
                  </p>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void confirmExchange()}
                  >
                    {busy
                      ? "Échange en cours…"
                      : "Confirmer l’échange des deux occupations"}
                  </button>
                </>
              ) : (
                <p>
                  Ces occupations ne sont pas échangeables actuellement. Aucun
                  changement ne sera effectué.
                </p>
              )}
            </>
          ) : (
            <>
              <h2>Échange impossible</h2>
              <ul>
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
