import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={ROUTES.home} replace />;
  }

  async function handleLogin() {
    setIsSubmitting(true);
    await login();
    navigate(ROUTES.home, { replace: true });
  }

  return (
    <section className="simple-page" aria-labelledby="login-title">
      <h1 id="login-title">Connexion</h1>
      <p>
        Cette connexion de démonstration utilise un compte administrateur
        simulé. Aucun mot de passe n’est demandé ni enregistré.
      </p>
      <button
        type="button"
        onClick={() => void handleLogin()}
        disabled={isSubmitting}
      >
        {isSubmitting
          ? "Connexion…"
          : "Se connecter avec le compte de démonstration"}
      </button>
    </section>
  );
}
