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
  unknown: "Une erreur est survenue. Veuillez réessayer.",
} as const;

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const verification = useVerifyMemberIdentity();
  const registration = useRegisterMember();
  const [step, setStep] = useState<1 | 2>(1);
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
    } catch {
      setError(ERROR_MESSAGES.unknown);
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
      await registration.mutateAsync({ identity, email, password });
      navigate(ROUTES.login, {
        replace: true,
        state: { accountCreated: true },
      });
    } catch (caught) {
      const code =
        caught instanceof MemberRegistrationError
          ? caught.registrationCode
          : "unknown";
      setError(ERROR_MESSAGES[code]);
    }
  }

  const pending = verification.isPending || registration.isPending;
  return (
    <section className="register-page" aria-labelledby="register-title">
      <header>
        <p className="section-kicker">Espace licencié</p>
        <h1 id="register-title">Créer un compte</h1>
        <ol className="register-steps" aria-label="Progression">
          <li className="is-active">
            <span>1</span> Vérification de l’identité
          </li>
          <li className={step === 2 ? "is-active" : ""}>
            <span>2</span> Création du compte
          </li>
        </ol>
      </header>

      {step === 1 ? (
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
      ) : (
        <form onSubmit={(event) => void register(event)}>
          <h2>Créez vos identifiants</h2>
          <p className="register-success">
            Identité vérifiée. Votre compte sera automatiquement relié à votre
            licence.
          </p>
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
            aria-describedby="password-help"
          />
          <small id="password-help">8 caractères minimum.</small>
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
          <div className="register-actions">
            <button
              type="button"
              className="button-back"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
              disabled={pending}
            >
              Retour
            </button>
            <button type="submit" disabled={pending}>
              {registration.isPending ? "Création…" : "Créer mon compte"}
            </button>
          </div>
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
