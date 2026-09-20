import { useEffect, useMemo, useState } from "react";
import { BellRing, Clock3, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import {
  pushNotificationService,
  type PushNotificationState,
} from "@/features/notifications/services/pushNotificationService";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./PushActivationNudge.css";

export type PushActivationContext = "general" | "tournament" | "championship";

const DAY_MS = 24 * 60 * 60 * 1000;

const snoozeDays: Record<PushActivationContext, number> = {
  general: 7,
  tournament: 3,
  championship: 7,
};

const copy: Record<
  PushActivationContext,
  { eyebrow: string; title: string; body: string }
> = {
  general: {
    eyebrow: "Alertes PILOTOKI",
    title: "Reste informé sans ouvrir l’application",
    body:
      "Active les alertes pour être prévenu lorsqu’une information importante concerne tes réservations, tes tournois ou ton club.",
  },
  tournament: {
    eyebrow: "Tournoi · alertes instantanées",
    title: "Ne rate pas une demande de report",
    body:
      "PILOTOKI peut te prévenir immédiatement lorsqu’une équipe demande à déplacer une partie, qu’un horaire change ou qu’une action attend ta réponse.",
  },
  championship: {
    eyebrow: "Rencontre réservée",
    title: "Sois prévenu si quelque chose change",
    body:
      "Active les alertes pour recevoir les informations importantes liées à tes rencontres et à tes réservations sans avoir à revenir vérifier l’application.",
  },
};

const storageKey = (profileId: string, context: PushActivationContext) =>
  `pilotoki:push-nudge:${profileId}:${context}`;

const readSnoozedUntil = (
  profileId: string,
  context: PushActivationContext,
): number => {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId, context));
    const value = Number(raw ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

const snooze = (profileId: string, context: PushActivationContext) => {
  try {
    window.localStorage.setItem(
      storageKey(profileId, context),
      String(Date.now() + snoozeDays[context] * DAY_MS),
    );
  } catch {
    // Le rappel reste utilisable même si le stockage local est indisponible.
  }
};

export function PushActivationNudge({
  context,
  compact = false,
}: {
  context: PushActivationContext;
  compact?: boolean;
}) {
  const { profile, isAuthenticated, isLoading } = useAuth();
  const [state, setState] = useState<PushNotificationState | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  const isSnoozed = useMemo(() => {
    if (!profile?.id) return true;
    return readSnoozedUntil(profile.id, context) > Date.now();
  }, [context, profile?.id]);

  useEffect(() => {
    let active = true;

    if (isLoading || !isAuthenticated || !profile?.id || isSnoozed) {
      setChecking(false);
      return () => {
        active = false;
      };
    }

    setChecking(true);
    pushNotificationService
      .getState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading, isSnoozed, profile?.id]);

  if (
    checking ||
    dismissed ||
    !profile?.id ||
    !state ||
    state.subscribed ||
    !state.configured
  ) {
    return null;
  }

  const iosNeedsInstall = state.isIos && !state.isStandalone;
  const permissionDenied = state.permission === "denied";
  const actionable =
    state.supported && !iosNeedsInstall && !permissionDenied && !saving;
  const content = copy[context];

  const later = () => {
    snooze(profile.id, context);
    setDismissed(true);
  };

  const enable = async () => {
    if (!actionable) return;
    setSaving(true);
    setError("");
    try {
      const next = await pushNotificationService.enable();
      setState(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’activer les alertes sur cet appareil.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      className={`push-nudge push-nudge--${context}${compact ? " push-nudge--compact" : ""}`}
      aria-label="Activation des notifications"
    >
      <div className="push-nudge__icon" aria-hidden="true">
        {iosNeedsInstall ? <Smartphone /> : permissionDenied ? <Clock3 /> : <BellRing />}
      </div>
      <div className="push-nudge__content">
        <p className="push-nudge__eyebrow">{content.eyebrow}</p>
        <strong>{content.title}</strong>
        <span>{content.body}</span>

        {iosNeedsInstall && (
          <small>
            Sur iPhone/iPad, ajoute d’abord PILOTOKI à l’écran d’accueil puis
            ouvre-le depuis son icône pour pouvoir autoriser les notifications.
          </small>
        )}
        {permissionDenied && (
          <small>
            Les notifications sont actuellement bloquées sur cet appareil.
            Elles peuvent être réactivées depuis les réglages du navigateur ou
            du téléphone.
          </small>
        )}
        {!state.supported && (
          <small>
            Ce navigateur ne prend pas en charge les notifications Push.
          </small>
        )}
        {error && (
          <small className="push-nudge__error" role="alert">
            {error}
          </small>
        )}
      </div>
      <div className="push-nudge__actions">
        {actionable ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void enable()}
            disabled={saving}
          >
            <BellRing aria-hidden="true" />
            {saving ? "Activation…" : "Activer les alertes"}
          </button>
        ) : (
          <Link className="button button--primary" to={ROUTES.myNotifications}>
            Voir comment les activer
          </Link>
        )}
        <button
          type="button"
          className="button button--ghost"
          onClick={later}
          disabled={saving}
        >
          Plus tard
        </button>
      </div>
    </aside>
  );
}
