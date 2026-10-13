import { useState, type ChangeEvent } from "react";
import { NetworkNavigation } from "@/features/network/components/NetworkNavigation";
import "./NetworkDirectoryPage.css";
import "./NetworkDiscoveryDemoPage.css";

type Feature = "reservations" | "tournois" | "championnats" | "arbitrage" | "notifications" | "tv";
type View = "joueur" | "administrateur";
const features: { id: Feature; label: string; description: string }[] = [
  { id: "reservations", label: "Réservations", description: "Réserver un terrain, suivre les créneaux et les disponibilités" },
  { id: "tournois", label: "Tournois", description: "Suivre les poules, les parties, les classements et les reports" },
  { id: "championnats", label: "Championnats", description: "Programmer les rencontres et suivre les résultats" },
  { id: "arbitrage", label: "Arbitrage", description: "Organiser les arbitres de chaque créneau" },
  { id: "notifications", label: "Notifications", description: "Informer les joueurs des rendez-vous et des changements" },
  { id: "tv", label: "Mode TV", description: "Animer les écrans du trinquet, du club-house ou d’un espace commun" },
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
  const [tvSlide, setTvSlide] = useState<"programme" | "resultats" | "infos">("programme");
  const active = features.find((item) => item.id === feature)!;
  const primaryText = textOn(primary);
  const accentText = textOn(accent);
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
              {feature === "tv" && (
                <div className="pilotoki-discovery__content">
                  <h3>La vie du club sur grand écran</h3>
                  <p>
                    Une télévision dans le trinquet, au bar ou dans le club-house peut afficher
                    en continu les prochains matchs, les résultats et les annonces du club,
                    sans que les visiteurs aient besoin de consulter leur téléphone.
                  </p>
                  <div className="pilotoki-discovery__slots" role="group" aria-label="Choisir un affichage TV">
                    <button type="button" className={tvSlide === "programme" ? "active" : ""} aria-pressed={tvSlide === "programme"} onClick={() => setTvSlide("programme")}>Programme</button>
                    <button type="button" className={tvSlide === "resultats" ? "active" : ""} aria-pressed={tvSlide === "resultats"} onClick={() => setTvSlide("resultats")}>Résultats</button>
                    <button type="button" className={tvSlide === "infos" ? "active" : ""} aria-pressed={tvSlide === "infos"} onClick={() => setTvSlide("infos")}>Infos club</button>
                  </div>
                  <div className="pilotoki-discovery__tv" aria-label="Simulation de l'affichage sur une télévision">
                    <div className="pilotoki-discovery__tv-atmosphere" style={cover ? { backgroundImage: "linear-gradient(125deg, #061b24e8, #061b24a6), url(" + JSON.stringify(cover) + ")" } : undefined} />
                    <div className="pilotoki-discovery__tv-head">
                      <div className="pilotoki-discovery__tv-brand">
                        {logo ? <img src={logo} alt="Logo du club" /> : <span className="pilotoki-discovery__tv-initial">P</span>}
                        <div><small>LE CLUB EN DIRECT</small><strong>{club.trim() || "Mon club de pelote"}</strong></div>
                      </div>
                      <span className="pilotoki-discovery__tv-live"><span aria-hidden="true">●</span> PILOTOKI TV</span>
                    </div>
                    <div className="pilotoki-discovery__tv-content">
                      {tvSlide === "programme" && <>
                        <div className="pilotoki-discovery__tv-title"><small>CE SOIR AU TRINQUET</small><h4>Les rencontres à l'affiche</h4></div>
                        <div className="pilotoki-discovery__tv-match"><div className="pilotoki-discovery__tv-time"><strong>19:30</strong><span>TRINQUET 1</span></div><div className="pilotoki-discovery__tv-versus"><strong>Martin / Dupont</strong><span>VS</span><strong>Bernard / Petit</strong></div><span className="pilotoki-discovery__tv-pill">4e série</span></div>
                        <div className="pilotoki-discovery__tv-match"><div className="pilotoki-discovery__tv-time"><strong>20:30</strong><span>TRINQUET 1</span></div><div className="pilotoki-discovery__tv-versus"><strong>Lacaze / Durand</strong><span>VS</span><strong>Barbé / Lopez</strong></div><span className="pilotoki-discovery__tv-pill">3e série</span></div>
                      </>}
                      {tvSlide === "resultats" && <>
                        <div className="pilotoki-discovery__tv-title"><small>LES DERNIERS MATCHS</small><h4>Résultats du club</h4></div>
                        <div className="pilotoki-discovery__tv-scoreboard"><div><span>Martin / Dupont</span><strong>40</strong></div><span className="pilotoki-discovery__tv-score-separator">—</span><div><strong>32</strong><span>Bernard / Petit</span></div></div>
                        <div className="pilotoki-discovery__tv-score-note">VICTOIRE · 4e SÉRIE</div>
                        <div className="pilotoki-discovery__tv-match pilotoki-discovery__tv-match--small"><strong>Lacaze / Durand</strong><span>40 — 36</span><strong>Barbé / Lopez</strong></div>
                      </>}
                      {tvSlide === "infos" && <>
                        <div className="pilotoki-discovery__tv-title"><small>LA VIE DU CLUB</small><h4>Bienvenue chez nous !</h4></div>
                        <div className="pilotoki-discovery__tv-announcements"><div><span className="pilotoki-discovery__tv-emoji">🏆</span><strong>Tournoi du club</strong><span>Les inscriptions sont ouvertes !</span></div><div><span className="pilotoki-discovery__tv-emoji">📣</span><strong>Prochaine animation</strong><span>Retrouvons-nous au trinquet</span></div></div>
                        <div className="pilotoki-discovery__tv-partner">ESPACE PARTENAIRES & ANNONCES DU CLUB</div>
                      </>}
                    </div>
                    <div className="pilotoki-discovery__tv-footer"><span>PROGRAMME · RÉSULTATS · VIE DU CLUB</span><strong>Propulsé par PILOTOKI</strong></div>
                  </div>
                  <p>Le club peut personnaliser le contenu et diffuser ses informations, y compris ses événements et partenaires. En pratique, un écran connecté (ou une TV avec boîtier type Fire TV) suffit pour ouvrir la page Mode TV. Les trois écrans ci-dessus sont des exemples fictifs.</p>
                </div>
              )}
              <aside className="pilotoki-discovery__home-preview" aria-label="Aperçu de l'accueil personnalisé">
                <p>Aperçu de votre accueil · {view === "joueur" ? "Joueur" : "Administrateur"}</p>
                <div className="pilotoki-discovery__mini-screen">
                  <header className="pilotoki-discovery__mini-topbar" style={{ background: primary, color: primaryText }}>
                    <img src="/branding/pilotoki-wordmark.png" alt="Pilotoki" />
                    <span className="pilotoki-discovery__mini-club">{club.trim() || "Mon club de pelote"}</span>
                    <nav aria-label="Aperçu navigation"><span>Accueil</span><span>Réservations</span><span>Mon espace</span>{view === "administrateur" && <span>Administration</span>}</nav>
                  </header>
                  <div className="pilotoki-discovery__mini-cover" style={cover ? { backgroundImage: "linear-gradient(#0008, #0009), url(" + JSON.stringify(cover) + ")", color: "#ffffff" } : { background: primary, color: primaryText }}>
                    {logo ? <img src={logo} alt="Logo du club" /> : <span className="pilotoki-discovery__mini-emblem">P</span>}
                    <strong>{club.trim() || "Mon club de pelote"}</strong>
                    <div className="pilotoki-discovery__mini-powered">PILOTOKI</div>
                    <small>Bienvenue dans votre club</small>
                    <div className="pilotoki-discovery__mini-actions">
                      <span>Réserver un créneau</span><span>{view === "joueur" ? "Accéder à mon compte" : "Administration"}</span><span>Découvrir PILOTOKI</span>
                    </div>
                  </div>
                  <div className="pilotoki-discovery__mini-feature-strip"><span>RÉSERVATIONS SIMPLES</span><span>PAIEMENT SÉCURISÉ</span><span>INFOS EN DIRECT</span></div>
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
