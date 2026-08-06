import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Monitor,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { CLUB_CONFIG } from "@/shared/config";
import {
  tvDisplayService,
  type TvDisplay,
  type TvDisplaySlot,
} from "@/features/tv/services/tvDisplayService";
import "./TvDisplayPage.css";

const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
});

const preciseTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const formatDisplayDate = (value: string | null, fallback: Date) => {
  if (!value) return dateFormatter.format(fallback);

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return dateFormatter.format(fallback);

  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
};

const slotLabel = (slot: TvDisplaySlot) => {
  if (slot.status === "available") return "Disponible";
  if (slot.status === "reserved") return "Réservé";
  return "Indisponible";
};

export function TvDisplayPage() {
  const { token = "" } = useParams<{ token: string }>();
  const tokenIsValid = tokenPattern.test(token);
  const [display, setDisplay] = useState<TvDisplay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const loadDisplay = useCallback(
    async (initialLoad = false) => {
      if (!tokenIsValid) {
        setDisplay({
          status: "invalid",
          clubName: null,
          clubLogoUrl: null,
          displayDate: null,
          displayStartTime: null,
          displayEndTime: null,
          refreshIntervalSeconds: 30,
          generatedAt: null,
          resources: [],
        });
        setIsLoading(false);
        return;
      }

      try {
        const nextDisplay = await tvDisplayService.getDisplay(token);
        setDisplay(nextDisplay);
        setRefreshError(null);
      } catch (loadError: unknown) {
        setRefreshError(
          loadError instanceof Error
            ? loadError.message
            : "Actualisation momentanément indisponible.",
        );
        if (initialLoad) setDisplay(null);
      } finally {
        if (initialLoad) setIsLoading(false);
      }
    },
    [token, tokenIsValid],
  );

  useEffect(() => {
    void loadDisplay(true);
  }, [loadDisplay]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!display || display.status === "invalid") return;

    const refresh = window.setInterval(
      () => void loadDisplay(false),
      display.refreshIntervalSeconds * 1_000,
    );

    return () => window.clearInterval(refresh);
  }, [display, loadDisplay]);

  const clubName = display?.clubName || CLUB_CONFIG.name;
  const logoUrl = display?.clubLogoUrl || CLUB_CONFIG.logoUrl;
  const displayedDate = useMemo(
    () => formatDisplayDate(display?.displayDate ?? null, now),
    [display?.displayDate, now],
  );

  useEffect(() => {
    document.title = display?.status === "ready" ? `Mode TV — ${clubName}` : "Mode TV";
  }, [clubName, display?.status]);

  if (isLoading) {
    return (
      <main className="tv-display tv-display--centered">
        <RefreshCw className="tv-display__spinner" aria-hidden="true" />
        <h1>Chargement du Mode TV…</h1>
      </main>
    );
  }

  if (!display) {
    return (
      <main className="tv-display tv-display--centered">
        <WifiOff aria-hidden="true" />
        <h1>Connexion momentanément indisponible</h1>
        <p>L’écran tentera de se reconnecter lors du prochain chargement.</p>
      </main>
    );
  }

  if (display.status === "invalid") {
    return (
      <main className="tv-display tv-display--centered">
        <Monitor aria-hidden="true" />
        <h1>Lien Mode TV invalide</h1>
        <p>Ce lien a expiré ou a été remplacé par une nouvelle adresse.</p>
      </main>
    );
  }

  if (display.status === "disabled") {
    return (
      <main className="tv-display tv-display--centered">
        <img className="tv-display__logo" src={logoUrl} alt={clubName} />
        <h1>{clubName}</h1>
        <p>Le Mode TV est actuellement désactivé.</p>
      </main>
    );
  }

  return (
    <main className="tv-display" aria-live="polite">
      <header className="tv-display__header">
        <div className="tv-display__identity">
          <img className="tv-display__logo" src={logoUrl} alt="" />
          <div>
            <p className="tv-display__eyebrow">Réservations du jour</p>
            <h1>{clubName}</h1>
          </div>
        </div>

        <div className="tv-display__clock" aria-label="Date et heure actuelles">
          <div>
            <CalendarDays aria-hidden="true" />
            <span>{displayedDate}</span>
          </div>
          <strong>{preciseTimeFormatter.format(now)}</strong>
        </div>
      </header>

      {refreshError && (
        <p className="tv-display__offline" role="status">
          <WifiOff aria-hidden="true" />
          Dernière actualisation conservée — reconnexion en cours.
        </p>
      )}

      <section className="tv-display__resources" aria-label="Créneaux par terrain">
        {display.resources.map((resource) => (
          <article className="tv-display__resource" key={resource.id}>
            <header>
              <Monitor aria-hidden="true" />
              <h2>{resource.name}</h2>
            </header>

            {resource.slots.length === 0 ? (
              <p className="tv-display__empty">
                Plus aucun créneau à afficher aujourd’hui.
              </p>
            ) : (
              <div className="tv-display__slots">
                {resource.slots.map((slot) => (
                  <div
                    className={`tv-display__slot tv-display__slot--${slot.status}`}
                    key={`${resource.id}-${slot.startsAt}`}
                  >
                    <time dateTime={slot.startsAt}>
                      {timeFormatter.format(new Date(slot.startsAt))}
                    </time>
                    <strong>{slotLabel(slot)}</strong>
                    <span>{slot.displayName || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      <footer className="tv-display__footer">
        <span>
          <Clock3 aria-hidden="true" />
          Affichage {display.displayStartTime}–{display.displayEndTime}
        </span>
        <span>
          <RefreshCw aria-hidden="true" />
          Actualisation toutes les {display.refreshIntervalSeconds} secondes
        </span>
      </footer>
    </main>
  );
}
