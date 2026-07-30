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
import { ROUTES } from "@/shared/config";
import { registerVisitor } from "@/infrastructure/auth/authService";
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

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const verification = useVerifyMemberIdentity();
  const registration = useRegisterMember();
  const [journey, setJourney] = useState<"choice" | "member" | "visitor">(
    "choice",
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [visitorFirstName, setVisitorFirstName] = useState("");
  const [visitorLastName, setVisitorLastName] = useState("");
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) return <Navigate to={ROUTES.home} replace />;

  const updateIdentity = (field: keyof MemberIdentity, value: string) => {
    setIdentity((current) => ({ ...current, [field]: value }));
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
      setStep(2);
    } catch (caught) {
      setError(
        caught instanceof MemberRegistrationError
          ? ERROR_MESSAGES[caught.registrationCode]
          : ERROR_MESSAGES.unknown,
      );
    }
  }

  async function register(event: React.FormEvent) {
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

  async function registerVisitorAccount(event: React.FormEvent) {
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
      const outcome = await registerVisitor({
        firstName: visitorFirstName,
        lastName: visitorLastName,
        email,
        password,
      });
      navigate(ROUTES.login, {
        replace: true,
        state: { accountCreated: outcome },
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : ERROR_MESSAGES.unknown,
      );
    }
  }

  const pending = verification.isPending || registration.isPending;
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
            onClick={() => {
              setJourney("choice");
              setStep(1);
              setError(null);
            }}
          >
            ← Changer de parcours
          </button>
        )}
      </header>

      {journey === "choice" && (
        <div className="register-choice">
          <h2>Êtes-vous licencié du club ?</h2>
          <button type="button" onClick={() => setJourney("member")}>
            <span>🥋</span>
            <strong>Je suis licencié</strong>
            <small>
              Je possède une licence FFPB et je souhaite bénéficier
              automatiquement du tarif licencié.
            </small>
          </button>
          <button type="button" onClick={() => setJourney("visitor")}>
            <span>👤</span>
            <strong>Je ne suis pas licencié</strong>
            <small>Je souhaite créer un compte visiteur.</small>
          </button>
        </div>
      )}

      {journey === "member" && step === 1 && (
        <form onSubmit={(event) => void verify(event)}>
          <h2>Retrouvez votre licence</h2>
          <p>
            Renseignez exactement les informations figurant sur votre licence.
          </p>
          <label htmlFor="licence">Numéro de licence</label>
          <input
            id="licence"
            value={identity.licenceNumber}
            onChange={(e) => updateIdentity("licenceNumber", e.target.value)}
            required
            disabled={pending}
          />
          <label htmlFor="lastName">Nom</label>
          <input
            id="lastName"
            autoComplete="family-name"
            value={identity.lastName}
            onChange={(e) => updateIdentity("lastName", e.target.value)}
            required
            disabled={pending}
          />
          <label htmlFor="firstName">Prénom</label>
          <input
            id="firstName"
            autoComplete="given-name"
            value={identity.firstName}
            onChange={(e) => updateIdentity("firstName", e.target.value)}
            required
            disabled={pending}
          />
          <label htmlFor="birthDate">Date de naissance</label>
          <input
            id="birthDate"
            type="date"
            value={identity.birthDate}
            onChange={(e) => updateIdentity("birthDate", e.target.value)}
            required
            disabled={pending}
          />
          <button type="submit" disabled={pending}>
            {verification.isPending ? "Vérification…" : "Vérifier ma licence"}
          </button>
        </form>
      )}

      {journey === "member" && step === 2 && (
        <form onSubmit={(event) => void register(event)}>
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
            pending={pending}
          />
          <div className="register-actions">
            <button
              type="button"
              className="button-back"
              onClick={() => setStep(1)}
            >
              Retour
            </button>
            <button type="submit" disabled={pending}>
              {registration.isPending ? "Création…" : "Créer mon compte"}
            </button>
          </div>
        </form>
      )}

      {journey === "visitor" && (
        <form onSubmit={(event) => void registerVisitorAccount(event)}>
          <h2>Créer un compte visiteur</h2>
          <p>
            Réservez vos créneaux et retrouvez-les dans votre espace personnel.
          </p>
          <label htmlFor="visitorFirstName">Prénom</label>
          <input
            id="visitorFirstName"
            autoComplete="given-name"
            value={visitorFirstName}
            onChange={(e) => setVisitorFirstName(e.target.value)}
            required
          />
          <label htmlFor="visitorLastName">Nom</label>
          <input
            id="visitorLastName"
            autoComplete="family-name"
            value={visitorLastName}
            onChange={(e) => setVisitorLastName(e.target.value)}
            required
          />
          <AccountFields
            email={email}
            password={password}
            confirmation={confirmation}
            setEmail={setEmail}
            setPassword={setPassword}
            setConfirmation={setConfirmation}
            pending={false}
          />
          <button type="submit">Créer mon compte</button>
        </form>
      )}
      {error && (
        <p className="register-error" role="alert">
          {error}
        </p>
      )}
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
        onChange={(e) => setEmail(e.target.value)}
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
        onChange={(e) => setPassword(e.target.value)}
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
        onChange={(e) => setConfirmation(e.target.value)}
        required
        disabled={pending}
      />
    </>
  );
}
