import { useEffect, useMemo, useState } from "react";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { CalendarOccupation, ReservableResource } from "@/features/reservations/domain/calendar";
import { previewSwap, type Slot } from "../services/slotExchangePreview";
import { slotExchangeService } from "../services/slotExchangeService";
import { listExchangeCandidates, type ExchangeCandidate } from "../services/slotExchangeCandidatesService";

const today = () => new Date().toLocaleDateString("en-CA");
const formatDate = (value: string) => new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const classify = (item: CalendarOccupation): Slot["kind"] =>
  item.occupationType === "reservation" ? "reservation" : "tournament";
const toSlot = (item: ExchangeCandidate): Slot => ({
  id: item.id, kind: item.sourceKind === "championship" ? "championship" : item.sourceKind === "reservation" ? "reservation" : item.sourceKind === "tournament" ? "tournament" : classify(item), resourceId: item.resourceId,
  startsAt: item.startsAt, endsAt: item.endsAt, editable: item.startsAt > new Date().toISOString(),
});

export function AdminSlotExchangePage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<ExchangeCandidate[]>([]);
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let active = true;
    reservationCalendarService.listResources().then(data => {
      if (active) { setResources(data); setResourceId(data[0]?.id ?? ""); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Terrains indisponibles."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!resourceId || !date) return;
    let active = true;
    setLoading(true); setError(""); setShowPreview(false);
    setFirstId(""); setSecondId("");
    const from = new Date(date + "T00:00:00");
    const until = new Date(from);
    until.setDate(until.getDate() + 7);
    listExchangeCandidates(resourceId, from.toISOString(), until.toISOString())
      .then(data => { if (active) setItems(data); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Impossible de charger le planning."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [resourceId, date]);
  const first = items.find(item => item.id === firstId);
  const second = items.find(item => item.id === secondId);
  const preview = useMemo(() => showPreview && first && second ? previewSwap(toSlot(first), toSlot(second)) : null, [showPreview, first, second]);
  async function confirmExchange() {
    if (!first || !second || !preview?.valid) return;
    if (!window.confirm("Confirmer l'échange définitif des deux occupations ?")) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const outcome = await slotExchangeService.exchangeTwoReservations(first.id, second.id);
      setSuccess(`Échange enregistré. ${outcome.notificationsPublished} notification(s) publiée(s).`);
      setShowPreview(false); setFirstId(""); setSecondId("");
      const from = new Date(date + "T00:00:00");
      const until = new Date(from); until.setDate(until.getDate() + 7);
      setItems(await listExchangeCandidates(resourceId, from.toISOString(), until.toISOString()));
    } catch (e) { setError(e instanceof Error ? e.message : "Échange impossible."); }
    finally { setBusy(false); }
  }
  const option = (item: ExchangeCandidate) => `${formatDate(item.startsAt)} — ${item.title} (${item.sourceKind === "championship" ? "Championnat" : item.sourceKind === "tournament" ? "Tournoi" : item.sourceKind === "reservation" ? "Réservation" : item.sourceKind})`;
  return <main style={{ maxWidth: 1050, margin: "0 auto", padding: 24 }}>
    <h1>Échanger deux créneaux</h1>
    <p>Choisis deux occupations réelles du calendrier. La simulation est disponible pour toutes les occupations. Les échanges sont validés par le serveur avant toute modification.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
      <label>Terrain <select value={resourceId} onChange={e => setResourceId(e.target.value)}>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>À partir du <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <span>Occupations sur 7 jours</span>
    </div>
    {error && <p role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    {loading ? <p>Chargement du planning…</p> : <p>{items.length} occupation(s) trouvée(s).</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16 }}>
      {([
        { label: "Occupation A", value: firstId, set: setFirstId },
        { label: "Occupation B", value: secondId, set: setSecondId },
      ] as const).map(field => <fieldset key={field.label} style={{ padding: 20, borderRadius: 12, border: "1px solid #888" }}>
        <legend>{field.label}</legend>
        <select aria-label={field.label} style={{ width: "100%", padding: 8 }} value={field.value} onChange={e => { field.set(e.target.value); setShowPreview(false); }}>
          <option value="">Sélectionner une occupation…</option>
          {items.filter(item => item.id !== (field.label === "Occupation A" ? secondId : firstId)).map(item =>
            <option key={item.id} value={item.id}>{option(item)}</option>)}
        </select>
        {items.find(item => item.id === field.value) && <p>{items.find(item => item.id === field.value)?.title}</p>}
      </fieldset>)}
    </div>
    <button type="button" disabled={!first || !second || loading} onClick={() => setShowPreview(true)} style={{ marginTop: 20 }}>Simuler l'échange</button>
    {preview && <section aria-live="polite" style={{ marginTop: 20 }}>
      {preview.valid ? <>
        <h2>Après échange (simulation)</h2>
        <p>{first?.title} → {formatDate(preview.first.startsAt)}</p>
        <p>{second?.title} → {formatDate(preview.second.startsAt)}</p>
        {first?.exchangeSupported && second?.exchangeSupported && ["reservation", "championship", "tournament"].includes(first.sourceKind) && ["reservation", "championship", "tournament"].includes(second.sourceKind) ? <><p>La confirmation demande au serveur de vérifier les droits et les conflits avant tout changement.</p><button type="button" disabled={busy} onClick={() => void confirmExchange()}>{busy ? "Échange en cours…" : "Confirmer l’échange des deux occupations"}</button></> : <p>Échange réel entre championnats, tournois et autres occupations : moteur métier en cours de développement.</p>}
      </> : <><h2>Échange impossible</h2><ul>{preview.errors.map(e => <li key={e}>{e}</li>)}</ul></>}
    </section>}
  </main>;
}
