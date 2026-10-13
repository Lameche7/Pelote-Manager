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

const tvWeek = [
  { day: "Lun", slots: [["17:30","Réservation","reservation"],["18:30","Réservation","reservation"],["19:30","Entraînement","training"],["20:30","Réservation","reservation"]] },
  { day: "Mar", slots: [["17:30","Réservation","reservation"],["18:30","Tournoi 4e série","tournament"],["19:30","Réservation","reservation"],["20:30","Réservation","reservation"]] },
  { day: "Mer", slots: [["17:30","École de pelote","training"],["18:30","Réservation","reservation"],["19:30","Réservation","reservation"],["20:30","Tournoi 3e série","tournament"]] },
  { day: "Jeu", slots: [["17:30","Réservation","reservation"],["18:30","Réservation","reservation"],["19:30","Championnat","championship"],["20:30","Réservation","reservation"]] },
  { day: "Ven", slots: [["17:30","Réservation","reservation"],["18:30","Tournoi 3e série","tournament"],["19:30","Réservation","reservation"],["20:30","Entraînement","training"]] },
  { day: "Sam", slots: [["10:00","Championnat équipe 1","championship"],["15:00","Tournoi · Quart","tournament"],["18:30","Réservation","reservation"]] },
  { day: "Dim", slots: [["09:30","Championnat équipe 2","championship"],["14:30","Tournoi · Demi-finale","tournament"],["17:00","Animation club","training"]] },
] as const;
const tvWeekend = [
  { type: "TOURNOI", title: "Demi-finale 4e série", date: "Dimanche · 14 h 30" },
  { type: "CHAMPIONNAT", title: "Équipe 1 reçoit Pau", date: "Samedi · 10 h" },
  { type: "CHAMPIONNAT", title: "Équipe 2 en déplacement", date: "Dimanche · 9 h 30" },
] as const;

const reservationDemoWeek = [
 {day:"Lun",items:[["17 h 30","Réservable à partir de dimanche 8 h","opening"],["18 h 30","Réserver","book"],["19 h 30","Créneau à l’année","yearly"]]},
 {day:"Mar",items:[["17 h 30","Réservable à partir de lundi 8 h","opening"],["18 h 30","Réserver","book"],["20 h 30","Partie de championnat","championship"]]},
 {day:"Mer",items:[["17 h 30","Créneau à l’année","yearly"],["18 h 30","Réservable à partir de mardi 8 h","opening"],["19 h 30","Réserver","book"],["20 h 30","Réserver","book"]]},
 {day:"Jeu",items:[["17 h 30","Réserver","book"],["18 h 30","Réserver","book"],["19 h 30","Partie de championnat","championship"]]},
 {day:"Ven",items:[["17 h 30","Réservable à partir de jeudi 8 h","opening"],["18 h 30","Réserver","book"],["19 h 30","Créneau à l’année","yearly"],["20 h 30","Réserver","book"]]},
 {day:"Sam",items:[["10 h","Partie de championnat","championship"],["15 h","Réserver","book"],["18 h 30","Réserver","book"]]},
 {day:"Dim",items:[["9 h 30","Partie de championnat","championship"],["14 h 30","Réserver","book"],["17 h","Créneau à l’année","yearly"]]},
] as const;
const championshipDemoDays = [
 {day:"Lundi",start:"09:00",end:"18:00",enabled:false},
 {day:"Mardi",start:"09:00",end:"18:00",enabled:false},
 {day:"Mercredi",start:"09:00",end:"18:00",enabled:false},
 {day:"Jeudi",start:"09:00",end:"18:00",enabled:false},
 {day:"Vendredi",start:"16:30",end:"21:30",enabled:true},
 {day:"Samedi",start:"09:00",end:"21:00",enabled:true},
 {day:"Dimanche",start:"09:00",end:"21:00",enabled:true},
] as const;
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
            <div className="pilotoki-discovery__customizer-title">
              <strong>✦ Personnalisez votre club</strong>
              <span>Modifiez les éléments ci-dessous : l'aperçu s'actualise aussitôt.</span>
            </div>
            <div className="pilotoki-discovery__customizer-fields">
              <div className="pilotoki-discovery__club-field">
                <label htmlFor="pilotoki-demo-club">✎ Nom du club</label>
                <input id="pilotoki-demo-club" value={club} maxLength={45} title="Cliquez pour modifier le nom de votre club" onChange={(event) => setClub(event.target.value)} />
              </div>
              <div className="pilotoki-discovery__branding" aria-label="Personnalisation visuelle">
                <label className="pilotoki-discovery__upload">▧ {logo ? "Changer le logo" : "Choisir un logo"}
                  <input type="file" accept="image/*" aria-label="Importer le logo du club" onChange={(event) => readImage(event, setLogo)} />
                </label>
                <label className="pilotoki-discovery__upload">▧ {cover ? "Changer le fond" : "Choisir un fond"}
                  <input type="file" accept="image/*" aria-label="Importer une image de fond" onChange={(event) => readImage(event, setCover)} />
                </label>
                <label className="pilotoki-discovery__swatch">Couleur principale
                  <input type="color" value={primary} aria-label="Choisir la couleur principale" onChange={(event) => setPrimary(event.target.value)} />
                </label>
                <label className="pilotoki-discovery__swatch">Couleur des boutons
                  <input type="color" value={accent} aria-label="Choisir la couleur des boutons" onChange={(event) => setAccent(event.target.value)} />
                </label>
              </div>
              <div className="pilotoki-discovery__views" role="group" aria-label="Choisir une interface">
                <button type="button" className={view === "joueur" ? "active" : ""} aria-pressed={view === "joueur"} onClick={() => setView("joueur")}>Vue joueur</button>
                <button type="button" className={view === "administrateur" ? "active" : ""} aria-pressed={view === "administrateur"} onClick={() => setView("administrateur")}>Vue administrateur</button>
              </div>
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
  {view === "joueur" ? <>
    <h3>Réserver votre terrain · Toute la semaine</h3>
    <p>Une semaine de démonstration : les disponibilités et les droits de réservation sont différents selon le créneau.</p>
    <div className="pilotoki-discovery__booking-week">
      {reservationDemoWeek.map((day) => <div className="pilotoki-discovery__booking-day" key={day.day}>
        <strong className="pilotoki-discovery__booking-day-head">{day.day}</strong>
        {day.items.map(([time,label,type]) => <button type="button" key={time} className={`pilotoki-discovery__booking-card pilotoki-discovery__booking-card--${type}`} onClick={() => {setSelectedSlot(day.day+" · "+time);setReserved(true);}}>
          <span>{time}</span><strong>{label}</strong>
        </button>)}
      </div>)}
    </div>
    {reserved && <p className="pilotoki-discovery__success" role="status">{selectedSlot} : aperçu du créneau sélectionné. Aucune réservation réelle effectuée.</p>}
    <div className="pilotoki-discovery__booking-note"><strong>Un fonctionnement entièrement configurable</strong><p>L’administrateur règle les délais d’ouverture, les créneaux à l’année, les plages championnat, la durée, les tarifs, les quotas et les conditions d’annulation. Basculez sur « Vue administrateur » pour découvrir les paramètres.</p></div>
  </> : <>
    <h3>Administration · Paramètres des réservations</h3>
    <p>Exemple condensé des règles générales configurables par le club.</p>
    <div className="pilotoki-discovery__settings-card">
      <div className="pilotoki-discovery__settings-heading"><strong>Règles générales</strong><span>Paiement en ligne désactivé</span></div>
      <div className="pilotoki-discovery__settings-grid">
        {([["Paiement en ligne","Désactivé · confirmation immédiate"],["Délai pour régler les 4 parts","120 minutes"],["Anticipation licencié","72 heures"],["Anticipation non licencié","48 heures"],["Tarif licencié","16,00 €"],["Tarif non licencié","16,00 €"],["Durée d’un créneau","60 minutes"],["Pas du calendrier","60 minutes"],["Délai minimum avant réservation","0 minute"],["Délai d’annulation","8 heures avant"],["Quota licencié","20 réservations actives"],["Quota non licencié","20 réservations actives"]] as const).map(([label,value]) => <div className="pilotoki-discovery__setting" key={label}><strong>{label}</strong><span>{value}</span></div>)}
      </div>
      <p className="pilotoki-discovery__settings-hint">Démonstration en lecture seule. Les valeurs sont entièrement modifiables dans l’administration réelle.</p>
    </div>
  </>}
</div>}
              {feature === "tournois" && <div className="pilotoki-discovery__content">
                <div className="pilotoki-discovery__between"><h3>Tournoi du club · 4e série</h3><span className="pilotoki-discovery__preview-badge">Phase de poules</span></div>
                <div className="pilotoki-discovery__matches">{sampleMatches.map((match) => <div key={match.teams}><strong>{match.teams}</strong><span>{match.day} · {match.hour}</span><b>{match.score}</b></div>)}</div>
                <button type="button" className="pilotoki-discovery__cta" onClick={() => setRequested(true)}>{view === "joueur" ? "Demander un report (simulation)" : "Examiner les reports (simulation)"}</button>
                {requested && <p role="status" className="pilotoki-discovery__success">Le parcours de report est illustré. Aucune demande réelle n'a été envoyée.</p>}
              </div>}
              {feature === "championnats" && <div className="pilotoki-discovery__content">
  {view === "joueur" ? <>
    <h3>Mes championnats · Rencontre du week-end</h3>
    <p>Retrouvez votre prochaine partie, réservez un créneau championnat et saisissez les résultats après la rencontre.</p>
    <div className="pilotoki-discovery__champ-cards">
      <div className="pilotoki-discovery__champ-card"><span>DIMANCHE 25 OCTOBRE · 1re SÉRIE</span><strong>{club.trim() || "Mon club"} <em>VS</em> Club visiteur</strong><p>Programmation à confirmer · Trinquet principal</p><button type="button" onClick={() => setRequested(true)}>Réserver un créneau championnat</button></div>
      <div className="pilotoki-discovery__champ-card"><span>SAMEDI 24 OCTOBRE · 2e SÉRIE</span><strong>Club voisin <em>VS</em> {club.trim() || "Mon club"}</strong><p>15 h · Rencontre à l’extérieur</p><button type="button" onClick={() => setRequested(true)}>Consulter la rencontre et son résultat</button></div>
    </div>
    {requested && <p className="pilotoki-discovery__success" role="status">Parcours illustré uniquement : aucune réservation ni saisie réelle.</p>}
  </> : <>
    <div className="pilotoki-discovery__champ-admin-head"><span>CHAMPIONNATS</span><h3>Réservations championnat</h3><p>Accès anticipé aux plages dédiées pour les joueurs engagés, sans modifier les règles normales du club.</p></div>
    <div className="pilotoki-discovery__settings-card">
      <div className="pilotoki-discovery__settings-heading"><strong>50 joueurs éligibles</strong><span>Selon les effectifs et le rattachement des comptes</span></div>
      <div className="pilotoki-discovery__settings-grid"><div className="pilotoki-discovery__setting"><strong>Accès anticipé championnat</strong><span>☑ Activé</span></div><div className="pilotoki-discovery__setting"><strong>Réservable à l’avance</strong><span>90 jours</span></div><div className="pilotoki-discovery__setting"><strong>Maximum de réservations actives</strong><span>20</span></div></div>
    </div>
    <div className="pilotoki-discovery__settings-card"><strong>Paiement d’une rencontre de championnat</strong><p>◉ Sans paiement · confirmation immédiate à 0 €</p><p>○ Tarification habituelle du club (alternative)</p></div>
    <div className="pilotoki-discovery__settings-card"><strong>Terrains concernés</strong><p>☑ Trinquet Robert Cathala</p></div>
    <div className="pilotoki-discovery__settings-card"><strong>Plages réservées championnat</strong><p>Jours et horaires entièrement modifiables.</p><div className="pilotoki-discovery__champ-days">{championshipDemoDays.map(day => <div key={day.day} className={day.enabled ? "is-enabled" : ""}><span>{day.enabled ? "☑" : "☐"} {day.day}</span><strong>{day.start} → {day.end}</strong></div>)}</div></div>
    <p className="pilotoki-discovery__settings-hint">Maquette condensée en lecture seule, fidèle aux réglages disponibles dans l’administration du club.</p>
  </>}
</div>}
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
                    <button type="button" className={tvSlide === "programme" ? "active" : ""} aria-pressed={tvSlide === "programme"} onClick={() => setTvSlide("programme")}>Planning semaine</button>
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
                        <div className="pilotoki-discovery__tv-title"><small>VOTRE CLUB, TOUTE LA SEMAINE</small><h4>Planning hebdomadaire</h4><span className="pilotoki-discovery__tv-tonight">● CE SOIR · 3 PARTIES À SUIVRE</span></div>
                        <div className="pilotoki-discovery__tv-week">
                          {tvWeek.map((day) => <div className="pilotoki-discovery__tv-day" key={day.day}>
                            <strong className="pilotoki-discovery__tv-day-label">{day.day}</strong>
                            {day.slots.map(([time, label, type]) => <div key={time} className={`pilotoki-discovery__tv-slot pilotoki-discovery__tv-slot--${type}`}><span>{time}</span><strong>{label}</strong></div>)}
                          </div>)}
                        </div>
                        <div className="pilotoki-discovery__tv-weekend">
                          <div className="pilotoki-discovery__tv-weekend-title"><small>À NE PAS MANQUER</small><strong>Tournois & championnats ce week-end</strong></div>
                          <div className="pilotoki-discovery__tv-weekend-cards">{tvWeekend.map((event) => <div className="pilotoki-discovery__tv-weekend-card" key={event.title}><span>{event.type}</span><strong>{event.title}</strong><small>{event.date}</small></div>)}</div>
                        </div>
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
