import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  useRegisterMember,
  useVerifyMemberIdentity,
} from "@/features/members/hooks/useMemberLookup";
import {
  MemberRegistrationError,
  type MemberIdentity,
} from "@/features/members/services/memberService";
import {
  externalParticipationService,
  type ExternalParticipationCandidate,
} from "@/features/auth/services/externalParticipationService";
import { ROUTES } from "@/shared/config";
import { registerAccount } from "@/infrastructure/auth/authService";
import { useAuth } from "@/shared/hooks/useAuth";
import "./RegisterPage.css";

const EMPTY_IDENTITY: MemberIdentity = {
  licenceNumber: "",
  lastName: "",
  firstName: "",
  birthDate: "",
};

const ERROR_MESSAGES = {
  identity_not_found:
    "Les informations saisies ne correspondent à aucune licence.",
  licence_already_linked: "Cette licence est déjà associée à un autre compte.",
  email_already_used: "Cette adresse email est déjà utilisée.",
  weak_password: "Le mot de passe ne respecte pas les critères de sécurité.",
  cleanup_failed:
    "Une erreur est survenue. Aucun compte utilisable n’a été créé.",
  verification_rate_limited:
    "Trop de tentatives. Patientez quelques instants avant de réessayer.",
  unknown: "Une erreur est survenue. Veuillez réessayer.",
} as const;

type Journey = "choice" | "member" | "account";
type AccountStep = "identity" | "participation" | "credentials";

const partnerLabel = (candidate: ExternalParticipationCandidate) => {
  const name = [candidate.partnerFirstName, candidate.partnerLastName]
    .filter(Boolean)
    .join(" ");
  return name ? `Avec ${name}` : "Partenaire non renseigné";
};

const roleLabel = (candidate: ExternalParticipationCandidate) =>
  candidate.role === "back" ? "Arrière" : "Avant";

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const verification = useVerifyMemberIdentity();
  const registration = useRegisterMember();
  const [journey, setJourney] = useState<Journey>("choice");
  const [memberStep, setMemberStep] = useState<1 | 2>(1);
  const [accountStep, setAccountStep] = useState<AccountStep>("identity");
  const [accountFirstName, setAccountFirstName] = useState("");
  const [accountLastName, setAccountLastName] = useState("");
  const [candidates, setCandidates] = useState<
    ExternalParticipationCandidate[]
  >([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<ExternalParticipationCandidate | null>(null);
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [searchingParticipations, setSearchingParticipations] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) return <Navigate to={ROUTES.home} replace />;

  const updateIdentity = (field: keyof MemberIdentity, value: string) => {
    setIdentity((current) => ({ ...current, [field]: value }));
  };

  const resetJourney = () => {
    setJourney("choice");
    setMemberStep(1);
    setAccountStep("identity");
    setCandidates([]);
    setSelectedCandidate(null);
    setError(null);
  };

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const matches = await verification.mutateAsync(identity);
      if (!matches) {
        setError(ERROR_MESSAGES.identity_not_found);
        return;
      }
      setMemberStep(2);
    } catch (caught) {
      setError(
        caught instanceof MemberRegistrationError
          ? ERROR_MESSAGES[caught.registrationCode]
          : ERROR_MESSAGES.unknown,
      );
    }
  }

  async function registerMemberAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(ERROR_MESSAGES.weak_password);
      return;
    }
    if (password !== confirmation) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    try {
      const outcome = await registration.mutateAsync({
        identity,
        email,
        password,
      });
      navigate(ROUTES.login, {
        replace: true,
        state: { accountCreated: outcome },
      });
    } catch (caught) {
      const code =
        caught instanceof MemberRegistrationError
          ? caught.registrationCode
          : "unknown";
      setError(ERROR_MESSAGES[code]);
    }
  }

  async function findParticipations(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSelectedCandidate(null);
    setSearchingParticipations(true);
    try {
      const found = await externalParticipationService.find(
        accountFirstName,
        accountLastName,
      );
      setCandidates(found);
      setAccountStep(found.length > 0 ? "participation" : "credentials");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : ERROR_MESSAGES.unknown,
      );
    } finally {
      setSearchingParticipations(false);
    }
  }

  function selectParticipation(candidate: ExternalParticipationCandidate) {
    setSelectedCandidate(candidate);
    setAccountStep("credentials");
    setError(null);
  }

  function continueWithoutParticipation() {
    setSelectedCandidate(null);
    setAccountStep("credentials");
    setError(null);
  }

  async function registerGeneralAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(ERROR_MESSAGES.weak_password);
      return;
    }
    if (password !== confirmation) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setCreatingAccount(true);
    try {
      const outcome = await registerAccount({
        firstName: accountFirstName,
        lastName: accountLastName,
        email,
        password,
        externalIdentityId: selectedCandidate?.externalIdentityId ?? null,
      });
      navigate(ROUTES.login, {
        replace: true,
        state: { accountCreated: outcome },
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : ERROR_MESSAGES.unknown,
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  const memberPending = verification.isPending || registration.isPending;

  return (
    <section className="register-page" aria-labelledby="register-title">
      <header>
        <p className="section-kicker">Votre espace</p>
        <h1 id="register-title">
          {journey === "choice" ? "Bienvenue !" : "Créer un compte"}
        </h1>
        {journey !== "choice" && (
          <button
            className="register-header-back"
            type="button"
            onClick={resetJourney}
          >
            ← Changer de parcours
          </button>
        )}
      </header>

      {journey === "choice" && (
        <div className="register-choice">
          <h2>Quelle est votre situation ?</h2>
          <button type="button" onClick={() => setJourney("member")}>
            <span>🪪</span>
            <strong>Ma licence est enregistrée dans ce club</strong>
            <small>
              Je rattache mon compte à ma fiche licencié avec mon numéro de
              licence.
            </small>
          </button>
          <button type="button" onClick={() => setJourney("account")}>
            <span>👤</span>
            <strong>Créer mon compte Pelote Manager</strong>
            <small>
              Pelote Manager recherchera aussi les tournois auxquels je
              participe déjà, même dans un autre club.
            </small>
          </button>
        </div>
      )}

      {journey === "member" && memberStep === 1 && (
        <form onSubmit={(event) => void verify(event)}>
          <h2>Retrouvez votre licence</h2>
          <p>
            Renseignez exactement les informations figurant sur votre licence.
          </p>
          <label htmlFor="licence">Numéro de licence</label>
          <input
            id="licence"
            value={identity.licenceNumber}
            onChange={(event) =>
              updateIdentity("licenceNumber", event.target.value)
            }
            required
            disabled={memberPending}
          />
          <label htmlFor="lastName">Nom</label>
          <input
            id="lastName"
            autoComplete="family-name"
            value={identity.lastName}
            onChange={(event) => updateIdentity("lastName", event.target.value)}
            required
            disabled={memberPending}
          />
          <label htmlFor="firstName">Prénom</label>
          <input
            id="firstName"
            autoComplete="given-name"
            value={identity.firstName}
            onChange={(event) =>
              updateIdentity("firstName", event.target.value)
            }
            required
            disabled={memberPending}
          />
          <label htmlFor="birthDate">Date de naissance</label>
          <input
            id="birthDate"
            type="date"
            value={identity.birthDate}
            onChange={(event) =>
              updateIdentity("birthDate", event.target.value)
            }
            required
            disabled={memberPending}
          />
          <button type="submit" disabled={memberPending}>
            {verification.isPending ? "Vérification…" : "Vérifier ma licence"}
          </button>
        </form>
      )}

      {journey === "member" && memberStep === 2 && (
        <form onSubmit={(event) => void registerMemberAccount(event)}>
          <h2>Créez vos identifiants</h2>
          <p className="register-success">
            Identité vérifiée. Votre compte sera automatiquement relié à votre
            licence.
          </p>
          <AccountFields
            email={email}
            password={password}
            confirmation={confirmation}
            setEmail={setEmail}
            setPassword={setPassword}
            setConfirmation={setConfirmation}
            pending={memberPending}
          />
          <div className="register-actions">
            <button
              type="button"
              className="button-back"
              onClick={() => setMemberStep(1)}
            >
              Retour
            </button>
            <button type="submit" disabled={memberPending}>
              {registration.isPending ? "Création…" : "Créer mon compte"}
            </button>
          </div>
        </form>
      )}

      {journey === "account" && accountStep === "identity" && (
        <form onSubmit={(event) => void findParticipations(event)}>
          <h2>Commençons par votre identité</h2>
          <p>
            Nous allons vérifier si votre nom correspond à une participation
            déjà enregistrée dans un tournoi Pelote Manager.
          </p>
          <label htmlFor="accountFirstName">Prénom</label>
          <input
            id="accountFirstName"
            autoComplete="given-name"
            value={accountFirstName}
            onChange={(event) => setAccountFirstName(event.target.value)}
            required
            disabled={searchingParticipations}
          />
          <label htmlFor="accountLastName">Nom</label>
          <input
            id="accountLastName"
            autoComplete="family-name"
            value={accountLastName}
            onChange={(event) => setAccountLastName(event.target.value)}
            required
            disabled={searchingParticipations}
          />
          <button type="submit" disabled={searchingParticipations}>
            {searchingParticipations ? "Recherche…" : "Continuer"}
          </button>
        </form>
      )}

      {journey === "account" && accountStep === "participation" && (
        <div className="register-participations">
          <h2>
            {candidates.length === 1
              ? "Nous avons peut-être retrouvé votre tournoi"
              : "Nous avons trouvé plusieurs participations possibles"}
          </h2>
          <p>
            Vérifiez le tournoi, la série et le partenaire avant de confirmer.
          </p>
          <p className="register-privacy-hint">
            <Link to={`${ROUTES.privacy}#participations-importees`}>
              Pourquoi Pelote Manager connaît déjà mon inscription ?
            </Link>
          </p>
          <div className="register-participations__list">
            {candidates.map((candidate) => (
              <article
                className="register-participation-card"
                key={`${candidate.externalIdentityId}-${candidate.tournamentId}-${candidate.teamId}`}
              >
                <p className="register-participation-card__hint">
                  Il semblerait que vous participiez au
                </p>
                <strong>{candidate.tournamentName}</strong>
                <span>{candidate.seriesName}</span>
                <span>{partnerLabel(candidate)}</span>
                <small>Poste : {roleLabel(candidate)}</small>
                <button
                  type="button"
                  onClick={() => selectParticipation(candidate)}
                >
                  Oui, c’est bien moi
                </button>
              </article>
            ))}
          </div>
          <div className="register-participations__actions">
            <button
              type="button"
              className="button-back"
              onClick={() => setAccountStep("identity")}
            >
              Modifier mon nom
            </button>
            <button type="button" onClick={continueWithoutParticipation}>
              Aucune ne me correspond
            </button>
          </div>
        </div>
      )}

      {journey === "account" && accountStep === "credentials" && (
        <form onSubmit={(event) => void registerGeneralAccount(event)}>
          <h2>Créez vos identifiants</h2>
          {selectedCandidate ? (
            <p className="register-success">
              Votre participation au {selectedCandidate.tournamentName} sera
              rattachée à ce compte. Cela ne modifie ni votre licence ni votre
              club.
            </p>
          ) : (
            <p>
              Votre compte pourra être rattaché plus tard à une licence ou à de
              nouvelles participations.
            </p>
          )}
          <AccountFields
            email={email}
            password={password}
            confirmation={confirmation}
            setEmail={setEmail}
            setPassword={setPassword}
            setConfirmation={setConfirmation}
            pending={creatingAccount}
          />
          <div className="register-actions">
            <button
              type="button"
              className="button-back"
              disabled={creatingAccount}
              onClick={() =>
                setAccountStep(
                  candidates.length > 0 ? "participation" : "identity",
                )
              }
            >
              Retour
            </button>
            <button type="submit" disabled={creatingAccount}>
              {creatingAccount ? "Création…" : "Créer mon compte"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="register-error" role="alert">
          {error}
        </p>
      )}
      <p className="register-legal-note">
        En créant un compte, vous reconnaissez avoir pris connaissance des{` `}
        <Link to={ROUTES.terms}>conditions d’utilisation</Link> et de la{` `}
        <Link to={ROUTES.privacy}>politique de confidentialité</Link>.
      </p>
      <p className="register-login">
        Déjà un compte ? <Link to={ROUTES.login}>Se connecter</Link>
      </p>
    </section>
  );
}

type AccountFieldsProps = {
  email: string;
  password: string;
  confirmation: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
  pending: boolean;
};

function AccountFields({
  email,
  password,
  confirmation,
  setEmail,
  setPassword,
  setConfirmation,
  pending,
}: AccountFieldsProps) {
  return (
    <>
      <label htmlFor="registerEmail">Adresse email</label>
      <input
        id="registerEmail"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        disabled={pending}
      />
      <label htmlFor="registerPassword">Mot de passe</label>
      <input
        id="registerPassword"
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        disabled={pending}
      />
      <small>8 caractères minimum.</small>
      <label htmlFor="confirmation">Confirmer le mot de passe</label>
      <input
        id="confirmation"
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
        disabled={pending}
      />
    </>
  );
}
