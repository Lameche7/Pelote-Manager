import { useState } from "react";
import { NetworkNavigation } from "@/features/network/components/NetworkNavigation";
import "./NetworkDirectoryPage.css";
import "./NetworkDiscoveryDemoPage.css";

type Feature = "reservations" | "tournois" | "championnats" | "arbitrage" | "notifications";
type View = "joueur" | "administrateur";
const features: { id: Feature; label: string; description: string }[] = [
  { id: "reservations", label: "Réservations", description: "Réserver un terrain, suivre les créneaux et les disponibilités" },
  { id: "tournois", label: "Tournois", description: "Suivre les poules, les parties, les classements et les reports" },
  { id: "championnats", label: "Championnats", description: "Programmer les rencontres et suivre les résultats" },
  { id: "arbitrage", label: "Arbitrage", description: "Organiser les arbitres de chaque créneau" },
  { id: "notifications", label: "Notifications", description: "Informer les joueurs des rendez-vous et des changements" },
];
const sampleMatches = [
  { teams: "Martin / Dupont · Bernard / Petit", day: "Mardi 20 octobre", hour: "19 h 30", score: "—" },
  { teams: "Lacaze / Durand · Barbé / Lopez", day: "Jeudi 22 octobre", hour: "20 h 30", score: "40 – 32" },
];
export function NetworkDiscoveryPage() {
  const [club, setClub] = useState("Mon club de pelote");
  const [feature, setFeature] = useState<Feature>("reservations");
  const [view, setView] = useState<View>("joueur");
  const [selectedSlot, setSelectedSlot] = useState("19 h 30");
  const [reserved, setReserved] = useState(false);
  const [requested, setRequested] = useState(false);
  const active = features.find((item) => item.id === feature)!;
  return (
    <main className="network-directory">
      <div className="network-directory__subpage-header"><NetworkNavigation /></div>
      <div className="pilotoki-discovery">
        <section className="pilotoki-discovery__intro">
          <p className="network-directory__eyebrow">La plateforme de gestion des clubs</p>
          <h1>Découvrez tout ce que Pilotoki peut faire pour votre club.</h1>
          <p>Un testeur interactif intégré à Pilotoki. Explorez librement les fonctionnalités côté joueur et côté administrateur.</p>
        </section>
        <section className="pilotoki-discovery__workspace" aria-label="Testeur Pilotoki">
          <div className="pilotoki-discovery__controls">
            <div className="pilotoki-discovery__club-field">
              <label htmlFor="pilotoki-demo-club">Nom de votre club</label>
              <input id="pilotoki-demo-club" value={club} maxLength={45} onChange={(event) => setClub(event.target.value)} />
            </div>
            <div className="pilotoki-discovery__views" role="group" aria-label="Choisir une interface">
              <button type="button" className={view === "joueur" ? "active" : ""} aria-pressed={view === "joueur"} onClick={() => setView("joueur")}>Vue joueur</button>
              <button type="button" className={view === "administrateur" ? "active" : ""} aria-pressed={view === "administrateur"} onClick={() => setView("administrateur")}>Vue administrateur</button>
            </div>
          </div>
          <div className="pilotoki-discovery__body">
            <nav className="pilotoki-discovery__sidebar" aria-label="Fonctionnalités du testeur">
              {features.map((item) => (
                <button key={item.id} type="button" aria-current={feature === item.id ? "page" : undefined} className={feature === item.id ? "active" : ""} onClick={() => setFeature(item.id)}>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="pilotoki-discovery__panel">
              <div className="pilotoki-discovery__panel-heading">
                <div><span className="pilotoki-discovery__club-name">{club.trim() || "Mon club de pelote"}</span><h2>{active.label}</h2><p>{active.description}</p></div>
                <span className="pilotoki-discovery__preview-badge">Démonstration · {view === "joueur" ? "Joueur" : "Administration"}</span>
              </div>
              {feature === "reservations" && <div className="pilotoki-discovery__content">
                <h3>{view === "joueur" ? "Choisir un créneau" : "Planning des terrains"}</h3>
                <p>Mercredi 21 octobre 2026 · Trinquet principal</p>
                <div className="pilotoki-discovery__slots">{["17 h 30", "18 h 30", "19 h 30", "20 h 30"].map((hour) => <button type="button" key={hour} className={selectedSlot === hour ? "active" : ""} aria-pressed={selectedSlot === hour} onClick={() => { setSelectedSlot(hour); setReserved(false); }}>{hour}</button>)}</div>
                <button type="button" className="pilotoki-discovery__cta" onClick={() => setReserved(true)}>{view === "joueur" ? "Simuler la réservation" : "Bloquer ce créneau (simulation)"}</button>
                {reserved && <p role="status" className="pilotoki-discovery__success">Simulation enregistrée pour {selectedSlot}. Aucune réservation réelle n'a été créée.</p>}
              </div>}
              {feature === "tournois" && <div className="pilotoki-discovery__content">
                <div className="pilotoki-discovery__between"><h3>Tournoi du club · 4e série</h3><span className="pilotoki-discovery__preview-badge">Phase de poules</span></div>
                <div className="pilotoki-discovery__matches">{sampleMatches.map((match) => <div key={match.teams}><strong>{match.teams}</strong><span>{match.day} · {match.hour}</span><b>{match.score}</b></div>)}</div>
                <button type="button" className="pilotoki-discovery__cta" onClick={() => setRequested(true)}>{view === "joueur" ? "Demander un report (simulation)" : "Examiner les reports (simulation)"}</button>
                {requested && <p role="status" className="pilotoki-discovery__success">Le parcours de report est illustré. Aucune demande réelle n'a été envoyée.</p>}
              </div>}
              {feature === "championnats" && <div className="pilotoki-discovery__content"><h3>Rencontre de championnat</h3><p>Journée 4 · Dimanche 25 octobre 2026</p><div className="pilotoki-discovery__example"><strong>{club.trim() || "Mon club"} — Club visiteur</strong><span>1re série · Programmation à confirmer</span><span>{view === "joueur" ? "Consultez la rencontre et les résultats." : "Programmez la rencontre et validez les résultats."}</span></div></div>}
              {feature === "arbitrage" && <div className="pilotoki-discovery__content"><h3>Tableau d’arbitrage</h3><p>Chaque arbitre est associé à un créneau, même si une partie est déplacée.</p><div className="pilotoki-discovery__example"><strong>Jeudi 22 octobre · 19 h 30</strong><span>Trinquet principal</span><span>Arbitre : à désigner</span></div></div>}
              {feature === "notifications" && <div className="pilotoki-discovery__content"><h3>Les bonnes informations, au bon moment</h3><div className="pilotoki-discovery__example"><strong>Rappel de partie</strong><span>Votre partie est prévue demain à 19 h 30.</span></div><div className="pilotoki-discovery__example"><strong>Report de partie</strong><span>Une nouvelle date vous est proposée.</span></div><p>Les notifications présentées sont des exemples : aucun message n'est envoyé.</p></div>}
            </div>
          </div>
        </section>
        <p className="pilotoki-discovery__disclaimer">Ce testeur est une simulation indépendante des données des clubs. Il permet de découvrir les usages de Pilotoki sans modifier les réservations, résultats ou comptes réels.</p>
      </div>
      <footer className="network-directory__footer">Pilotoki · Clubs et tournois</footer>
    </main>
  );
}
