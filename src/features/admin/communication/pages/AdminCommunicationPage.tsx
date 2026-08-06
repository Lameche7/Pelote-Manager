import { useEffect, useMemo, useState } from "react";
import { storedDateTimeToLocalInput } from "@/features/admin/events/domain/eventDateTime";
import {
  communicationAdminService,
  type AdminCommunication,
  type CommunicationDraft,
  type CommunicationPriority,
} from "@/features/admin/services/communicationAdminService";
import "./AdminCommunicationPage.css";

const blankDraft = (): CommunicationDraft => ({
  title: "",
  body: "",
  priority: "normal",
  showOnHome: false,
  expiresAt: "",
});

const priorityLabels: Record<CommunicationPriority, string> = {
  normal: "Normale",
  important: "Importante",
  urgent: "Urgente",
};

const statusLabels = {
  draft: "Brouillon",
  published: "Publiée",
  archived: "Archivée",
} as const;

export function AdminCommunicationPage() {
  const [communications, setCommunications] = useState<AdminCommunication[]>(
    [],
  );
  const [draft, setDraft] = useState<CommunicationDraft | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setCommunications(await communicationAdminService.listCommunications());
  };

  useEffect(() => {
    load()
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Chargement impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const visibleCommunications = useMemo(
    () =>
      communications.filter(
        (communication) =>
          statusFilter === "all" || communication.status === statusFilter,
      ),
    [communications, statusFilter],
  );

  const run = async (job: () => Promise<void>, success: string) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await job();
      await load();
      setMessage(success);
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : "Opération impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const editDraft = async (id: string) => {
    setError("");
    try {
      const value = await communicationAdminService.getCommunication(id);
      setDraft({
        ...value,
        expiresAt: value.expiresAt
          ? storedDateTimeToLocalInput(value.expiresAt)
          : "",
      });
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "Consultation impossible.",
      );
    }
  };

  if (loading) {
    return (
      <section className="admin-page">
        <p role="status">Chargement des communications…</p>
      </section>
    );
  }

  return (
    <section className="admin-page communication-admin">
      <header className="admin-page__header communication-admin__heading">
        <div>
          <p className="admin-page__eyebrow">Administration</p>
          <h1>Communication</h1>
          <p className="admin-page__lead">
            Informez tous les licenciés actifs depuis un seul endroit.
          </p>
        </div>
        <button
          className="communication-admin__primary"
          type="button"
          onClick={() => setDraft(blankDraft())}
        >
          Nouvelle communication
        </button>
      </header>

      <div className="communication-admin__notice">
        <strong>Diffusion V1</strong>
        <span>
          La publication crée une notification pour chaque licencié actif. Les
          licenciés sans compte sont conservés pour le futur envoi par e-mail.
        </span>
      </div>

      {error && (
        <p
          className="communication-admin__alert communication-admin__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="communication-admin__alert" role="status">
          {message}
        </p>
      )}

      <div className="admin-card communication-admin__toolbar">
        <label>
          Afficher
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Toutes</option>
            <option value="draft">Brouillons</option>
            <option value="published">Publiées</option>
            <option value="archived">Archivées</option>
          </select>
        </label>
      </div>

      <div className="communication-admin__list">
        {visibleCommunications.map((communication) => (
          <article
            className={`admin-card communication-card communication-card--${communication.priority}`}
            key={communication.id}
          >
            <header className="communication-card__header">
              <div>
                <div className="communication-card__badges">
                  <span
                    className={`communication-card__priority communication-card__priority--${communication.priority}`}
                  >
                    {priorityLabels[communication.priority]}
                  </span>
                  <span
                    className={`communication-card__status communication-card__status--${communication.status}`}
                  >
                    {statusLabels[communication.status]}
                  </span>
                  {communication.showOnHome && (
                    <span className="communication-card__home">
                      Bandeau accueil
                    </span>
                  )}
                </div>
                <h2>{communication.title}</h2>
              </div>
              <time dateTime={communication.createdAt}>
                {new Date(communication.createdAt).toLocaleString("fr-FR")}
              </time>
            </header>

            <p className="communication-card__body">{communication.body}</p>

            {communication.status !== "draft" && (
              <dl className="communication-card__stats">
                <div>
                  <dt>Destinataires</dt>
                  <dd>{communication.totalRecipients}</dd>
                </div>
                <div>
                  <dt>Dans l’application</dt>
                  <dd>{communication.inAppRecipients}</dd>
                </div>
                <div>
                  <dt>Lues</dt>
                  <dd>{communication.readRecipients}</dd>
                </div>
                <div>
                  <dt>Non lues</dt>
                  <dd>{communication.unreadRecipients}</dd>
                </div>
                <div>
                  <dt>Sans compte</dt>
                  <dd>{communication.withoutAccount}</dd>
                </div>
                <div>
                  <dt>Adresse e-mail connue</dt>
                  <dd>{communication.emailAvailable}</dd>
                </div>
              </dl>
            )}

            <footer className="communication-card__footer">
              <div className="communication-card__dates">
                {communication.publishedAt && (
                  <span>
                    Publiée le{" "}
                    {new Date(communication.publishedAt).toLocaleString(
                      "fr-FR",
                    )}
                  </span>
                )}
                {communication.expiresAt && (
                  <span>
                    Fin d’affichage le{" "}
                    {new Date(communication.expiresAt).toLocaleString("fr-FR")}
                  </span>
                )}
              </div>
              <div className="communication-card__actions">
                {communication.status === "draft" && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void editDraft(communication.id)}
                    >
                      Modifier
                    </button>
                    <button
                      className="communication-card__publish"
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        confirm(
                          `Publier « ${communication.title} » à tous les licenciés actifs ?`,
                        ) &&
                        void run(
                          () =>
                            communicationAdminService.publishCommunication(
                              communication.id,
                            ),
                          "Communication publiée et notifications créées.",
                        )
                      }
                    >
                      Publier
                    </button>
                  </>
                )}
                {communication.status !== "archived" && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      confirm("Archiver cette communication ?") &&
                      void run(
                        () =>
                          communicationAdminService.archiveCommunication(
                            communication.id,
                          ),
                        "Communication archivée.",
                      )
                    }
                  >
                    Archiver
                  </button>
                )}
              </div>
            </footer>
          </article>
        ))}

        {visibleCommunications.length === 0 && (
          <div className="admin-card communication-admin__empty">
            <h2>Aucune communication</h2>
            <p>Créez un premier message pour informer les licenciés.</p>
          </div>
        )}
      </div>

      {draft && (
        <CommunicationForm
          initial={draft}
          saving={saving}
          onCancel={() => setDraft(null)}
          onSave={async (value) => {
            setSaving(true);
            setError("");
            setMessage("");
            try {
              await communicationAdminService.saveCommunication(value);
              await load();
              setDraft(null);
              setMessage("Brouillon enregistré.");
            } catch (saveError) {
              setError(
                saveError instanceof Error
                  ? saveError.message
                  : "Enregistrement impossible.",
              );
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </section>
  );
}

function CommunicationForm({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: CommunicationDraft;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: CommunicationDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const update = <K extends keyof CommunicationDraft>(
    key: K,
    next: CommunicationDraft[K],
  ) => setValue((current) => ({ ...current, [key]: next }));

  return (
    <div
      className="communication-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="communication-form-title"
    >
      <form
        className="communication-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(value);
        }}
      >
        <header>
          <div>
            <p className="admin-page__eyebrow">Tous les licenciés actifs</p>
            <h2 id="communication-form-title">
              {value.id ? "Modifier le brouillon" : "Nouvelle communication"}
            </h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fermer">
            ×
          </button>
        </header>

        <label>
          Titre
          <input
            required
            maxLength={120}
            value={value.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>

        <label>
          Message
          <textarea
            required
            rows={8}
            maxLength={4000}
            value={value.body}
            onChange={(event) => update("body", event.target.value)}
          />
          <small>{value.body.length}/4000 caractères</small>
        </label>

        <div className="communication-form__grid">
          <label>
            Priorité
            <select
              value={value.priority}
              onChange={(event) =>
                update("priority", event.target.value as CommunicationPriority)
              }
            >
              <option value="normal">Normale</option>
              <option value="important">Importante</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>

          <label>
            Fin d’affichage facultative
            <input
              type="datetime-local"
              value={value.expiresAt}
              onChange={(event) => update("expiresAt", event.target.value)}
            />
          </label>
        </div>

        <label className="communication-form__check">
          <input
            type="checkbox"
            checked={value.showOnHome}
            onChange={(event) => update("showOnHome", event.target.checked)}
          />
          Afficher également en bandeau sur l’accueil des licenciés connectés
        </label>

        <p className="communication-form__help">
          L’enregistrement crée uniquement un brouillon. Les destinataires ne
          sont créés qu’au moment où vous cliquez sur « Publier ».
        </p>

        <footer>
          <button type="button" disabled={saving} onClick={onCancel}>
            Annuler
          </button>
          <button
            className="communication-admin__primary"
            type="submit"
            disabled={saving}
          >
            {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
          </button>
        </footer>
      </form>
    </div>
  );
}
