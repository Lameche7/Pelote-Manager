import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
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
  type TvWeekItem,
} from "@/features/tv/services/tvDisplayService";
import "./TvDisplayPage.css";
import "./TvWeeklyView.css";

const TV_VIEW_DURATION_MS = 60_000;
const MAX_WEEK_ITEMS_PER_DAY = 5;

const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const weekDayFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
});

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
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

const dateFromIso = (value: string | null, fallback = new Date()) => {
  if (!value) return fallback;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return fallback;

  return new Date(Date.UTC(year, month - 1, day, 12));
};

const formatDisplayDate = (value: string | null, fallback: Date) =>
  dateFormatter.format(dateFromIso(value, fallback));

const slotLabel = (slot: TvDisplaySlot) => {
  if (slot.status === "available") return "Disponible";
  if (slot.status === "reserved") return "Réservé";
  return "Indisponible";
};

const weekItemLabel = (item: TvWeekItem) =>
  item.status === "reserved" ? "Réservé" : "Indisponible";

export function TvDisplayPage() {
  const { token = "" } = useParams<{ token: string }>();
  const tokenIsValid = tokenPattern.test(token);
  const [display, setDisplay] = useState<TvDisplay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [activeView, setActiveView] = useState<"today" | "week">("today");

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
          weekStart: null,
          weekEnd: null,
          weekDays: [],
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
    if (!tokenIsValid || display?.status === "invalid") return;

    const refresh = window.setInterval(
      () => void loadDisplay(false),
      (display?.refreshIntervalSeconds ?? 30) * 1_000,
    );

    return () => window.clearInterval(refresh);
  }, [
    display?.refreshIntervalSeconds,
    display?.status,
    loadDisplay,
    tokenIsValid,
  ]);

  useEffect(() => {
    if (display?.status !== "ready") return;

    const rotation = window.setInterval(() => {
      setActiveView((current) => (current === "today" ? "week" : "today"));
    }, TV_VIEW_DURATION_MS);

    return () => window.clearInterval(rotation);
  }, [display?.status]);

  const clubName = display?.clubName || CLUB_CONFIG.name;
  const logoUrl = display?.clubLogoUrl || CLUB_CONFIG.logoUrl;
  const displayedDate = useMemo(
    () => formatDisplayDate(display?.displayDate ?? null, now),
    [display?.displayDate, now],
  );
  const displayedWeek = useMemo(() => {
    if (!display?.weekStart || !display.weekEnd) return "Semaine en cours";

    return `Du ${compactDateFormatter.format(
      dateFromIso(display.weekStart),
    )} au ${compactDateFormatter.format(dateFromIso(display.weekEnd))}`;
  }, [display?.weekEnd, display?.weekStart]);

  useEffect(() => {
    document.title =
      display?.status === "ready" ? `Mode TV — ${clubName}` : "Mode TV";
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
        <p>L’écran tente automatiquement de se reconnecter.</p>
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
            <p className="tv-display__eyebrow">
              {activeView === "today"
                ? "Réservations du jour"
                : "Planning de la semaine"}
            </p>
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

      {activeView === "today" ? (
        <section
          className="tv-display__resources tv-display__view"
          aria-label="Créneaux du jour par terrain"
          key="today"
        >
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
      ) : (
        <section
          className="tv-display__week tv-display__view"
          aria-label="Planning des réservations de la semaine"
          key="week"
        >
          <header className="tv-display__week-heading">
            <div>
              <CalendarRange aria-hidden="true" />
              <div>
                <h2>Vue de la semaine</h2>
                <p>{displayedWeek}</p>
              </div>
            </div>
            <span>Réservations et indisponibilités</span>
          </header>

          <div className="tv-display__week-grid">
            {display.weekDays.map((day) => {
              const dayDate = dateFromIso(day.date);
              const visibleItems = day.items.slice(0, MAX_WEEK_ITEMS_PER_DAY);
              const hiddenCount = day.items.length - visibleItems.length;
              const isToday = day.date === display.displayDate;

              return (
                <article
                  className={`tv-display__week-day${isToday ? " tv-display__week-day--today" : ""}`}
                  key={day.date}
                >
                  <header>
                    <span>{weekDayFormatter.format(dayDate)}</span>
                    <strong>{compactDateFormatter.format(dayDate)}</strong>
                  </header>

                  <div className="tv-display__week-items">
                    {visibleItems.length === 0 ? (
                      <p className="tv-display__week-empty">
                        Aucun créneau occupé
                      </p>
                    ) : (
                      visibleItems.map((item) => (
                        <div
                          className={`tv-display__week-item tv-display__week-item--${item.status}`}
                          key={`${item.resourceId}-${item.startsAt}`}
                        >
                          <time dateTime={item.startsAt}>
                            {timeFormatter.format(new Date(item.startsAt))}
                            {"–"}
                            {timeFormatter.format(new Date(item.endsAt))}
                          </time>
                          <strong>{item.displayName}</strong>
                          <span>
                            {item.resourceName} · {weekItemLabel(item)}
                          </span>
                        </div>
                      ))
                    )}

                    {hiddenCount > 0 && (
                      <p className="tv-display__week-more">
                        + {hiddenCount} autre{hiddenCount > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <footer className="tv-display__footer">
        <span>
          {activeView === "today" ? (
            <>
              <Clock3 aria-hidden="true" />
              Affichage {display.displayStartTime}–{display.displayEndTime}
            </>
          ) : (
            <>
              <CalendarRange aria-hidden="true" />
              {displayedWeek}
            </>
          )}
        </span>
        <span className="tv-display__view-indicator">
          <i className={activeView === "today" ? "is-active" : ""} />
          <i className={activeView === "week" ? "is-active" : ""} />
          Alternance toutes les 60 secondes
        </span>
        <span>
          <RefreshCw aria-hidden="true" />
          Données actualisées toutes les {display.refreshIntervalSeconds}{" "}
          secondes
        </span>
      </footer>
    </main>
  );
}
