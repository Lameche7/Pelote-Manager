import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type {
  MyTournamentRegistration,
  MyTournamentRegistrationDraft,
  PublicTournamentDetail,
  TournamentAvailabilityRule,
  TournamentPlayerRole,
} from "@/features/tournaments/types";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./TournamentsPage.css";

const weekdays = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

const availabilityLabels = {
  preferred: "Préféré",
  possible: "Possible",
  unavailable: "Indisponible",
} as const;

const registrationStatusLabels = {
  pending: "En attente de validation",
  accepted: "Inscription validée",
  rejected: "Inscription à corriger/refusée",
  withdrawn: "Inscription retirée",
} as const;

const playerRoleLabels = { front: "Avant", back: "Arrière" } as const;

const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });

const emptyAvailability = (): TournamentAvailabilityRule => ({
  kind: "preferred",
  weekday: 1,
  startsAt: "17:30",
  endsAt: "22:30",
});

const emptyDraft = (
  seriesId: string,
  firstName: string,
  lastName: string,
  email: string,
): MyTournamentRegistrationDraft => ({
  seriesId,
  submitterRole: "front",
  submitterFirstName: firstName,
  submitterLastName: lastName,
  partnerFirstName: "",
  partnerLastName: "",
  partnerEmail: "",
  partnerPhone: "",
  contactEmail: email,
  contactPhone: "",
  comments: "",
  availabilityRules: [],
});

const registrationToDraft = (
  registration: MyTournamentRegistration,
  profile: {
    memberId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  },
): MyTournamentRegistrationDraft => {
  const submitter =
    registration.players.find(
      (player) => profile.memberId && player.memberId === profile.memberId,
    ) ??
    registration.players.find(
      (player) => profile.email && player.email === profile.email,
    ) ??
    registration.players[0];
  const partner =
    registration.players.find((player) => player !== submitter) ??
    registration.players[1];
  return {
    seriesId: registration.seriesId,
    submitterRole: submitter?.role ?? "front",
    submitterFirstName: submitter?.firstName ?? profile.firstName ?? "",
    submitterLastName: submitter?.lastName ?? profile.lastName ?? "",
    partnerFirstName: partner?.firstName ?? "",
    partnerLastName: partner?.lastName ?? "",
    partnerEmail: partner?.email ?? "",
    partnerPhone: partner?.phone ?? "",
    contactEmail: registration.contactEmail,
    contactPhone: registration.contactPhone,
    comments: registration.comments,
    availabilityRules: registration.availabilityRules,
  };
};

export function TournamentDetailPage() {
  const { tournamentId = "" } = useParams();
  const { profile, isAuthenticated, isLoading: authLoading } = useAuth();
  const [tournament, setTournament] =
    useState<PublicTournamentDetail | null>(null);
  const [registration, setRegistration] =
    useState<MyTournamentRegistration | null>(null);
  const [draft, setDraft] =
    useState<MyTournamentRegistrationDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const publicTournament = await tournamentService.getPublic(tournamentId);
    setTournament(publicTournament);
    if (!publicTournament) return;

    if (isAuthenticated) {
      const mine = await tournamentService.getMine(tournamentId);
      setRegistration(mine);
      setDraft(
        mine
          ? registrationToDraft(mine, profile ?? {})
          : emptyDraft(
              publicTournament.series[0]?.id ?? "",
              profile?.firstName ?? "",
              profile?.lastName ?? "",
              profile?.email ?? "",
            ),
      );
    } else {
      setRegistration(null);
      setDraft(null);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(load)
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger le tournoi.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Le profil complet est utilisé uniquement pour préremplir le formulaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, isAuthenticated, authLoading]);

  const teamsBySeries = useMemo(() => {
    const map = new Map<string, PublicTournamentDetail["teams"]>();
    for (const team of tournament?.teams ?? []) {
      map.set(team.seriesId, [...(map.get(team.seriesId) ?? []), team]);
    }
    return map;
  }, [tournament]);

  const setRule = (index: number, next: TournamentAvailabilityRule) => {
    if (!draft) return;
    setDraft({
      ...draft,
      availabilityRules: draft.availabilityRules.map((rule, ruleIndex) =>
        ruleIndex === index ? next : rule,
      ),
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentService.saveMine(tournamentId, draft);
      await load();
      setMessage(
        registration
          ? "Votre inscription a été mise à jour et repasse en validation."
          : "Votre équipe est enregistrée et attend la validation du club.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d’enregistrer votre équipe.",
      );
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm("Retirer votre équipe de ce tournoi ?")) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentService.withdrawMine(tournamentId);
      await load();
      setMessage("Votre inscription a été retirée.");
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Impossible de retirer votre inscription.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) {
    return (
      <section className="public-tournaments">
        <p role="status">Chargement du tournoi…</p>
      </section>
    );
  }

  if (error && !tournament) {
    return (
      <section className="public-tournaments">
        <p className="public-tournaments__error" role="alert">{error}</p>
        <Link to={ROUTES.tournaments}>← Retour aux tournois</Link>
      </section>
    );
  }

  if (!tournament) {
    return (
      <section className="public-tournaments">
        <h1>Tournoi indisponible</h1>
        <p>Ce tournoi n’est pas encore publié ou n’existe plus.</p>
        <Link to={ROUTES.tournaments}>← Retour aux tournois</Link>
      </section>
    );
  }

  const canEditRegistration = tournament.canRegister && isAuthenticated;

  return (
    <section className="public-tournaments public-tournament-detail">
      <Link className="public-tournament-detail__back" to={ROUTES.tournaments}>
        ← Tous les tournois
      </Link>

      <header className="public-tournament-detail__hero">
        <div>
          <p>Tournoi</p>
          <h1>{tournament.name}</h1>
          {tournament.description && <span>{tournament.description}</span>}
        </div>
        <dl>
          <div>
            <dt>Période</dt>
            <dd>
              {formatDate(tournament.startsOn)} →{" "}
              {formatDate(tournament.endsOn)}
            </dd>
          </div>
          <div>
            <dt>Inscriptions</dt>
            <dd>
              {formatDateTime(tournament.registrationOpensAt)} →{" "}
              {formatDateTime(tournament.registrationClosesAt)}
            </dd>
          </div>
        </dl>
      </header>

      {error && (
        <p className="public-tournaments__error" role="alert">{error}</p>
      )}
      {message && (
        <p className="public-tournaments__success" role="status">{message}</p>
      )}

      {tournament.rules && (
        <section className="public-tournament-panel">
          <h2>Règlement & informations</h2>
          <p className="public-tournament-preline">{tournament.rules}</p>
        </section>
      )}

      <section className="public-tournament-panel">
        <h2>Équipes inscrites</h2>
        <div className="public-tournament-series-list">
          {tournament.series.map((series) => (
            <article key={series.id} className="public-tournament-series">
              <header>
                <div>
                  <h3>{series.name}</h3>
                  <span>
                    {series.acceptedCount}/{series.capacity} validées
                  </span>
                </div>
                <strong>
                  {series.remainingSlots} place
                  {series.remainingSlots > 1 ? "s" : ""} disponible
                  {series.remainingSlots > 1 ? "s" : ""}
                </strong>
              </header>
              {(teamsBySeries.get(series.id) ?? []).length === 0 ? (
                <p>Aucune équipe validée pour le moment.</p>
              ) : (
                <div className="public-team-list">
                  {(teamsBySeries.get(series.id) ?? []).map((team) => (
                    <div className="public-team" key={team.id}>
                      {team.players.map((player) => (
                        <span key={`${team.id}-${player.role}`}>
                          <small>{playerRoleLabels[player.role]}</small>
                          <strong>{player.firstName} {player.lastName}</strong>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section
        className="public-tournament-panel public-registration-panel"
        id="inscription"
      >
        <div className="public-registration-panel__heading">
          <div>
            <p>Votre équipe</p>
            <h2>Inscription</h2>
          </div>
          {registration && (
            <span
              className={`public-registration-status public-registration-status--${registration.status}`}
            >
              {registrationStatusLabels[registration.status]}
            </span>
          )}
        </div>

        {!tournament.canRegister && (
          <p>
            Les inscriptions sont actuellement fermées. Les équipes déjà
            validées restent consultables ci-dessus.
          </p>
        )}

        {tournament.canRegister && !isAuthenticated && (
          <div className="public-registration-login">
            <p>
              Un compte Pelote Manager est nécessaire pour créer ou modifier une
              inscription.
            </p>
            <Link className="button button--primary" to={ROUTES.login}>
              Se connecter pour inscrire une équipe
            </Link>
          </div>
        )}

        {canEditRegistration && draft && (
          <form className="public-registration-form" onSubmit={submit}>
            <div className="public-registration-form__grid">
              <label>
                Série
                <select
                  required
                  disabled={saving}
                  value={draft.seriesId}
                  onChange={(event) =>
                    setDraft({ ...draft, seriesId: event.target.value })
                  }
                >
                  <option value="">Choisir une série</option>
                  {tournament.series.map((series) => (
                    <option key={series.id} value={series.id}>
                      {series.name} · {series.remainingSlots} place
                      {series.remainingSlots > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Votre poste
                <select
                  disabled={saving}
                  value={draft.submitterRole}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      submitterRole: event.target.value as TournamentPlayerRole,
                    })
                  }
                >
                  <option value="front">Avant</option>
                  <option value="back">Arrière</option>
                </select>
              </label>
              <label>
                Votre prénom
                <input
                  required
                  disabled={saving}
                  value={draft.submitterFirstName}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      submitterFirstName: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Votre nom
                <input
                  required
                  disabled={saving}
                  value={draft.submitterLastName}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      submitterLastName: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Prénom du partenaire
                <input
                  required
                  disabled={saving}
                  value={draft.partnerFirstName}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      partnerFirstName: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Nom du partenaire
                <input
                  required
                  disabled={saving}
                  value={draft.partnerLastName}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      partnerLastName: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                E-mail du partenaire
                <input
                  type="email"
                  disabled={saving}
                  value={draft.partnerEmail}
                  onChange={(event) =>
                    setDraft({ ...draft, partnerEmail: event.target.value })
                  }
                />
              </label>
              <label>
                Téléphone du partenaire
                <input
                  disabled={saving}
                  value={draft.partnerPhone}
                  onChange={(event) =>
                    setDraft({ ...draft, partnerPhone: event.target.value })
                  }
                />
              </label>
              <label>
                E-mail de contact
                <input
                  required
                  type="email"
                  disabled={saving}
                  value={draft.contactEmail}
                  onChange={(event) =>
                    setDraft({ ...draft, contactEmail: event.target.value })
                  }
                />
              </label>
              <label>
                Téléphone de contact
                <input
                  disabled={saving}
                  value={draft.contactPhone}
                  onChange={(event) =>
                    setDraft({ ...draft, contactPhone: event.target.value })
                  }
                />
              </label>
            </div>

            <label>
              Commentaire pour l’organisateur
              <textarea
                rows={3}
                disabled={saving}
                value={draft.comments}
                onChange={(event) =>
                  setDraft({ ...draft, comments: event.target.value })
                }
              />
            </label>

            <div className="public-availability-editor">
              <header>
                <div>
                  <h3>Disponibilités</h3>
                  <p>
                    Indiquez vos règles habituelles. Elles guideront les futurs
                    moteurs de poules et de planning sans garantir un horaire.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      availabilityRules: [
                        ...draft.availabilityRules,
                        emptyAvailability(),
                      ],
                    })
                  }
                >
                  + Ajouter
                </button>
              </header>
              {draft.availabilityRules.map((rule, index) => (
                <div
                  className="public-availability-row"
                  key={`${index}-${rule.kind}-${rule.weekday}`}
                >
                  <select
                    aria-label={`Type disponibilité ${index + 1}`}
                    disabled={saving}
                    value={rule.kind}
                    onChange={(event) =>
                      setRule(index, {
                        ...rule,
                        kind: event.target
                          .value as TournamentAvailabilityRule["kind"],
                      })
                    }
                  >
                    {Object.entries(availabilityLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    aria-label={`Jour disponibilité ${index + 1}`}
                    disabled={saving}
                    value={rule.weekday}
                    onChange={(event) =>
                      setRule(index, {
                        ...rule,
                        weekday: Number(event.target.value),
                      })
                    }
                  >
                    {weekdays.map((weekday) => (
                      <option key={weekday.value} value={weekday.value}>
                        {weekday.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Début disponibilité ${index + 1}`}
                    type="time"
                    disabled={saving}
                    value={rule.startsAt}
                    onChange={(event) =>
                      setRule(index, { ...rule, startsAt: event.target.value })
                    }
                  />
                  <input
                    aria-label={`Fin disponibilité ${index + 1}`}
                    type="time"
                    disabled={saving}
                    value={rule.endsAt}
                    onChange={(event) =>
                      setRule(index, { ...rule, endsAt: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        availabilityRules: draft.availabilityRules.filter(
                          (_, ruleIndex) => ruleIndex !== index,
                        ),
                      })
                    }
                  >
                    Retirer
                  </button>
                </div>
              ))}
              {draft.availabilityRules.length === 0 && (
                <p className="public-availability-empty">
                  Aucune règle renseignée pour le moment.
                </p>
              )}
            </div>

            <div className="public-registration-form__actions">
              <button
                className="button button--primary"
                type="submit"
                disabled={saving}
              >
                {registration
                  ? "Mettre à jour mon équipe"
                  : "Inscrire mon équipe"}
              </button>
              {registration && registration.status !== "withdrawn" && (
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={saving}
                  onClick={() => void withdraw()}
                >
                  Retirer mon inscription
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </section>
  );
}
