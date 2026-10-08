import { useEffect, useMemo, useState } from "react";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { CalendarOccupation, ReservableResource } from "@/features/reservations/domain/calendar";
import { previewSwap, type Slot } from "../services/slotExchangePreview";

const today = () => new Date().toLocaleDateString("en-CA");
const formatDate = (value: string) => new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const classify = (item: CalendarOccupation): Slot["kind"] =>
  item.occupationType === "reservation" ? "reservation" : "tournament";
const toSlot = (item: CalendarOccupation): Slot => ({
  id: item.id, kind: classify(item), resourceId: item.resourceId,
  startsAt: item.startsAt, endsAt: item.endsAt, editable: true,
});

export function AdminSlotExchangePage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<CalendarOccupation[]>([]);
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
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
    reservationCalendarService.listOccupations(resourceId, from.toISOString(), until.toISOString())
      .then(data => { if (active) setItems(data); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Impossible de charger le planning."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [resourceId, date]);
  const first = items.find(item => item.id === firstId);
  const second = items.find(item => item.id === secondId);
  const preview = useMemo(() => showPreview && first && second ? previewSwap(toSlot(first), toSlot(second)) : null, [showPreview, first, second]);
  const option = (item: CalendarOccupation) => `${formatDate(item.startsAt)} — ${item.title}`;
  return <main style={{ maxWidth: 1050, margin: "0 auto", padding: 24 }}>
    <h1>Échanger deux créneaux</h1>
    <p>Choisis deux occupations réelles du calendrier. Cette page simule l'échange, sans modifier les réservations.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
      <label>Terrain <select value={resourceId} onChange={e => setResourceId(e.target.value)}>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>À partir du <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <span>Occupations sur 7 jours</span>
    </div>
    {error && <p role="alert">{error}</p>}
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
        <p>Simulation indicative : les contraintes métier et conflits doivent encore être vérifiés en base.</p>
      </> : <><h2>Échange impossible</h2><ul>{preview.errors.map(e => <li key={e}>{e}</li>)}</ul></>}
    </section>}
  </main>;
}
