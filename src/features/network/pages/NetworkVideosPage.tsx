import { Clapperboard, ExternalLink, PlayCircle, Radio, Video } from "lucide-react";
import { NetworkHero } from "@/features/network/components/NetworkHero";
import "./NetworkDirectoryPage.css";
import "./NetworkVideosPage.css";

const PCL_YOUTUBE_CHANNEL =
  "https://www.youtube.com/channel/UCAIME5j0y9DdiEQNyttO_jw";

export function NetworkVideosPage() {
  return (
    <main className="network-directory network-videos">
      <NetworkHero variant="videos" />
      <div className="network-videos__body">
        <section className="network-videos__intro" aria-label="Présentation des vidéos">
          <p className="network-directory__eyebrow">Pilotoki Live</p>
          <h2>Vivez les parties, même à distance.</h2>
          <p>
            Les directs et les replays des clubs du réseau seront bientôt
            disponibles ici, au même endroit que les tournois et les résultats.
          </p>
        </section>

        <div className="network-videos__sections">
          <section className="network-videos__panel" id="directs" aria-labelledby="directs-heading">
            <div className="network-videos__panel-heading">
              <span className="network-videos__icon network-videos__icon--live">
                <Radio aria-hidden="true" />
              </span>
              <div>
                <p className="network-directory__eyebrow">Pilotoki Live</p>
                <h2 id="directs-heading">En direct</h2>
              </div>
            </div>
            <div className="network-videos__empty">
              <Video aria-hidden="true" />
              <strong>Aucun direct disponible actuellement</strong>
              <p>
                Dès que les clubs pourront diffuser leurs rencontres depuis
                Pilotoki, leurs directs apparaîtront ici.
              </p>
              <span className="network-videos__coming">Bientôt disponible</span>
            </div>
          </section>

          <section className="network-videos__panel" id="replays" aria-labelledby="replays-heading">
            <div className="network-videos__panel-heading">
              <span className="network-videos__icon">
                <Clapperboard aria-hidden="true" />
              </span>
              <div>
                <p className="network-directory__eyebrow">Vidéothèque</p>
                <h2 id="replays-heading">Replays</h2>
              </div>
            </div>
            <div className="network-videos__empty">
              <PlayCircle aria-hidden="true" />
              <strong>Les premières vidéos arrivent bientôt</strong>
              <p>
                Retrouvez prochainement les rencontres enregistrées et
                accessibles depuis les clubs du réseau.
              </p>
              <span className="network-videos__coming">Bientôt disponible</span>
            </div>
          </section>
        </div>

        <section className="network-videos__club" aria-labelledby="video-club-heading">
          <div>
            <p className="network-directory__eyebrow">Premier club pilote</p>
            <h2 id="video-club-heading">Pelotaris Club Lourdais</h2>
            <p>
              Le PCL prépare les premières diffusions Pilotoki Live. La chaîne
              YouTube du club est déjà créée, mais elle n'est pas encore
              connectée aux directs de Pilotoki.
            </p>
          </div>
          <a href={PCL_YOUTUBE_CHANNEL} target="_blank" rel="noopener noreferrer">
            Découvrir la chaîne YouTube du PCL
            <ExternalLink aria-hidden="true" />
          </a>
        </section>
      </div>
      <footer className="network-directory__footer">
        Pilotoki · Clubs, tournois et vidéos
      </footer>
    </main>
  );
}
