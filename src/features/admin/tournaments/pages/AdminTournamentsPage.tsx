import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  tournamentAdminService,
  type TournamentDetail,
  type TournamentDraft,
  type TournamentOptions,
  type TournamentPlayWindow,
  type TournamentSeries,
  type TournamentStatus,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import "./AdminTournamentsPage.css";

const statusLabels: Record<TournamentStatus, string> = {
  preparation: "Préparation",
  configuration: "Configuration",
  registrations_open: "Inscriptions ouvertes",
  registrations_closed: "Inscriptions fermées",
  pools_generated: "Poules générées",
  pools_validated: "Poules validées",
  planning_generated: "Planning généré",
  planning_published: "Planning publié",
  in_progress: "En cours",
  completed: "Terminé",
  archived: "Archivé",
  cancelled: "Annulé",
};

const weekdays = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

type TournamentForm = {
  seasonId: string;
  name: string;
  description: string;
  rules: string;
  startsOn: string;
  endsOn: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
};

const emptyOptions: TournamentOptions = { seasons: [], resources: [] };

const toLocalInput = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const blankForm = (seasonId = ""): TournamentForm => ({
  seasonId,
  name: "",
  description: "",
  rules: "",
  startsOn: "",
  endsOn: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
});

const detailToForm = (detail: TournamentDetail): TournamentForm => ({
  seasonId: detail.seasonId,
  name: detail.name,
  description: detail.description,
  rules: detail.rules,
  startsOn: detail.startsOn,
  endsOn: detail.endsOn,
  registrationOpensAt: toLocalInput(detail.registrationOpensAt),
  registrationClosesAt: toLocalInput(detail.registrationClosesAt),
});

const toDraft = (form: TournamentForm): TournamentDraft => {
  if (!form.registrationOpensAt || !form.registrationClosesAt) {
    throw new Error("Renseignez les dates d’ouverture et de fermeture des inscriptions.");
  }
  return {
    seasonId: form.seasonId,
    name: form.name,
    description: form.description,
    rules: form.rules,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    registrationOpensAt: new Date(form.registrationOpensAt).toISOString(),
    registrationClosesAt: new Date(form.registrationClosesAt).toISOString(),
  };
};

const formatDate = (value: string) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "—";

const formatDateTime = (value: string) =>
  value
    ? new Date(value).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

export function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [options, setOptions] = useState<TournamentOptions>(emptyOptions);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [form, setForm] = useState<TournamentForm | null>(null);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [series, setSeries] = useState<TournamentSeries[]>([]);
  const [playWindows, setPlayWindows] = useState<TournamentPlayWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadList = async () => {
    setTournaments(await tournamentAdminService.list());
  };

  const openTournament = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      const loaded = await tournamentAdminService.get(id);
      setDetail(loaded);
      setForm(detailToForm(loaded));
      setResourceIds(loaded.resources.map((resource) => resource.id));
      setSeries(loaded.series);
      setPlayWindows(loaded.playWindows);
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : "Chargement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    Promise.all([tournamentAdminService.list(), tournamentAdminService.getOptions()])
      .then(([items, loadedOptions]) => {
        setTournaments(items);
        setOptions(loadedOptions);
      })
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error ? loadError.message : "Chargement impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const activeSeasonId = useMemo(
    () => options.seasons.find((season) => season.isActive)?.id ?? options.seasons[0]?.id ?? "",
    [options.seasons],
  );

  const editable =
    detail === null ||
    detail.status === "preparation" ||
    detail.status === "configuration";

  const registrationWindowIsOpen = detail
    ? new Date(detail.registrationOpensAt) <= new Date() &&
      new Date(detail.registrationClosesAt) > new Date()
    : false;

  const beginCreate = () => {
    setDetail(null);
    setForm(blankForm(activeSeasonId));
    setResourceIds([]);
    setSeries([]);
    setPlayWindows([]);
    setError("");
    setMessage("");
  };

  const closeEditor = () => {
    setDetail(null);
    setForm(null);
    setResourceIds([]);
    setSeries([]);
    setPlayWindows([]);
    setError("");
    setMessage("");
  };

  const submitGeneral = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const draft = toDraft(form);
      if (detail) {
        await tournamentAdminService.update(detail.id, draft);
        await openTournament(detail.id);
        setMessage("Les informations du tournoi ont été enregistrées.");
      } else {
        const id = await tournamentAdminService.create(draft);
        await loadList();
        await openTournament(id);
        setMessage("Tournoi créé. Configurez maintenant les terrains, séries et horaires.");
      }
      await loadList();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveConfiguration = async () => {
    if (!detail) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentAdminService.saveConfiguration(detail.id, {
        resourceIds,
        series,
        playWindows,
      });
      await openTournament(detail.id);
      await loadList();
      setMessage("Configuration sportive enregistrée.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const transition = async (status: TournamentStatus, success: string) => {
    if (!detail) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentAdminService.transition(detail.id, status);
      await openTournament(detail.id);
      await loadList();
      setMessage(success);
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : "Changement d’état impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-page tournaments-page">
        <p role="status">Chargement du moteur Tournois…</p>
      </section>
    );
  }

  return (
    <section className="admin-page tournaments-page">
      <header className="admin-page__header tournaments-heading">
        <div>
          <p className="admin-page__eyebrow">Administration</p>
          <h1>Tournois</h1>
          <p className="admin-page__lead">
            Créez le tournoi, verrouillez sa configuration puis laissez Pelote Manager
            guider son cycle de vie.
          </p>
        </div>
        <button className="tournaments-primary" type="button" onClick={beginCreate}>
          Créer un tournoi
        </button>
      </header>

      {error && (
        <p className="tournaments-alert tournaments-alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="tournaments-alert" role="status">
          {message}
        </p>
      )}

      <div className="admin-card tournaments-overview">
        <div>
          <strong>{tournaments.length}</strong>
          <span>tournoi{tournaments.length > 1 ? "s" : ""}</span>
        </div>
        <p>
          Le Pool Engine, le Planning Engine et les résultats seront branchés sur ce
          noyau lors des prochaines PR.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="admin-card tournaments-empty">
          <h2>Aucun tournoi pour le moment</h2>
          <p>Créez le premier tournoi pour démarrer son parcours de préparation.</p>
          <button type="button" onClick={beginCreate}>
            Créer le premier tournoi
          </button>
        </div>
      ) : (
        <div className="tournaments-grid" aria-label="Liste des tournois">
          {tournaments.map((tournament) => (
            <article className="admin-card tournament-card" key={tournament.id}>
              <header>
                <div>
                  <span className={`tournament-status tournament-status--${tournament.status}`}>
                    {statusLabels[tournament.status]}
                  </span>
                  <h2>{tournament.name}</h2>
                  <small>{tournament.seasonName}</small>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void openTournament(tournament.id)}
                >
                  Ouvrir
                </button>
              </header>
              <dl>
                <div>
                  <dt>Période</dt>
                  <dd>
                    {formatDate(tournament.startsOn)} → {formatDate(tournament.endsOn)}
                  </dd>
                </div>
                <div>
                  <dt>Séries</dt>
                  <dd>{tournament.seriesCount}</dd>
                </div>
                <div>
                  <dt>Terrains</dt>
                  <dd>{tournament.resourceCount}</dd>
                </div>
              </dl>
              <p>
                Inscriptions : {formatDateTime(tournament.registrationOpensAt)} →{" "}
                {formatDateTime(tournament.registrationClosesAt)}
              </p>
            </article>
          ))}
        </div>
      )}

      {form && (
        <div className="tournament-editor" role="dialog" aria-modal="true">
          <div className="tournament-editor__backdrop" onClick={closeEditor} />
          <div className="tournament-editor__panel">
            <header className="tournament-editor__header">
              <div>
                <p className="admin-page__eyebrow">
                  {detail ? statusLabels[detail.status] : "Nouveau tournoi"}
                </p>
                <h2>{detail?.name || "Créer un tournoi"}</h2>
                {detail && <small>Fuseau : {detail.timezone}</small>}
              </div>
              <button type="button" onClick={closeEditor} aria-label="Fermer">
                ×
              </button>
            </header>

            <form className="tournament-form" onSubmit={submitGeneral}>
              <section>
                <h3>1. Informations générales</h3>
                <div className="tournament-form__grid">
                  <label>
                    Nom du tournoi
                    <input
                      required
                      disabled={!editable || saving}
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  </label>
                  <label>
                    Saison
                    <select
                      required
                      disabled={!editable || saving}
                      value={form.seasonId}
                      onChange={(event) =>
                        setForm({ ...form, seasonId: event.target.value })
                      }
                    >
                      <option value="">Choisir une saison</option>
                      {options.seasons.map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.name}{season.isActive ? " · Active" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Début du tournoi
                    <input
                      required
                      type="date"
                      disabled={!editable || saving}
                      value={form.startsOn}
                      onChange={(event) =>
                        setForm({ ...form, startsOn: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Fin du tournoi
                    <input
                      required
                      type="date"
                      disabled={!editable || saving}
                      value={form.endsOn}
                      onChange={(event) => setForm({ ...form, endsOn: event.target.value })}
                    />
                  </label>
                  <label>
                    Ouverture des inscriptions
                    <input
                      required
                      type="datetime-local"
                      disabled={!editable || saving}
                      value={form.registrationOpensAt}
                      onChange={(event) =>
                        setForm({ ...form, registrationOpensAt: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Fermeture des inscriptions
                    <input
                      required
                      type="datetime-local"
                      disabled={!editable || saving}
                      value={form.registrationClosesAt}
                      onChange={(event) =>
                        setForm({ ...form, registrationClosesAt: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Description
                  <textarea
                    rows={3}
                    disabled={!editable || saving}
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                  />
                </label>
                <label>
                  Règlement / informations sportives
                  <textarea
                    rows={4}
                    disabled={!editable || saving}
                    value={form.rules}
                    onChange={(event) => setForm({ ...form, rules: event.target.value })}
                  />
                </label>
                {editable && (
                  <button className="tournaments-primary" type="submit" disabled={saving}>
                    {detail ? "Enregistrer les informations" : "Créer le tournoi"}
                  </button>
                )}
              </section>
            </form>

            {detail && (
              <>
                <section className="tournament-config">
                  <header>
                    <div>
                      <h3>2. Terrains</h3>
                      <p>Sélectionnez les ressources que le Planning Engine pourra utiliser.</p>
                    </div>
                  </header>
                  <div className="tournament-resource-list">
                    {options.resources.map((resource) => (
                      <label key={resource.id}>
                        <input
                          type="checkbox"
                          disabled={!editable || saving}
                          checked={resourceIds.includes(resource.id)}
                          onChange={(event) =>
                            setResourceIds((current) =>
                              event.target.checked
                                ? [...current, resource.id]
                                : current.filter((id) => id !== resource.id),
                            )
                          }
                        />
                        <span>{resource.name}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="tournament-config">
                  <header>
                    <div>
                      <h3>3. Séries</h3>
                      <p>Une série active doit disposer d’une capacité supérieure à zéro.</p>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          setSeries((current) => [
                            ...current,
                            {
                              name: "",
                              capacity: 16,
                              enabled: true,
                              displayOrder: current.length,
                            },
                          ])
                        }
                      >
                        + Ajouter une série
                      </button>
                    )}
                  </header>
                  <div className="tournament-repeat-list">
                    {series.map((item, index) => (
                      <div className="tournament-repeat-row" key={item.id ?? `series-${index}`}>
                        <input
                          aria-label={`Nom série ${index + 1}`}
                          placeholder="Ex. 1ère Série"
                          disabled={!editable || saving}
                          value={item.name}
                          onChange={(event) =>
                            setSeries((current) =>
                              current.map((seriesItem, itemIndex) =>
                                itemIndex === index
                                  ? { ...seriesItem, name: event.target.value }
                                  : seriesItem,
                              ),
                            )
                          }
                        />
                        <label>
                          Capacité
                          <input
                            type="number"
                            min="0"
                            disabled={!editable || saving}
                            value={item.capacity}
                            onChange={(event) =>
                              setSeries((current) =>
                                current.map((seriesItem, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...seriesItem,
                                        capacity: Number(event.target.value),
                                      }
                                    : seriesItem,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="tournament-check">
                          <input
                            type="checkbox"
                            disabled={!editable || saving}
                            checked={item.enabled}
                            onChange={(event) =>
                              setSeries((current) =>
                                current.map((seriesItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...seriesItem, enabled: event.target.checked }
                                    : seriesItem,
                                ),
                              )
                            }
                          />
                          Active
                        </label>
                        {editable && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              setSeries((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    ))}
                    {series.length === 0 && <p>Aucune série configurée.</p>}
                  </div>
                </section>

                <section className="tournament-config">
                  <header>
                    <div>
                      <h3>4. Horaires du tournoi</h3>
                      <p>
                        Ces plages hebdomadaires seront croisées avec la période du tournoi
                        par le futur Planning Engine.
                      </p>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          setPlayWindows((current) => [
                            ...current,
                            {
                              weekday: 1,
                              opensAt: "18:00",
                              closesAt: "22:00",
                              displayOrder: current.length,
                            },
                          ])
                        }
                      >
                        + Ajouter une plage
                      </button>
                    )}
                  </header>
                  <div className="tournament-repeat-list">
                    {playWindows.map((item, index) => (
                      <div
                        className="tournament-repeat-row tournament-repeat-row--window"
                        key={item.id ?? `window-${index}`}
                      >
                        <select
                          aria-label={`Jour plage ${index + 1}`}
                          disabled={!editable || saving}
                          value={item.weekday}
                          onChange={(event) =>
                            setPlayWindows((current) =>
                              current.map((windowItem, itemIndex) =>
                                itemIndex === index
                                  ? { ...windowItem, weekday: Number(event.target.value) }
                                  : windowItem,
                              ),
                            )
                          }
                        >
                          {weekdays.map((weekday) => (
                            <option key={weekday.value} value={weekday.value}>
                              {weekday.label}
                            </option>
                          ))}
                        </select>
                        <label>
                          Début
                          <input
                            type="time"
                            disabled={!editable || saving}
                            value={item.opensAt}
                            onChange={(event) =>
                              setPlayWindows((current) =>
                                current.map((windowItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...windowItem, opensAt: event.target.value }
                                    : windowItem,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Fin
                          <input
                            type="time"
                            disabled={!editable || saving}
                            value={item.closesAt}
                            onChange={(event) =>
                              setPlayWindows((current) =>
                                current.map((windowItem, itemIndex) =>
                                  itemIndex === index
                                    ? { ...windowItem, closesAt: event.target.value }
                                    : windowItem,
                                ),
                              )
                            }
                          />
                        </label>
                        {editable && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              setPlayWindows((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    ))}
                    {playWindows.length === 0 && <p>Aucune plage horaire configurée.</p>}
                  </div>
                </section>

                {editable && (
                  <div className="tournament-config-save">
                    <button
                      className="tournaments-primary"
                      type="button"
                      disabled={saving}
                      onClick={() => void saveConfiguration()}
                    >
                      Enregistrer la configuration sportive
                    </button>
                  </div>
                )}

                <section className="tournament-lifecycle">
                  <h3>5. Cycle du tournoi</h3>
                  <div className="tournament-progress">
                    {[
                      "preparation",
                      "configuration",
                      "registrations_open",
                      "registrations_closed",
                      "pools_generated",
                      "planning_generated",
                      "in_progress",
                      "completed",
                      "archived",
                    ].map((status) => (
                      <span
                        className={detail.status === status ? "is-current" : ""}
                        key={status}
                      >
                        {statusLabels[status as TournamentStatus]}
                      </span>
                    ))}
                  </div>

                  <div className="tournament-lifecycle__actions">
                    {detail.status === "preparation" && (
                      <button
                        className="tournaments-primary"
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void transition(
                            "configuration",
                            "Configuration validée. Le tournoi est prêt pour les inscriptions.",
                          )
                        }
                      >
                        Valider la configuration
                      </button>
                    )}
                    {detail.status === "configuration" && (
                      <>
                        <p>
                          Les inscriptions s’ouvriront automatiquement le{" "}
                          <strong>{formatDateTime(detail.registrationOpensAt)}</strong>.
                        </p>
                        <button
                          type="button"
                          disabled={saving || !registrationWindowIsOpen}
                          onClick={() =>
                            void transition(
                              "registrations_open",
                              "Les inscriptions sont ouvertes.",
                            )
                          }
                        >
                          Ouvrir les inscriptions maintenant
                        </button>
                      </>
                    )}
                    {detail.status === "registrations_open" && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void transition(
                            "registrations_closed",
                            "Les inscriptions sont fermées.",
                          )
                        }
                      >
                        Fermer les inscriptions
                      </button>
                    )}
                    {detail.status === "registrations_closed" && (
                      <p>
                        Prochaine étape : gestion des équipes et des inscriptions, puis Pool
                        Engine.
                      </p>
                    )}
                    {["preparation", "configuration", "registrations_open", "registrations_closed"].includes(
                      detail.status,
                    ) && (
                      <button
                        className="tournament-danger"
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Annuler ce tournoi ? Les données resteront conservées dans l’historique.",
                            )
                          ) {
                            void transition("cancelled", "Le tournoi a été annulé.");
                          }
                        }}
                      >
                        Annuler le tournoi
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
