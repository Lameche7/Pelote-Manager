import { useState, type ChangeEvent } from "react";
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
/** Pick the accessible text color for a user-selected solid background. */
function textOn(background: string): string {
  const hex = background.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#152722"
    : "#ffffff";
}

function mixColors(a: string, b: string, ratio: number): string {
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i+2),16)*(1-ratio)+parseInt(b.slice(i,i+2),16)*ratio).toString(16).padStart(2,"0")).join("");
}

export function NetworkDiscoveryPage() {
  const [club, setClub] = useState("Mon club de pelote");
  const [primary, setPrimary] = useState("#155a43");
  const [accent, setAccent] = useState("#b72520");
  const [logo, setLogo] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const readImage = (event: ChangeEvent<HTMLInputElement>, setter: (value: string | null) => void) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 3 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setter(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };
  const [feature, setFeature] = useState<Feature>("reservations");
  const [view, setView] = useState<View>("joueur");
  const [selectedSlot, setSelectedSlot] = useState("19 h 30");
  const [reserved, setReserved] = useState(false);
  const [requested, setRequested] = useState(false);
  const active = features.find((item) => item.id === feature)!;
  const primaryText = textOn(primary);
  const accentText = textOn(accent);
  const accentLabel = accentText === "#152722" ? "#17392f" : accent;
  const soft = mixColors(primary, "#ffffff", 0.90);
  const theme = {
    "--club-primary": primary,
    "--club-on-primary": primaryText,
    "--club-accent": accent,
    "--club-on-accent": accentText,
    "--club-soft": soft,
    "--club-border": mixColors(primary, "#ffffff", 0.72),
    "--club-selected": primaryText === "#ffffff" ? mixColors(primary, "#ffffff", 0.22) : mixColors(primary, "#000000", 0.13),
    "--club-heading": textOn(soft),
    "--club-accent-soft": mixColors(accent, "#ffffff", 0.86),
    "--club-on-accent-soft": textOn(mixColors(accent, "#ffffff", 0.86)),
  } as React.CSSProperties;

  return (
    <main className="network-directory">
      <div className="network-directory__subpage-header"><NetworkNavigation /></div>
      <div className="pilotoki-discovery" style={theme}>
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
            <div className="pilotoki-discovery__branding" aria-label="Personnalisation visuelle">
              <label className="pilotoki-discovery__upload">Logo<input type="file" accept="image/*" aria-label="Choisir le logo" onChange={(event) => readImage(event, setLogo)} /></label>
              <label className="pilotoki-discovery__upload">Fond<input type="file" accept="image/*" aria-label="Choisir le fond d'écran" onChange={(event) => readImage(event, setCover)} /></label>
              <label className="pilotoki-discovery__swatch">Principal<input type="color" value={primary} aria-label="Couleur principale" onChange={(event) => setPrimary(event.target.value)} /></label>
              <label className="pilotoki-discovery__swatch">Accent<input type="color" value={accent} aria-label="Couleur d'accent" onChange={(event) => setAccent(event.target.value)} /></label>
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
              <aside className="pilotoki-discovery__home-preview" aria-label="Aperçu de l'accueil personnalisé">
                <p>Aperçu de votre accueil · {view === "joueur" ? "Joueur" : "Administrateur"}</p>
                <div className="pilotoki-discovery__mini-screen">
                  <div className="pilotoki-discovery__mini-topbar"><img src="/branding/pilotoki-wordmark.png" alt="Pilotoki" /><span>☰</span></div>
                  <div className="pilotoki-discovery__mini-cover" style={cover ? {backgroundImage:"linear-gradient(#0008,#0009), url("+JSON.stringify(cover)+")",color:"#fff"} : {background:primary,color:primaryText}}>
                    {logo ? <img src={logo} alt="Logo du club" /> : <span className="pilotoki-discovery__mini-emblem">P</span>}
                    <strong>{club.trim() || "Mon club de pelote"}</strong>
                  </div>
                  <nav className="pilotoki-discovery__mini-tabs" aria-label="Menus de l’aperçu"><span className="is-active">Accueil</span><span>Réservations</span><span>Tournois</span><span>Championnats</span></nav>
                  <div className="pilotoki-discovery__mini-body">
                    <span className="pilotoki-discovery__mini-welcome">Bienvenue dans votre club</span>
                    <b>{view === "joueur" ? "Mon espace joueur" : "Tableau de bord administrateur"}</b>
                    <div className="pilotoki-discovery__mini-tiles"><span>{view === "joueur" ? "Prochaine partie" : "Planning du club"}</span><span>{view === "joueur" ? "Mes réservations" : "Reports à traiter"}</span><span>{view === "joueur" ? "Classements" : "Résultats"}</span></div>
                    <div className="pilotoki-discovery__mini-action">{view === "joueur" ? "Réserver un terrain" : "Accéder à l’administration"}</div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
        <p className="pilotoki-discovery__disclaimer">Ce testeur est une simulation indépendante des données des clubs. Il permet de découvrir les usages de Pilotoki sans modifier les réservations, résultats ou comptes réels.</p>
      </div>
      <footer className="network-directory__footer">Pilotoki · Clubs et tournois</footer>
    </main>
  );
}
