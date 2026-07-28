import { Link } from "react-router-dom";
import { ROUTES } from "@/shared/config";

export function NotFound() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <p className="not-found__code">404</p>
      <h1 id="not-found-title">Page introuvable</h1>
      <p>La page que vous recherchez n’existe pas.</p>
      <Link to={ROUTES.home}>Retour à l’accueil</Link>
    </section>
  );
}
