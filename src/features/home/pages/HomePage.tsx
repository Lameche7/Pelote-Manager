import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { HomeTournaments } from "@/features/home/components/HomeTournaments";
import { formatPublicEventPeriod } from "@/features/home/domain/publicEventPresentation";
import { clubBrandingService } from "@/features/home/services/clubBrandingService";
import {
  publicEventService,
  type PublicEvent,
} from "@/features/home/services/publicEventService";
import {
  notificationService,
  type MemberHomeBanner,
} from "@/features/notifications/services/notificationService";
import { CLUB_CONFIG, ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./HomeAnnouncements.css";
import "./PremiumHomePage.css";
import "./ClubBrandingTheme.css";

const benefits = [
  {
    icon: "▦",
    title: "Réservations simples",
    text: "Consultez les disponibilités et réservez en quelques instants.",
  },
  {
    icon: "✓",
    title: "Paiement sécurisé",
    text: "Réglez vos réservations en ligne en toute sécurité.",
  },
  {
    icon: "◉",
    title: "Infos en direct",
    text: "Retrouvez la vie des installations et les actualités du club.",
  },
  {
    icon: "◎",
    title: "Club & communauté",
    text: "Un seul espace pour les joueurs, licenciés et dirigeants.",
  },
];

const bannerPriorityLabels = {
  normal: "Information du club",
  important: "Information importante",
  urgent: "Information urgente",
} as const;

type ClubHeroStyle = CSSProperties & {
  "--club-hero-image": string;
  "--club-primary": string;
  "--club-secondary": string;
  "--club-accent": string;
  "--club-neutral": string;
};

type PublicEventCardStyle = CSSProperties & { "--event-accent": string };

export function HomePage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsAvailable, setEventsAvailable] = useState(true);
  const [banners, setBanners] = useState<MemberHomeBanner[]>([]);
  const [branding, setBranding] = useState(clubBrandingService.fallback);
  const venueLabel = [CLUB_CONFIG.venueName, CLUB_CONFIG.location]
    .filter(Boolean)
    .join(" · ");
  const heroStyle: ClubHeroStyle = {
    "--club-hero-image": `url("${branding.heroImageUrl}")`,
    "--club-primary": branding.primaryColor,
    "--club-secondary": branding.secondaryColor,
    "--club-accent": branding.accentColor,
    "--club-neutral": branding.neutralColor,
  };

  useEffect(() => {
    let active = true;
    const loadBranding = () => {
      const brandingRequest = clubBrandingService.getPublicBranding();
      brandingRequest
        .then((value) => {
          if (active) setBranding(value);
        })
        .catch(() => undefined);
    };
    loadBranding();
    window.addEventListener("club-branding-updated", loadBranding);
    return () => {
      active = false;
      window.removeEventListener("club-branding-updated", loadBranding);
    };
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    let active = true;
    setEvents([]);
    setEventsLoading(true);
    setEventsAvailable(true);
    publicEventService
      .listUpcomingEvents()
      .then((upcomingEvents) => {
        if (!active) return;
        setEvents(upcomingEvents);
      })
      .catch(() => {
        if (!active) return;
        setEvents([]);
        setEventsAvailable(false);
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, isAuthLoading]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) {
      setBanners([]);
      return;
    }
    let active = true;
    notificationService
      .listHomeBanners()
      .then((clubBanners) => {
        if (active) setBanners(clubBanners);
      })
      .catch(() => {
        if (active) setBanners([]);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, isAuthLoading]);

  const showEventsSection =
    eventsAvailable && (eventsLoading || events.length > 0);

  return (
    <div className="premium-home" style={heroStyle}>
      <section className="premium-home__hero" aria-labelledby="home-title">
        <div className="premium-home__veil" aria-hidden="true" />
        <div className="premium-home__content">
          <img
            className="premium-home__logo"
            src={branding.logoUrl}
            alt={branding.name}
          />
          <p className="premium-home__eyebrow">{branding.name}</p>
          <h1 id="home-title">Pelote Manager</h1>
          <p className="premium-home__signature">
            {CLUB_CONFIG.foundedYear && (
              <>
                Depuis <strong>{CLUB_CONFIG.foundedYear}</strong> –{" "}
              </>
            )}
            {CLUB_CONFIG.tagline}
          </p>
          <div className="premium-home__actions">
            <Link className="button button--primary" to={ROUTES.reservations}>
              ▦ Réserver un créneau
            </Link>
            <Link className="button button--secondary" to={ROUTES.login}>
              ♙ Accéder à mon compte
            </Link>
          </div>
        </div>
      </section>

      {banners.length > 0 && (
        <section
          className="premium-home__announcements"
          aria-label="Informations importantes du club"
        >
          <div className="premium-home__announcement-list">
            {banners.map((banner) => (
              <article
                className={`club-announcement club-announcement--${banner.priority}`}
                key={banner.communicationId}
              >
                <div>
                  <p>{bannerPriorityLabels[banner.priority]}</p>
                  <h2>{banner.title}</h2>
                  <span>{banner.body}</span>
                </div>
                <Link to={ROUTES.myNotifications}>
                  Voir mes notifications →
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section
        className="premium-home__benefits"
        aria-label="Services Pelote Manager"
      >
        <div className="premium-home__benefit-grid">
          {benefits.map((benefit) => (
            <article className="premium-benefit" key={benefit.title}>
              <span className="premium-benefit__icon" aria-hidden="true">
                {benefit.icon}
              </span>
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <HomeTournaments />

      {showEventsSection && (
        <section
          className="premium-home__events"
          aria-labelledby="upcoming-events-title"
        >
          <div className="premium-home__events-inner">
            <header className="premium-home__section-heading">
              <p className="section-kicker">La vie du club</p>
              <h2 id="upcoming-events-title">Prochains évènements</h2>
              <p>
                Les rendez-vous publiés par le club, mis à jour directement
                depuis l’espace administration.
              </p>
            </header>
            {eventsLoading && (
              <p className="premium-home__events-status" role="status">
                Chargement des prochains évènements…
              </p>
            )}
            {!eventsLoading && events.length > 0 && (
              <div className="premium-home__event-grid">
                {events.map((event) => {
                  const cardStyle: PublicEventCardStyle = {
                    "--event-accent": event.typeColor,
                  };
                  const eventLocation = [
                    venueLabel,
                    event.resourceNames.join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <article
                      className="public-event-card"
                      key={event.id}
                      style={cardStyle}
                    >
                      <div className="public-event-card__meta">
                        <span className="public-event-card__type">
                          {event.typeName}
                        </span>
                        {event.visibility === "members" && (
                          <span className="public-event-card__audience">
                            Licenciés
                          </span>
                        )}
                      </div>
                      <p className="public-event-card__period">
                        {formatPublicEventPeriod(event.startsAt, event.endsAt)}
                      </p>
                      <h3>{event.name}</h3>
                      {event.description && <p>{event.description}</p>}
                      {eventLocation && (
                        <p className="public-event-card__location">
                          {eventLocation}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="premium-home__club">
        <div className="premium-home__club-card">
          <img
            className="premium-home__club-logo"
            src={branding.logoUrl}
            alt={branding.name}
          />
          <div>
            <p className="section-kicker">{venueLabel}</p>
            <h2>Le club, notre passion.</h2>
            <p>{CLUB_CONFIG.description}</p>
            <Link className="text-link" to={ROUTES.reservations}>
              Voir les créneaux disponibles →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
