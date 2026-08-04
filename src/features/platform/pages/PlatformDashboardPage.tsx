import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePlatformAuth } from "../auth/usePlatformAuth";
import {
  platformRegistryService,
  type PlatformClub,
  type PlatformClubStatus,
  type PlatformSubscriptionPlan,
} from "../services/platformRegistryService";
import "./PlatformPages.css";

const statusLabels: Record<PlatformClubStatus, string> = {
  provisioning: "À provisionner",
  trial: "Essai",
  active: "Actif",
  suspended: "Suspendu",
  cancelled: "Résilié",
};

const planLabels: Record<PlatformSubscriptionPlan, string> = {
  standard: "Standard",
  premium: "Premium",
  custom: "Sur mesure",
};

export function PlatformDashboardPage() {
  const { email, logout } = usePlatformAuth();
  const [clubs, setClubs] = useState<PlatformClub[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] =
    useState<PlatformSubscriptionPlan>("standard");
  const [notes, setNotes] = useState("");

  const loadClubs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      setClubs(await platformRegistryService.listClubs());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Registre indisponible.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      await platformRegistryService.createClub({
        name,
        slug,
        contactEmail,
        subscriptionPlan,
        notes,
      });
      setName("");
      setSlug("");
      setContactEmail("");
      setSubscriptionPlan("standard");
      setNotes("");
      setMessage(
        "Club enregistré. Aucune instance ni donnée métier n’a encore été créée.",
      );
      await loadClubs();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Création impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatus = async (
    clubId: string,
    status: PlatformClubStatus,
  ) => {
    setErrorMessage("");
    setMessage("");

    try {
      await platformRegistryService.updateStatus(clubId, status);
      setMessage(`Statut mis à jour : ${statusLabels[status]}.`);
      await loadClubs();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Mise à jour impossible.",
      );
    }
  };

  return (
    <main className="platform-page">
      <header className="platform-header">
        <div>
          <p className="platform-kicker">Pelote Manager</p>
          <h1>Plateforme propriétaire</h1>
          <span>Clubs clients, abonnements, instances et versions.</span>
        </div>
        <div className="platform-header__account">
          <small>{email}</small>
          <button
            className="button button--small button--ghost"
            type="button"
            onClick={() => void logout()}
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <section className="platform-summary" aria-label="Résumé de la plateforme">
        <article>
          <strong>{clubs.length}</strong>
          <span>club{clubs.length > 1 ? "s" : ""} enregistré{clubs.length > 1 ? "s" : ""}</span>
        </article>
        <article>
          <strong>{clubs.filter((club) => club.status === "active").length}</strong>
          <span>actifs</span>
        </article>
        <article>
          <strong>
            {clubs.filter((club) => club.status === "provisioning").length}
          </strong>
          <span>à provisionner</span>
        </article>
      </section>

      {(message || errorMessage) && (
        <div
          className={`platform-message ${
            errorMessage ? "platform-message--error" : "platform-message--success"
          }`}
        >
          {errorMessage || message}
        </div>
      )}

      <div className="platform-grid">
        <section className="platform-card">
          <p className="platform-kicker">Nouveau client</p>
          <h2>Enregistrer un club</h2>
          <p>
            Cette étape crée uniquement sa fiche commerciale et technique dans
            la plateforme centrale.
          </p>

          <form className="platform-form" onSubmit={handleCreate}>
            <label>
              Nom du club
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Identifiant technique
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="club-de-tarbes"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
              />
              <small>Lettres minuscules, chiffres et tirets uniquement.</small>
            </label>
            <label>
              Email du contact principal
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </label>
            <label>
              Formule
              <select
                value={subscriptionPlan}
                onChange={(event) =>
                  setSubscriptionPlan(
                    event.target.value as PlatformSubscriptionPlan,
                  )
                }
              >
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="custom">Sur mesure</option>
              </select>
            </label>
            <label>
              Notes internes
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "Enregistrement…" : "Enregistrer le club"}
            </button>
          </form>
        </section>

        <section className="platform-card platform-card--wide">
          <p className="platform-kicker">Registre central</p>
          <h2>Clubs clients</h2>

          {isLoading ? (
            <p>Chargement du registre…</p>
          ) : clubs.length === 0 ? (
            <p>Aucun club client n’est encore enregistré.</p>
          ) : (
            <div className="platform-club-list">
              {clubs.map((club) => (
                <article className="platform-club" key={club.id}>
                  <div className="platform-club__heading">
                    <div>
                      <h3>{club.name}</h3>
                      <small>{club.slug}</small>
                    </div>
                    <span className={`platform-status platform-status--${club.status}`}>
                      {statusLabels[club.status]}
                    </span>
                  </div>

                  <dl>
                    <div>
                      <dt>Formule</dt>
                      <dd>{planLabels[club.subscriptionPlan]}</dd>
                    </div>
                    <div>
                      <dt>Contact</dt>
                      <dd>{club.contactEmail || "Non renseigné"}</dd>
                    </div>
                    <div>
                      <dt>Supabase</dt>
                      <dd>{club.supabaseProjectRef || "Non provisionné"}</dd>
                    </div>
                    <div>
                      <dt>Déploiement</dt>
                      <dd>{club.deploymentUrl || "Non déployé"}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>{club.currentVersion || "Non installée"}</dd>
                    </div>
                  </dl>

                  <div className="platform-club__actions">
                    {club.status !== "active" && (
                      <button
                        className="button button--small button--primary"
                        type="button"
                        onClick={() => void handleStatus(club.id, "active")}
                      >
                        Activer
                      </button>
                    )}
                    {club.status !== "suspended" && (
                      <button
                        className="button button--small button--ghost"
                        type="button"
                        onClick={() => void handleStatus(club.id, "suspended")}
                      >
                        Suspendre
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
