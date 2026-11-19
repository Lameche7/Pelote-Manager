import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";
import {
  Clapperboard,
  ExternalLink,
  PlayCircle,
  Radio,
  Video,
} from "lucide-react";
import { NetworkHero } from "@/features/network/components/NetworkHero";
import "./NetworkDirectoryPage.css";
import "./NetworkVideosPage.css";

const PILOTOKI_YOUTUBE_CHANNEL =
  "https://www.youtube.com/channel/UCAIME5j0y9DdiEQNyttO_jw";

type NetworkVideo = {
  id: string;
  club_id: string;
  title: string;
  youtube_video_id: string;
  status: "live" | "replay";
  source_type: "tournoi" | "championnat" | "other";
  started_at: string | null;
};

export function NetworkVideosPage() {
  const [videos, setVideos] = useState<NetworkVideo[]>([]);
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [clubFilter, setClubFilter] = useState("all");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("pilotoki_live_videos")
        .select(
          "id,club_id,title,youtube_video_id,status,source_type,started_at",
        )
        .in("status", ["live", "replay"])
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setLoadError(true);
        return;
      }
      setVideos((data ?? []) as NetworkVideo[]);
      const { data: clubs } = await supabase.from("clubs").select("id,name");
      if (active) {
        setClubNames(
          Object.fromEntries((clubs ?? []).map((club) => [club.id, club.name])),
        );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const clubIds = useMemo(
    () => [...new Set(videos.map((video) => video.club_id))],
    [videos],
  );
  const visible = useMemo(
    () =>
      videos.filter(
        (video) => clubFilter === "all" || video.club_id === clubFilter,
      ),
    [videos, clubFilter],
  );
  const renderVideos = (status: "live" | "replay") => {
    const entries = visible.filter((video) => video.status === status);
    return entries.length ? (
      <div className="network-videos__video-list">
        {entries.map((video) => (
          <a
            key={video.id}
            className="network-videos__video-card"
            href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>{video.title}</strong>
            <span>
              {clubNames[video.club_id] || "Club Pilotoki"} ·{" "}
              {video.source_type === "tournoi"
                ? "Tournoi"
                : video.source_type === "championnat"
                  ? "Championnat"
                  : "Partie"}
            </span>
            <ExternalLink aria-hidden="true" />
          </a>
        ))}
      </div>
    ) : null;
  };

  return (
    <main className="network-directory network-videos">
      <NetworkHero variant="videos" />
      <div className="network-videos__body">
        <section
          className="network-videos__intro"
          aria-label="Présentation des vidéos"
        >
          <p className="network-directory__eyebrow">Pilotoki Live</p>
          <h2>Vivez les parties, même à distance.</h2>
          <p>
            Les directs et les replays des clubs du réseau seront bientôt
            disponibles ici, au même endroit que les tournois et les résultats.
          </p>
        </section>

        {clubIds.length > 1 && (
          <label className="network-videos__filter">
            Filtrer les vidéos par club
            <select
              value={clubFilter}
              onChange={(event) => setClubFilter(event.target.value)}
            >
              <option value="all">Tous les clubs</option>
              {clubIds.map((id) => (
                <option key={id} value={id}>
                  {clubNames[id] || "Club Pilotoki"}
                </option>
              ))}
            </select>
          </label>
        )}
        {loadError && (
          <p role="status">Vidéothèque momentanément indisponible.</p>
        )}
        <div className="network-videos__sections">
          <section
            className="network-videos__panel"
            id="directs"
            aria-labelledby="directs-heading"
          >
            <div className="network-videos__panel-heading">
              <span className="network-videos__icon network-videos__icon--live">
                <Radio aria-hidden="true" />
              </span>
              <div>
                <p className="network-directory__eyebrow">Pilotoki Live</p>
                <h2 id="directs-heading">En direct</h2>
              </div>
            </div>
            {renderVideos("live") || (
              <div className="network-videos__empty">
                <Video aria-hidden="true" />
                <strong>Aucun direct disponible actuellement</strong>
                <p>
                  Dès que les clubs pourront diffuser leurs rencontres depuis
                  Pilotoki, leurs directs apparaîtront ici.
                </p>
                <span className="network-videos__coming">
                  Bientôt disponible
                </span>
              </div>
            )}
          </section>

          <section
            className="network-videos__panel"
            id="replays"
            aria-labelledby="replays-heading"
          >
            <div className="network-videos__panel-heading">
              <span className="network-videos__icon">
                <Clapperboard aria-hidden="true" />
              </span>
              <div>
                <p className="network-directory__eyebrow">Vidéothèque</p>
                <h2 id="replays-heading">Replays</h2>
              </div>
            </div>
            {renderVideos("replay") || (
              <div className="network-videos__empty">
                <PlayCircle aria-hidden="true" />
                <strong>Les premières vidéos arrivent bientôt</strong>
                <p>
                  Retrouvez prochainement les rencontres enregistrées et
                  accessibles depuis les clubs du réseau.
                </p>
                <span className="network-videos__coming">
                  Bientôt disponible
                </span>
              </div>
            )}
          </section>
        </div>

        <section
          className="network-videos__club"
          aria-labelledby="video-club-heading"
        >
          <div>
            <p className="network-directory__eyebrow">Chaîne commune</p>
            <h2 id="video-club-heading">Pilotoki sur YouTube</h2>
            <p>
              Une chaîne YouTube Pilotoki pour les directs et replays de tous
              les clubs. Chaque vidéo sera rattachée à son club d'origine et à
              sa compétition.
            </p>
          </div>
          <a
            href={PILOTOKI_YOUTUBE_CHANNEL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Découvrir la chaîne YouTube Pilotoki
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
