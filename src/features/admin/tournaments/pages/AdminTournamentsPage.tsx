import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TournamentSportingRulesSection } from "@/features/admin/tournaments/components/TournamentSportingRulesSection";
import {
  tournamentAdminService,
  type TournamentDetail,
  type TournamentDraft,
  type TournamentOptions,
  type TournamentPlayWindow,
  type TournamentSeries,
  type TournamentSportingRules,
  type TournamentStatus,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import "./AdminTournamentsPage.css";

const CLUB_TIME_ZONE = "Europe/Paris";

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

const lifecycleStatuses: TournamentStatus[] = [
  "preparation",
  "configuration",
  "registrations_open",
  "registrations_closed",
  "pools_generated",
  "pools_validated",
  "planning_generated",
  "planning_published",
  "in_progress",
  "completed",
  "archived",
];

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
  poolStartsOn: string;
  poolEndsOn: string;
  finalsStartsOn: string;
  finalsEndsOn: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  minimumAvailabilitySlots: number;
  minimumWeekendAvailabilitySlots: number;
  slotDurationMinutes: number;
};

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const emptyOptions: TournamentOptions = { seasons: [], resources: [] };

const clubDateTimeFormatter = new Intl.DateTimeFormat("fr-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const pad = (value: number) => String(value).padStart(2, "0");

const partsAt = (date: Date): DateTimeParts => {
  const parts = Object.fromEntries(
    clubDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as DateTimeParts;
};

const toLocalInput = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Date de tournoi invalide.");
  const parts = partsAt(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

const toStoredDateTime = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Date et heure incomplètes.");

  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    const local = partsAt(new Date(instant));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  const result = new Date(instant);
  if (toLocalInput(result.toISOString()) !== value) {
    throw new Error("Cette heure locale n’existe pas en Europe/Paris.");
  }
  return result.toISOString();
};

const blankForm = (seasonId = ""): TournamentForm => ({
  seasonId,
  name: "",
  description: "",
  rules: "",
  poolStartsOn: "",
  poolEndsOn: "",
  finalsStartsOn: "",
  finalsEndsOn: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
  minimumAvailabilitySlots: 65,
  minimumWeekendAvailabilitySlots: 0,
  slotDurationMinutes: 60,
});

const blankSportingRules = (): TournamentSportingRules => ({
  tournamentId: "",
  matchFormat: "best_of_three_sets",
  singleGamePoints: 35,
  mainSetPoints: 20,
  decidingSetPoints: 10,
  baseWinPoints: 3,
  baseLossPoints: 1,
  offensiveBonusPoints: 1,
  defensiveBonusPoints: 1,
  offensiveBonusMargin: 10,
  defensiveBonusMargin: 5,
  rankingMode: "points_per_match",
  goalAverageMode: "point_difference_per_match",
  updatedAt: "",
});

const detailToForm = (detail: TournamentDetail): TournamentForm => ({
  seasonId: detail.seasonId,
  name: detail.name,
  description: detail.description,
  rules: detail.rules,
  poolStartsOn: detail.poolStartsOn,
  poolEndsOn: detail.poolEndsOn,
  finalsStartsOn: detail.finalsStartsOn ?? "",
  finalsEndsOn: detail.finalsEndsOn ?? "",
  registrationOpensAt: toLocalInput(detail.registrationOpensAt),
  registrationClosesAt: toLocalInput(detail.registrationClosesAt),
  minimumAvailabilitySlots: detail.minimumAvailabilitySlots,
  minimumWeekendAvailabilitySlots: detail.minimumWeekendAvailabilitySlots,
  slotDurationMinutes: detail.slotDurationMinutes,
});

const toDraft = (form: TournamentForm): TournamentDraft => {
  if (!form.registrationOpensAt || !form.registrationClosesAt) {
    throw new Error(
      "Renseignez les dates d’ouverture et de fermeture des inscriptions.",
    );
  }
  if (!form.poolStartsOn || !form.poolEndsOn) {
    throw new Error("Renseignez les dates de la phase de poules.");
  }
  if (Boolean(form.finalsStartsOn) !== Boolean(form.finalsEndsOn)) {
    throw new Error(
      "Renseignez les deux dates de la phase finale ou laissez les deux champs vides.",
    );
  }
  if (
    form.minimumAvailabilitySlots < 0 ||
    form.minimumWeekendAvailabilitySlots < 0 ||
    form.minimumWeekendAvailabilitySlots > form.minimumAvailabilitySlots
  ) {
    throw new Error("Vérifiez les minima de disponibilités.");
  }
  if (form.slotDurationMinutes < 15 || form.slotDurationMinutes > 240) {
    throw new Error(
      "La durée d’un créneau doit être comprise entre 15 et 240 minutes.",
    );
  }

  const finalsStartsOn = form.finalsStartsOn || null;
  const finalsEndsOn = form.finalsEndsOn || null;
  return {
    seasonId: form.seasonId,
    name: form.name,
    description: form.description,
    rules: form.rules,
    startsOn: form.poolStartsOn,
    endsOn: finalsEndsOn ?? form.poolEndsOn,
    poolStartsOn: form.poolStartsOn,
    poolEndsOn: form.poolEndsOn,
    finalsStartsOn,
    finalsEndsOn,
    registrationOpensAt: toStoredDateTime(form.registrationOpensAt),
    registrationClosesAt: toStoredDateTime(form.registrationClosesAt),
    minimumAvailabilitySlots: form.minimumAvailabilitySlots,
    minimumWeekendAvailabilitySlots: form.minimumWeekendAvailabilitySlots,
    slotDurationMinutes: form.slotDurationMinutes,
  };
};

const formatDate = (value: string | null) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "—";

const formatDateTime = (value: string) =>
  value
    ? new Date(value).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: CLUB_TIME_ZONE,
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
  const [sportingRules, setSportingRules] =
    useState<TournamentSportingRules | null>(null);
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
      const [loaded, loadedSportingRules] = await Promise.all([
        tournamentAdminService.get(id),
        tournamentAdminService.getSportingRules(id),
      ]);
      setDetail(loaded);
      setForm(detailToForm(loaded));
      setResourceIds(loaded.resources.map((resource) => resource.id));
      setSeries(loaded.series);
      setPlayWindows(loaded.playWindows);
      setSportingRules(loadedSportingRules);
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Chargement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    Promise.all([
      tournamentAdminService.list(),
      tournamentAdminService.getOptions(),
    ])
      .then(([items, loadedOptions]) => {
        setTournaments(items);
        setOptions(loadedOptions);
      })
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Chargement impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const activeSeasonId = useMemo(
    () =>
      options.seasons.find((season) => season.isActive)?.id ??
      options.seasons[0]?.id ??
      "",
    [options.seasons],
  );

  const editable =
    detail === null ||
    [
      "preparation",
      "configuration",
      "registrations_open",
      "registrations_closed",
    ].includes(detail.status);

  const sportingRulesEditable =
    detail !== null &&
    [
      "preparation",
      "configuration",
      "registrations_open",
      "registrations_closed",
      "pools_generated",
    ].includes(detail.status);

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
    setSportingRules(blankSportingRules());
    setError("");
    setMessage("");
  };

  const closeEditor = () => {
    setDetail(null);
    setForm(null);
    setResourceIds([]);
    setSeries([]);
    setPlayWindows([]);
    setSportingRules(null);
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
        setMessage("Les paramètres du tournoi ont été enregistrés.");
      } else {
        if (!sportingRules) {
          throw new Error("Configurez les règles sportives du tournoi.");
        }
        const id = await tournamentAdminService.create(draft);
        await tournamentAdminService.saveSportingRules(id, sportingRules);
        await loadList();
        await openTournament(id);
        setMessage(
          "Tournoi créé avec ses règles sportives. Configurez maintenant les terrains, séries et horaires.",
        );
      }
      await loadList();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
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
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveSportingRules = async () => {
    if (!detail || !sportingRules) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentAdminService.saveSportingRules(detail.id, sportingRules);
      setSportingRules(
        await tournamentAdminService.getSportingRules(detail.id),
      );
      setMessage("Les règles sportives ont été enregistrées.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
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
            Préparez les poules et la phase finale. La configuration reste
            ajustable jusqu’à la génération des poules, avec contrôle des
            inscriptions déjà enregistrées.
          </p>
        </div>
        <button
          className="tournaments-primary"
          type="button"
          onClick={beginCreate}
        >
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
          Les disponibilités sont désormais distinguées entre phase de poules et
          phase finale pour préparer le Pool Engine puis le Planning Engine.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="admin-card tournaments-empty">
          <h2>Aucun tournoi pour le moment</h2>
          <p>
            Créez le premier tournoi pour démarrer son parcours de préparation.
          </p>
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
                  <span
                    className={`tournament-status tournament-status--${tournament.status}`}
                  >
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
                  <dt>Poules</dt>
                  <dd>
                    {formatDate(tournament.poolStartsOn)} →{" "}
                    {formatDate(tournament.poolEndsOn)}
                  </dd>
                </div>
                <div>
                  <dt>Phase finale</dt>
                  <dd>
                    {tournament.finalsStartsOn
                      ? `${formatDate(tournament.finalsStartsOn)} → ${formatDate(tournament.finalsEndsOn)}`
                      : "Non planifiée"}
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
                Inscriptions : {formatDateTime(tournament.registrationOpensAt)}{" "}
                → {formatDateTime(tournament.registrationClosesAt)}
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

            {detail &&
              ["registrations_open", "registrations_closed"].includes(
                detail.status,
              ) && (
                <p className="tournaments-alert">
                  Les paramètres restent modifiables. Toute modification qui
                  supprimerait un créneau déjà choisi ou rendrait une série trop
                  petite sera automatiquement refusée.
                </p>
              )}

            <form className="tournament-form" onSubmit={submitGeneral}>
              <section>
                <h3>1. Informations & inscriptions</h3>
                <div className="tournament-form__grid">
                  <label>
                    Nom du tournoi
                    <input
                      required
                      disabled={!editable || saving}
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
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
                          {season.name}
                          {season.isActive ? " · Active" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ouverture des inscriptions
                    <input
                      required
                      type="datetime-local"
                      disabled={!editable || saving}
                      value={form.registrationOpensAt}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          registrationOpensAt: event.target.value,
                        })
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
                        setForm({
                          ...form,
                          registrationClosesAt: event.target.value,
                        })
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
                    onChange={(event) =>
                      setForm({ ...form, rules: event.target.value })
                    }
                  />
                </label>
              </section>

              <section>
                <h3>2. Phases & créneaux</h3>
                <p>
                  Le minimum de disponibilités s’applique uniquement aux poules.
                  Les disponibilités de phase finale sont recueillies en plus.
                </p>
                <div className="tournament-form__grid">
                  <label>
                    Début des poules
                    <input
                      required
                      type="date"
                      disabled={!editable || saving}
                      value={form.poolStartsOn}
                      onChange={(event) =>
                        setForm({ ...form, poolStartsOn: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Fin des poules
                    <input
                      required
                      type="date"
                      disabled={!editable || saving}
                      value={form.poolEndsOn}
                      onChange={(event) =>
                        setForm({ ...form, poolEndsOn: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Début de la phase finale
                    <input
                      type="date"
                      disabled={!editable || saving}
                      value={form.finalsStartsOn}
                      onChange={(event) =>
                        setForm({ ...form, finalsStartsOn: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Fin de la phase finale
                    <input
                      type="date"
                      disabled={!editable || saving}
                      value={form.finalsEndsOn}
                      onChange={(event) =>
                        setForm({ ...form, finalsEndsOn: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Durée d’un créneau (minutes)
                    <input
                      required
                      type="number"
                      min="15"
                      max="240"
                      step="15"
                      disabled={!editable || saving}
                      value={form.slotDurationMinutes}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          slotDurationMinutes: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Minimum de créneaux — poules
                    <input
                      required
                      type="number"
                      min="0"
                      disabled={!editable || saving}
                      value={form.minimumAvailabilitySlots}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          minimumAvailabilitySlots: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Minimum week-end — poules
                    <input
                      required
                      type="number"
                      min="0"
                      disabled={!editable || saving}
                      value={form.minimumWeekendAvailabilitySlots}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          minimumWeekendAvailabilitySlots: Number(
                            event.target.value,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                {editable && detail && (
                  <button
                    className="tournaments-primary"
                    type="submit"
                    disabled={saving}
                  >
                    Enregistrer les paramètres
                  </button>
                )}
              </section>

              {!detail && sportingRules && (
                <TournamentSportingRulesSection
                  rules={sportingRules}
                  disabled={saving}
                  onChange={setSportingRules}
                  showSaveButton={false}
                />
              )}

              {!detail && (
                <button
                  className="tournaments-primary"
                  type="submit"
                  disabled={saving}
                >
                  Créer le tournoi
                </button>
              )}
            </form>

            {detail && (
              <>
                {sportingRules && (
                  <TournamentSportingRulesSection
                    rules={sportingRules}

                    disabled={!sportingRulesEditable || saving}

                    onChange={setSportingRules}

                    onSave={() => void saveSportingRules()}
                  />
                )}

                <section className="tournament-config">
                  <header>
                    <div>
                      <h3>4. Terrains</h3>
                      <p>
                        Sélectionnez les ressources que le Planning Engine
                        pourra utiliser.
                      </p>
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
                      <h3>5. Séries & capacités</h3>
                      <p>
                        La capacité peut évoluer pendant les inscriptions mais
                        jamais sous le nombre d’équipes déjà inscrites.
                      </p>
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
                      <div
                        className="tournament-repeat-row"
                        key={item.id ?? `series-${index}`}
                      >
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
                                    ? {
                                        ...seriesItem,
                                        enabled: event.target.checked,
                                      }
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
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
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
                      <h3>6. Horaires des créneaux</h3>
                      <p>
                        Ces plages sont appliquées aux dates de poules et aux
                        dates de phase finale. Une réduction qui supprimerait un
                        créneau déjà choisi sera refusée.
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
                                  ? {
                                      ...windowItem,
                                      weekday: Number(event.target.value),
                                    }
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
                                    ? {
                                        ...windowItem,
                                        opensAt: event.target.value,
                                      }
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
                                    ? {
                                        ...windowItem,
                                        closesAt: event.target.value,
                                      }
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
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    ))}
                    {playWindows.length === 0 && (
                      <p>Aucune plage horaire configurée.</p>
                    )}
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
                      Enregistrer terrains, séries et horaires
                    </button>
                  </div>
                )}

                <section className="tournament-lifecycle">
                  <h3>7. Cycle du tournoi</h3>
                  <div className="tournament-progress">
                    {lifecycleStatuses.map((status) => (
                      <span
                        className={detail.status === status ? "is-current" : ""}
                        key={status}
                      >
                        {statusLabels[status]}
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
                          <strong>
                            {formatDateTime(detail.registrationOpensAt)}
                          </strong>
                          .
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
                        Les paramètres restent ajustables jusqu’à la génération
                        des poules. Prochaine étape : Pool Engine.
                      </p>
                    )}
                    {[
                      "preparation",
                      "configuration",
                      "registrations_open",
                      "registrations_closed",
                    ].includes(detail.status) && (
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
                            void transition(
                              "cancelled",
                              "Le tournoi a été annulé.",
                            );
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
