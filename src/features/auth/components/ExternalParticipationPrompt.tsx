import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  externalParticipationService,
  type ExternalParticipationCandidate,
} from "@/features/auth/services/externalParticipationService";
import { useAuth } from "@/shared/hooks/useAuth";
import "./ExternalParticipationPrompt.css";

const promptKey = (candidate: ExternalParticipationCandidate) =>
  `${candidate.externalIdentityId}:${candidate.teamId}`;

const storageKey = (profileId: string) =>
  `pilotoki:participation-prompt-dismissed:${profileId}`;

const readDismissed = (profileId: string): Set<string> => {
  try {
    const raw = window.sessionStorage.getItem(storageKey(profileId));
    const values = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(values)
        ? values.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
};

const rememberDismissed = (profileId: string, value: string) => {
  try {
    const current = readDismissed(profileId);
    current.add(value);
    window.sessionStorage.setItem(storageKey(profileId), JSON.stringify([...current]));
  } catch {
    // Le stockage de session peut être indisponible en navigation privée stricte.
  }
};

const partnerLabel = (candidate: ExternalParticipationCandidate) => {
  const partner = [candidate.partnerFirstName, candidate.partnerLastName]
    .filter(Boolean)
    .join(" ");
  return partner ? `Partenaire : ${partner}` : "Partenaire non renseigné";
};

const roleLabel = (candidate: ExternalParticipationCandidate) =>
  candidate.role === "back" ? "Arrière" : "Avant";

export function ExternalParticipationPrompt() {
  const { isAuthenticated, isLoading, profile } = useAuth();
  const location = useLocation();
  const [candidates, setCandidates] = useState<ExternalParticipationCandidate[]>(
    [],
  );
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    if (isLoading || !isAuthenticated || !profile?.id) {
      setCandidates([]);
      setError("");
      return () => {
        active = false;
      };
    }

    externalParticipationService
      .listUnclaimed()
      .then((items) => {
        if (!active) return;
        const dismissed = readDismissed(profile.id);
        setCandidates(
          items.filter((candidate) => !dismissed.has(promptKey(candidate))),
        );
      })
      .catch(() => {
        // Ce contrôle améliore l'expérience mais ne doit jamais bloquer la navigation.
        if (active) setCandidates([]);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading, location.key, profile?.id]);

  const candidate = candidates[0] ?? null;
  const remaining = useMemo(() => candidates.length, [candidates.length]);

  if (!candidate || !profile?.id) return null;

  const dismissForSession = () => {
    rememberDismissed(profile.id, promptKey(candidate));
    setCandidates((current) => current.slice(1));
    setError("");
  };

  const claim = async () => {
    setClaiming(true);
    setError("");
    try {
      await externalParticipationService.claim(candidate.externalIdentityId);
      setCandidates((current) =>
        current.filter(
          (item) => item.externalIdentityId !== candidate.externalIdentityId,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible de rattacher cette participation pour le moment.",
      );
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      className="external-participation-prompt"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !claiming) {
          dismissForSession();
        }
      }}
    >
      <section
        className="external-participation-prompt__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-participation-prompt-title"
      >
        <div className="external-participation-prompt__icon">
          <Trophy aria-hidden="true" />
        </div>
        <p className="external-participation-prompt__eyebrow">
          Participation trouvée
        </p>
        <h2 id="external-participation-prompt-title">
          Il semblerait que vous participiez à ce tournoi
        </h2>
        <div className="external-participation-prompt__match">
          <strong>{candidate.tournamentName}</strong>
          <span>{candidate.seriesName}</span>
          <span>{partnerLabel(candidate)}</span>
          <small>Poste : {roleLabel(candidate)}</small>
        </div>
        <p>
          Cette participation a pu être importée après la création de votre
          compte. Confirmez uniquement si ces informations vous correspondent.
        </p>
        {remaining > 1 && (
          <small className="external-participation-prompt__remaining">
            {remaining} participations restent à vérifier.
          </small>
        )}
        {error && (
          <div className="external-participation-prompt__error" role="alert">
            {error}
          </div>
        )}
        <div className="external-participation-prompt__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={dismissForSession}
            disabled={claiming}
          >
            Plus tard
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void claim()}
            disabled={claiming}
          >
            {claiming ? "Rattachement…" : "Oui, c’est bien moi"}
          </button>
        </div>
      </section>
    </div>
  );
}
