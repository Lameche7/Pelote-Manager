import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  Clock3,
  Handshake,
  Megaphone,
  Monitor,
  QrCode,
  RefreshCw,
  ShoppingBag,
  WifiOff,
} from "lucide-react";
import { useParams } from "react-router-dom";
import {
  publicEventService,
  type PublicEvent,
} from "@/features/home/services/publicEventService";
import { CLUB_CONFIG } from "@/shared/config";
import {
  tvDisplayService,
  type TvDisplay,
  type TvDisplaySlot,
  type TvWeekItem,
} from "@/features/tv/services/tvDisplayService";
import {
  tvMediaService,
  type TvMediaAsset,
} from "@/features/tv/services/tvMediaService";
import "./TvDisplayPage.css";
import "./TvWeeklyView.css";
import "./TvPromotionView.css";
import "./TvMediaGallery.css";

const TV_VIEW_DURATION_MS = 60_000;
const MAX_WEEK_ITEMS_PER_DAY = 5;
const MAX_TV_EVENTS = 3;
const MAX_SHOP_MEDIA = 6;
const MAX_PARTNER_MEDIA = 8;
const SHOP_URL =
  "https://www.helloasso.com/associations/pelotaris-club-lourdais/boutiques/dotations-2026";
const QR_ENDPOINT = "https://quickchart.io/qr";

type TvView = "today" | "week" | "club";

const TV_VIEW_ORDER: TvView[] = ["today", "week", "club"];

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

const eventDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
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

const buildQrImageUrl = (value: string) =>
  `${QR_ENDPOINT}?text=${encodeURIComponent(value)}&format=svg&size=280&margin=2&ecLevel=M`;

const nextTvView = (current: TvView): TvView => {
  const currentIndex = TV_VIEW_ORDER.indexOf(current);
  return TV_VIEW_ORDER[(currentIndex + 1) % TV_VIEW_ORDER.length] ?? "today";
};

const viewEyebrow = (view: TvView) => {
  if (view === "today") return "Réservations du jour";
  if (view === "week") return "Planning de la semaine";
  return "Boutique & partenaires";
};

const eventLocation = (event: PublicEvent) =>
  event.resourceNames.length > 0
    ? event.resourceNames.join(" · ")
    : event.typeName;

function QrCard({
  value,
  title,
  subtitle,
}: {
  value: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="tv-display__qr-card">
      <div className="tv-display__qr-image">
        <img
          src={buildQrImageUrl(value)}
          alt={`QR code — ${title}`}
          referrerPolicy="no-referrer"
        />
      </div>
      <div>
        <QrCode aria-hidden="true" />
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

export function TvDisplayPage() {
  const { token = "" } = useParams<{ token: string }>();
  const tokenIsValid = tokenPattern.test(token);
  const [display, setDisplay] = useState<TvDisplay | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<PublicEvent[]>([]);
  const [tvMedia, setTvMedia] = useState<TvMediaAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [activeView, setActiveView] = useState<TvView>("today");

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

  const loadUpcomingEvents = useCallback(async () => {
    try {
      const events = await publicEventService.listUpcomingEvents();
      setUpcomingEvents(events.slice(0, MAX_TV_EVENTS));
      setEventsError(false);
    } catch {
      setEventsError(true);
    }
  }, []);

  const loadTvMedia = useCallback(async () => {
    if (!tokenIsValid) return;

    try {
      setTvMedia(await tvMediaService.list(token));
    } catch {
      // Les médias promotionnels sont facultatifs : on conserve le dernier état connu.
    }
  }, [token, tokenIsValid]);

  useEffect(() => {
    void loadDisplay(true);
    void loadUpcomingEvents();
    void loadTvMedia();
  }, [loadDisplay, loadUpcomingEvents, loadTvMedia]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!tokenIsValid || display?.status === "invalid") return;

    const refresh = window.setInterval(
      () => {
        void loadDisplay(false);
        void loadUpcomingEvents();
        void loadTvMedia();
      },
      (display?.refreshIntervalSeconds ?? 30) * 1_000,
    );

    return () => window.clearInterval(refresh);
  }, [
    display?.refreshIntervalSeconds,
    display?.status,
    loadDisplay,
    loadUpcomingEvents,
    loadTvMedia,
    tokenIsValid,
  ]);

  useEffect(() => {
    if (display?.status !== "ready") return;

    const rotation = window.setInterval(() => {
      setActiveView(nextTvView);
    }, TV_VIEW_DURATION_MS);

    return () => window.clearInterval(rotation);
  }, [display?.status]);

  const clubName = display?.clubName || CLUB_CONFIG.name;
  const logoUrl = display?.clubLogoUrl || CLUB_CONFIG.logoUrl;
  const appUrl = window.location.origin;
  const shopMedia = useMemo(
    () => tvMedia.filter((item) => item.kind === "shop").slice(0, MAX_SHOP_MEDIA),
    [tvMedia],
  );
  const partnerMedia = useMemo(
    () =>
      tvMedia
        .filter((item) => item.kind === "partner")
        .slice(0, MAX_PARTNER_MEDIA),
    [tvMedia],
  );
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
            <p className="tv-display__eyebrow">{viewEyebrow(activeView)}</p>
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

      {activeView === "today" && (
        <section
          className="tv-display__today-layout tv-display__view"
          key="today"
        >
          <div
            className="tv-display__resources tv-display__resources--today"
            aria-label="Créneaux du jour par terrain"
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
          </div>

          <aside
            className="tv-display__today-aside"
            aria-label="Informations du club"
          >
            <section className="tv-display__events-panel">
              <header>
                <Megaphone aria-hidden="true" />
                <div>
                  <span>À noter</span>
                  <h2>Prochains évènements</h2>
                </div>
              </header>

              {upcomingEvents.length > 0 ? (
                <div className="tv-display__events-list">
                  {upcomingEvents.map((event) => (
                    <article className="tv-display__event" key={event.id}>
                      <time dateTime={event.startsAt}>
                        {eventDateFormatter.format(new Date(event.startsAt))}
                      </time>
                      <strong>{event.name}</strong>
                      <span>{eventLocation(event)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="tv-display__events-empty">
                  {eventsError
                    ? "Évènements momentanément indisponibles."
                    : "Aucun évènement public annoncé pour le moment."}
                </p>
              )}
            </section>

            <QrCard
              value={appUrl}
              title="Pelote Manager"
              subtitle="Scannez pour réserver et suivre la vie du club"
            />
          </aside>
        </section>
      )}

      {activeView === "week" && (
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

      {activeView === "club" && (
        <section
          className="tv-display__promotion tv-display__view"
          aria-label="Boutique et partenaires du club"
          key="club"
        >
          <div className="tv-display__promotion-main">
            <article className="tv-display__shop-panel">
              <div className="tv-display__shop-copy">
                <span className="tv-display__promotion-kicker">
                  <ShoppingBag aria-hidden="true" /> Boutique du club
                </span>
                <h2>Dotations 2026</h2>
                <p>
                  Retrouvez les tenues et équipements aux couleurs du Pelotaris
                  Club Lourdais sur la boutique HelloAsso.
                </p>

                {shopMedia.length > 0 ? (
                  <div className="tv-display__shop-media">
                    {shopMedia.map((item) => (
                      <img
                        src={item.publicUrl}
                        alt={item.originalName}
                        key={item.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="tv-display__shop-highlights">
                    <span>Textile club</span>
                    <span>Équipements</span>
                    <span>Idées cadeaux</span>
                  </div>
                )}
              </div>

              <QrCard
                value={SHOP_URL}
                title="Ouvrir la boutique"
                subtitle="Scannez pour découvrir les dotations 2026"
              />
            </article>

            <aside className="tv-display__partners-panel">
              <Handshake aria-hidden="true" />
              <span>Partenaires</span>
              <h2>Merci à ceux qui font vivre le club</h2>
              {partnerMedia.length > 0 ? (
                <div className="tv-display__partner-media">
                  {partnerMedia.map((item) => (
                    <img
                      src={item.publicUrl}
                      alt={item.originalName}
                      key={item.id}
                    />
                  ))}
                </div>
              ) : (
                <p>
                  Les logos et plaquettes partenaires ajoutés dans Infos du Club
                  apparaîtront ici automatiquement.
                </p>
              )}
            </aside>
          </div>
        </section>
      )}

      <footer className="tv-display__footer">
        <span>
          {activeView === "today" && (
            <>
              <Clock3 aria-hidden="true" />
              Affichage {display.displayStartTime}–{display.displayEndTime}
            </>
          )}
          {activeView === "week" && (
            <>
              <CalendarRange aria-hidden="true" />
              {displayedWeek}
            </>
          )}
          {activeView === "club" && (
            <>
              <ShoppingBag aria-hidden="true" />
              Boutique & partenaires
            </>
          )}
        </span>
        <span className="tv-display__view-indicator">
          {TV_VIEW_ORDER.map((view) => (
            <i className={activeView === view ? "is-active" : ""} key={view} />
          ))}
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
