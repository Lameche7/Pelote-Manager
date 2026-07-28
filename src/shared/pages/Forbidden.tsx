import { Link } from "react-router-dom";
import { ROUTES } from "@/shared/config";

export function Forbidden() {
  return (
    <section className="simple-page" aria-labelledby="forbidden-title">
      <p className="simple-page__code">403</p>
      <h1 id="forbidden-title">Accès refusé</h1>
      <p>
        Votre compte ne dispose pas des droits nécessaires pour afficher cette
        page.
      </p>
      <Link to={ROUTES.home}>Retour à l’accueil</Link>
    </section>
  );
}
