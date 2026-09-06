import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  championshipImportService,
  type AdminChampionshipSummary,
} from "@/features/admin/championships/services/championshipImportService";
import { ROUTES } from "@/shared/config";
import "./AdminChampionshipsPage.css";

const statusLabel: Record<string, string> = {
  preparation: "Préparation",
  active: "En cours",
  completed: "Terminé",
  archived: "Archivé",
};

export function AdminChampionshipsPage() {
  const [items, setItems] = useState<AdminChampionshipSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void championshipImportService
      .list()
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les championnats.",
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="admin-page admin-championships">
      <header className="admin-page__header admin-championships__header">
        <div>
          <p className="admin-page__eyebrow">Championnats</p>
          <h1>Gestion des championnats</h1>
          <p className="admin-page__lead">
            Suivez les compétitions officielles importées et leurs mises à jour.
          </p>
        </div>
        <Link
          className="admin-championships__primary"
          to={ROUTES.adminChampionshipImport}
        >
          Importer un championnat
        </Link>
      </header>

      {error && <p className="admin-championships__alert">{error}</p>}
      {busy && <div className="admin-card">Chargement des championnats…</div>}

      {!busy && !error && items.length === 0 && (
        <div className="admin-card admin-championships__empty">
          <h2>Aucun championnat importé</h2>
          <p>
            Importez les fichiers officiels des parties et des engagements pour
            créer le premier championnat.
          </p>
          <Link to={ROUTES.adminChampionshipImport}>Commencer l’import</Link>
        </div>
      )}

      {!busy && items.length > 0 && (
        <div className="admin-championships__grid">
          {items.map((item) => (
            <article
              className="admin-card admin-championships__card"
              key={item.id}
            >
              <div className="admin-championships__card-head">
                <div>
                  <span>{item.seasonLabel || "Saison non précisée"}</span>
                  <h2>{item.name}</h2>
                  <p>{item.specialty}</p>
                </div>
                <strong>{statusLabel[item.status] ?? item.status}</strong>
              </div>
              <dl>
                <div>
                  <dt>Séries</dt>
                  <dd>{item.divisionCount}</dd>
                </div>
                <div>
                  <dt>Équipes</dt>
                  <dd>{item.teamCount}</dd>
                </div>
                <div>
                  <dt>Parties</dt>
                  <dd>{item.matchCount}</dd>
                </div>
              </dl>
              <Link to={`/admin/championnats/${item.id}`}>
                Consulter et actualiser
              </Link>
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  Ouvrir la source officielle
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
