import { useState } from "react";
import { previewSwap, type Slot, type SlotKind } from "../services/slotExchangePreview";

const kinds: { value: SlotKind; label: string }[] = [
  { value: "championship", label: "Championnat" },
  { value: "tournament", label: "Tournoi" },
  { value: "reservation", label: "Réservation classique" },
  { value: "permanent", label: "Créneau permanent" },
];
const empty = (): Slot => ({ id: "", kind: "championship", resourceId: "", startsAt: "", endsAt: "", editable: true });

function SlotFields({ title, slot, change }: { title: string; slot: Slot; change: (slot: Slot) => void }) {
  return <fieldset style={{ display: "grid", gap: 12, padding: 20, border: "1px solid #888", borderRadius: 12 }}>
    <legend>{title}</legend>
    <label>Type d'occupation <select value={slot.kind} onChange={e => change({ ...slot, kind: e.target.value as SlotKind })}>
      {kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
    </select></label>
    <label>Identifiant de l'occupation <input value={slot.id} onChange={e => change({ ...slot, id: e.target.value })} placeholder="À sélectionner dans le calendrier" /></label>
    <label>Identifiant du terrain <input value={slot.resourceId} onChange={e => change({ ...slot, resourceId: e.target.value })} /></label>
    <label>Début <input type="datetime-local" value={slot.startsAt} onChange={e => change({ ...slot, startsAt: e.target.value })} /></label>
    <label>Fin <input type="datetime-local" value={slot.endsAt} onChange={e => change({ ...slot, endsAt: e.target.value })} /></label>
  </fieldset>;
}

export function AdminSlotExchangePage() {
  const [first, setFirst] = useState<Slot>(empty);
  const [second, setSecond] = useState<Slot>(empty);
  const [showPreview, setShowPreview] = useState(false);
  const preview = showPreview ? previewSwap(first, second) : null;
  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
    <h1>Échanger deux créneaux</h1>
    <p>Prototype de simulation uniquement : aucun déplacement n'est enregistré.</p>
    <p>La sélection automatique dans le calendrier et la validation des conflits en base restent à connecter.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <SlotFields title="Occupation A" slot={first} change={v => { setFirst(v); setShowPreview(false); }} />
      <SlotFields title="Occupation B" slot={second} change={v => { setSecond(v); setShowPreview(false); }} />
    </div>
    <button type="button" onClick={() => setShowPreview(true)} style={{ marginTop: 20 }}>Simuler l'échange</button>
    {preview && <section aria-live="polite" style={{ marginTop: 20 }}>
      {preview.valid ? <>
        <h2>Simulation avant / après</h2>
        <p>A → {preview.first.resourceId}, {preview.first.startsAt} – {preview.first.endsAt}</p>
        <p>B → {preview.second.resourceId}, {preview.second.startsAt} – {preview.second.endsAt}</p>
        <p>Simulation locale uniquement. Les conflits et autorisations restent à vérifier en base.</p>
      </> : <><h2>Échange impossible</h2><ul>{preview.errors.map(e => <li key={e}>{e}</li>)}</ul></>}
    </section>}
  </main>;
}
