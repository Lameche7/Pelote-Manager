import { useEffect, useMemo, useState } from "react";
import {
  eventAdminService,
  type AdminEvent,
  type EventDraft,
  type EventResource,
  type EventResponsible,
  type EventType,
} from "@/features/admin/services/eventAdminService";
import { storedDateTimeToLocalInput } from "@/features/admin/events/domain/eventDateTime";
import { submitEventDraft } from "@/features/admin/events/domain/eventFormSubmission";
import "./AdminEventsPage.css";

const blank = (typeId = ""): EventDraft => ({
  name: "",
  eventTypeId: typeId,
  description: "",
  responsibleProfileId: null,
  color: null,
  startsAt: "",
  endsAt: "",
  resourceIds: [],
  isBlocking: false,
  visibility: "private",
  publicationStatus: "draft",
  maximumCapacity: null,
  registrationRequired: false,
});
const statusLabel = {
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
} as const;

export function AdminEventsPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]),
    [types, setTypes] = useState<EventType[]>([]),
    [resources, setResources] = useState<EventResource[]>([]),
    [responsibles, setResponsibles] = useState<EventResponsible[]>([]);
  const [draft, setDraft] = useState<EventDraft | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("start-desc");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => setEvents(await eventAdminService.listEvents());
  useEffect(() => {
    Promise.all([
      eventAdminService.listEvents(),
      eventAdminService.listEventTypes(),
      eventAdminService.listResources(),
      eventAdminService.listResponsibles(),
    ])
      .then(([e, t, r, responsibleList]) => {
        setEvents(e);
        setTypes(t);
        setResources(r);
        setResponsibles(responsibleList);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Chargement impossible."),
      )
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(
    () =>
      events
        .filter(
          (event) =>
            (status === "all" || event.publicationStatus === status) &&
            `${event.name} ${event.typeName} ${event.resourceNames.join(" ")}`
              .toLocaleLowerCase("fr")
              .includes(search.toLocaleLowerCase("fr")),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "fr")
            : (sort === "start-asc" ? 1 : -1) *
              a.startsAt.localeCompare(b.startsAt),
        ),
    [events, search, status, sort],
  );
  const act = async (
    job: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    setSaving(true);
    setError("");
    try {
      await job();
      await load();
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <section className="admin-page">
        <p role="status">Chargement des évènements…</p>
      </section>
    );
  return (
    <section className="admin-page events-page">
      <header className="admin-page__header events-heading">
        <div>
          <p className="admin-page__eyebrow">Administration</p>
          <h1>Évènements</h1>
          <p className="admin-page__lead">
            Planifiez toutes les occupations du club depuis un moteur unique.
          </p>
        </div>
        <button
          className="events-primary"
          onClick={() => setDraft(blank(types.find((t) => t.isActive)?.id))}
        >
          Créer un évènement
        </button>
      </header>
      {error && (
        <p className="events-alert events-alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="events-alert" role="status">
          {message}
        </p>
      )}
      <div className="admin-card events-toolbar">
        <label>
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, type ou terrain"
          />
        </label>
        <label>
          Statut
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tous</option>
            <option value="draft">Brouillon</option>
            <option value="published">Publié</option>
            <option value="archived">Archivé</option>
          </select>
        </label>
        <label>
          Trier
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="start-desc">Plus récents</option>
            <option value="start-asc">Plus anciens</option>
            <option value="name">Nom</option>
          </select>
        </label>
      </div>
      <div className="admin-card events-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Terrain(s)</th>
              <th>Responsable</th>
              <th>Statut</th>
              <th>Publication</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.name}</strong>
                </td>
                <td>
                  <span
                    className="event-type"
                    style={
                      {
                        "--event-color": event.typeColor,
                      } as React.CSSProperties
                    }
                  >
                    {event.typeName}
                  </span>
                </td>
                <td>{new Date(event.startsAt).toLocaleString("fr-FR")}</td>
                <td>{new Date(event.endsAt).toLocaleString("fr-FR")}</td>
                <td>{event.resourceNames.join(", ")}</td>
                <td>{event.responsibleName ?? "—"}</td>
                <td>{event.isBlocking ? "Bloquant" : "Informatif"}</td>
                <td>
                  <span
                    className={`event-status event-status--${event.publicationStatus}`}
                  >
                    {statusLabel[event.publicationStatus]}
                  </span>
                </td>
                <td>
                  <div className="events-actions">
                    <button
                      onClick={() =>
                        eventAdminService
                          .getEvent(event.id)
                          .then((value) =>
                            setDraft({
                              ...value,
                              startsAt: storedDateTimeToLocalInput(
                                value.startsAt,
                              ),
                              endsAt: storedDateTimeToLocalInput(value.endsAt),
                            }),
                          )
                          .catch((e: unknown) =>
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Consultation impossible.",
                            ),
                          )
                      }
                    >
                      Consulter / modifier
                    </button>
                    <button
                      disabled={saving}
                      onClick={() =>
                        void act(
                          () => eventAdminService.duplicateEvent(event.id),
                          "Évènement dupliqué en brouillon.",
                        )
                      }
                    >
                      Dupliquer
                    </button>
                    {event.publicationStatus !== "archived" && (
                      <button
                        disabled={saving}
                        onClick={() =>
                          confirm("Archiver cet évènement ?") &&
                          void act(
                            () => eventAdminService.archiveEvent(event.id),
                            "Évènement archivé.",
                          )
                        }
                      >
                        Archiver
                      </button>
                    )}
                    <button
                      className="danger"
                      disabled={saving}
                      onClick={() =>
                        confirm("Supprimer définitivement cet évènement ?") &&
                        void act(
                          () => eventAdminService.deleteEvent(event.id),
                          "Évènement supprimé.",
                        )
                      }
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="events-empty">
            Aucun évènement ne correspond aux critères.
          </p>
        )}
      </div>
      {draft && (
        <EventForm
          draft={draft}
          types={types}
          resources={resources}
          responsibles={responsibles}
          saving={saving}
          error={error}
          onCancel={() => setDraft(null)}
          onSave={async (value) => {
            setSaving(true);
            setError("");
            const result = await submitEventDraft(
              value,
              eventAdminService.updateEvent.bind(eventAdminService),
            );
            if (result.ok) {
              setMessage(value.id ? "Évènement modifié." : "Évènement créé.");
              setDraft(null);
              try {
                await load();
              } catch (loadError) {
                setError(
                  loadError instanceof Error
                    ? loadError.message
                    : "Actualisation impossible.",
                );
              }
            } else {
              setError(result.message);
            }
            setSaving(false);
          }}
        />
      )}
    </section>
  );
}

function EventForm({
  draft: initial,
  types,
  resources,
  responsibles,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: EventDraft;
  types: EventType[];
  resources: EventResource[];
  responsibles: EventResponsible[];
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (draft: EventDraft) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const update = <K extends keyof EventDraft>(key: K, next: EventDraft[K]) =>
    setValue((v) => ({ ...v, [key]: next }));
  const allSelected = value.resourceIds.length === resources.length;
  return (
    <div
      className="events-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-form-title"
    >
      <form
        className="events-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(value);
        }}
      >
        <header>
          <div>
            <p className="admin-page__eyebrow">Event Engine</p>
            <h2 id="event-form-title">
              {value.id ? "Modifier l’évènement" : "Nouvel évènement"}
            </h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fermer">
            ×
          </button>
        </header>
        {error && (
          <p className="events-alert events-alert--error" role="alert">
            {error}
          </p>
        )}
        <fieldset>
          <legend>Informations générales</legend>
          <div className="events-grid">
            <label>
              Nom
              <input
                required
                value={value.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                required
                value={value.eventTypeId}
                onChange={(e) => update("eventTypeId", e.target.value)}
              >
                {types
                  .filter((t) => t.isActive || t.id === value.eventTypeId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Couleur
              <input
                type="color"
                value={
                  value.color ??
                  types.find((t) => t.id === value.eventTypeId)?.color ??
                  "#2563eb"
                }
                onChange={(e) => update("color", e.target.value)}
              />
            </label>
            <label>
              Responsable
              <select
                value={value.responsibleProfileId ?? ""}
                onChange={(e) =>
                  update("responsibleProfileId", e.target.value || null)
                }
              >
                <option value="">Aucun responsable</option>
                {responsibles.map((responsible) => (
                  <option
                    key={responsible.profileId}
                    value={responsible.profileId}
                  >
                    {responsible.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Début
              <input
                required
                type="datetime-local"
                value={value.startsAt}
                onChange={(e) => update("startsAt", e.target.value)}
              />
            </label>
            <label>
              Fin
              <input
                required
                type="datetime-local"
                value={value.endsAt}
                onChange={(e) => update("endsAt", e.target.value)}
              />
            </label>
            <label className="wide">
              Description
              <textarea
                rows={3}
                value={value.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Terrains</legend>
          <label className="events-check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                update(
                  "resourceIds",
                  e.target.checked ? resources.map((r) => r.id) : [],
                )
              }
            />{" "}
            Tous les terrains
          </label>
          <div className="events-resources">
            {resources.map((r) => (
              <label className="events-check" key={r.id}>
                <input
                  type="checkbox"
                  checked={value.resourceIds.includes(r.id)}
                  onChange={(e) =>
                    update(
                      "resourceIds",
                      e.target.checked
                        ? [...value.resourceIds, r.id]
                        : value.resourceIds.filter((id) => id !== r.id),
                    )
                  }
                />{" "}
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Options et publication</legend>
          <div className="events-grid">
            <label>
              Visibilité
              <select
                value={value.visibility}
                onChange={(e) =>
                  update(
                    "visibility",
                    e.target.value as EventDraft["visibility"],
                  )
                }
              >
                <option value="public">Visible publiquement</option>
                <option value="members">Membres uniquement</option>
                <option value="private">Privé</option>
              </select>
            </label>
            <label>
              Publication
              <select
                value={value.publicationStatus}
                onChange={(e) =>
                  update(
                    "publicationStatus",
                    e.target.value as EventDraft["publicationStatus"],
                  )
                }
              >
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
                <option value="archived">Archivé</option>
              </select>
            </label>
            <label>
              Capacité maximale
              <input
                min="1"
                type="number"
                value={value.maximumCapacity ?? ""}
                onChange={(e) =>
                  update(
                    "maximumCapacity",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
            <span className="events-checkboxes">
              <label className="events-check">
                <input
                  type="checkbox"
                  checked={value.isBlocking}
                  onChange={(e) => update("isBlocking", e.target.checked)}
                />{" "}
                Bloquant pour les réservations
              </label>
              <label className="events-check">
                <input
                  type="checkbox"
                  checked={value.registrationRequired}
                  onChange={(e) =>
                    update("registrationRequired", e.target.checked)
                  }
                />{" "}
                Inscription obligatoire
              </label>
            </span>
          </div>
        </fieldset>
        <aside className="events-future">
          <strong>Préparé pour les prochaines évolutions</strong>
          <span>Documents joints</span>
          <span>Notifications automatiques</span>
        </aside>
        <footer>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button
            className="events-primary"
            disabled={saving || value.resourceIds.length === 0}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </form>
    </div>
  );
}
