import { useEffect, useState, type FormEvent } from "react";
import { TournamentAvailabilityGrid } from "@/features/tournaments/components/TournamentAvailabilityGrid";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type {
  MyTournamentRegistration,
  MyTournamentRegistrationDraft,
  PublicTournamentDetail,
  TournamentPartnerSuggestion,
  TournamentPlayerRole,
  TournamentRegistrationIdentity,
} from "@/features/tournaments/types";

const playerRoleLabels: Record<TournamentPlayerRole, string> = {
  front: "Avant",
  back: "Arrière",
};

const oppositeRole = (role: TournamentPlayerRole): TournamentPlayerRole =>
  role === "front" ? "back" : "front";

const registrationPlayers = (
  registration: MyTournamentRegistration | null,
  identity: TournamentRegistrationIdentity,
) => {
  if (!registration) return { submitter: undefined, partner: undefined };
  const submitter =
    registration.players.find(
      (player) => identity.memberId && player.memberId === identity.memberId,
    ) ??
    registration.players.find(
      (player) => identity.email && player.email === identity.email,
    ) ??
    registration.players[0];
  return {
    submitter,
    partner:
      registration.players.find((player) => player !== submitter) ??
      registration.players[1],
  };
};

const buildDraft = (
  tournament: PublicTournamentDetail,
  registration: MyTournamentRegistration | null,
  identity: TournamentRegistrationIdentity,
): MyTournamentRegistrationDraft => {
  const { submitter, partner } = registrationPlayers(registration, identity);
  return {
    seriesId: registration?.seriesId ?? tournament.series[0]?.id ?? "",
    submitterRole: submitter?.role ?? "front",
    submitterFirstName: identity.firstName || submitter?.firstName || "",
    submitterLastName: identity.lastName || submitter?.lastName || "",
    submitterClubName: identity.clubName || submitter?.clubName || "",
    partnerMemberId: partner?.memberId ?? null,
    partnerFirstName: partner?.firstName ?? "",
    partnerLastName: partner?.lastName ?? "",
    partnerClubName: partner?.clubName ?? "",
    partnerEmail: partner?.email ?? "",
    partnerPhone: partner?.phone ?? "",
    contactEmail:
      (identity.emailFromMember
        ? identity.email
        : registration?.contactEmail) ||
      identity.email ||
      "",
    contactPhone:
      (identity.phoneFromMember
        ? identity.phone
        : registration?.contactPhone) ||
      identity.phone ||
      "",
    comments: registration?.comments ?? "",
    availabilityRules: [],
    availabilitySlots: registration?.availabilitySlots ?? [],
  };
};

const isWeekendDate = (value: string) => {
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

type Props = {
  tournament: PublicTournamentDetail;
  registration: MyTournamentRegistration | null;
  onReload: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
};

export function TournamentRegistrationForm({
  tournament,
  registration,
  onReload,
  onMessage,
  onError,
}: Props) {
  const [identity, setIdentity] =
    useState<TournamentRegistrationIdentity | null>(null);
  const [draft, setDraft] = useState<MyTournamentRegistrationDraft | null>(
    null,
  );
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerSuggestions, setPartnerSuggestions] = useState<
    TournamentPartnerSuggestion[]
  >([]);
  const [partnerEmailFromMember, setPartnerEmailFromMember] = useState(false);
  const [partnerPhoneFromMember, setPartnerPhoneFromMember] = useState(false);
  const [loadingIdentity, setLoadingIdentity] = useState(true);
  const [searchingPartner, setSearchingPartner] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingIdentity(true);
    tournamentService
      .getIdentity(tournament.id)
      .then((loadedIdentity) => {
        if (!active) return;
        const nextDraft = buildDraft(tournament, registration, loadedIdentity);
        const { partner } = registrationPlayers(registration, loadedIdentity);
        setIdentity(loadedIdentity);
        setDraft(nextDraft);
        setPartnerQuery(
          partner ? `${partner.firstName} ${partner.lastName}`.trim() : "",
        );
        setPartnerEmailFromMember(Boolean(partner?.emailFromMember));
        setPartnerPhoneFromMember(Boolean(partner?.phoneFromMember));
      })
      .catch((loadError: unknown) => {
        if (active) {
          onError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger vos coordonnées.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingIdentity(false);
      });
    return () => {
      active = false;
    };
  }, [onError, registration, tournament]);

  useEffect(() => {
    if (!draft || draft.partnerMemberId || partnerQuery.trim().length < 2) {
      setPartnerSuggestions([]);
      setSearchingPartner(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setSearchingPartner(true);
      tournamentService
        .searchPartnerMembers(tournament.id, partnerQuery)
        .then((results) => {
          if (active) setPartnerSuggestions(results);
        })
        .catch((searchError: unknown) => {
          if (active) {
            onError(
              searchError instanceof Error
                ? searchError.message
                : "Recherche des licenciés impossible.",
            );
          }
        })
        .finally(() => {
          if (active) setSearchingPartner(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, onError, partnerQuery, tournament.id]);

  const partnerRole = draft ? oppositeRole(draft.submitterRole) : "back";
  const poolAvailabilitySlots =
    draft?.availabilitySlots.filter(
      (slot) => (slot.phase ?? "pools") === "pools",
    ) ?? [];
  const finalsAvailabilitySlots =
    draft?.availabilitySlots.filter((slot) => slot.phase === "finals") ?? [];
  const weekendAvailabilityCount = poolAvailabilitySlots.filter((slot) =>
    isWeekendDate(slot.date),
  ).length;
  const poolMinimumReached = Boolean(
    draft &&
    poolAvailabilitySlots.length >= tournament.minimumAvailabilitySlots &&
    weekendAvailabilityCount >= tournament.minimumWeekendAvailabilitySlots,
  );
  const finalsMinimumReached =
    tournament.availableFinalsSlotCount === 0 ||
    finalsAvailabilitySlots.length >=
      tournament.minimumFinalsAvailabilitySlots;
  const availabilityMinimumReached = Boolean(
    draft && poolMinimumReached && finalsMinimumReached,
  );

  const selectPartner = (member: TournamentPartnerSuggestion) => {
    if (!draft) return;
    setDraft({
      ...draft,
      partnerMemberId: member.id,
      partnerFirstName: member.firstName,
      partnerLastName: member.lastName,
      partnerClubName: member.clubName,
      partnerEmail: member.hasEmail ? "" : draft.partnerEmail,
      partnerPhone: member.hasPhone ? "" : draft.partnerPhone,
    });
    setPartnerQuery(`${member.firstName} ${member.lastName}`);
    setPartnerEmailFromMember(member.hasEmail);
    setPartnerPhoneFromMember(member.hasPhone);
    setPartnerSuggestions([]);
  };

  const changePartnerQuery = (value: string) => {
    if (!draft) return;
    const selectedName =
      `${draft.partnerFirstName} ${draft.partnerLastName}`.trim();
    setPartnerQuery(value);
    if (draft.partnerMemberId && value.trim() !== selectedName) {
      setDraft({
        ...draft,
        partnerMemberId: null,
        partnerFirstName: "",
        partnerLastName: "",
        partnerClubName: "",
        partnerEmail: "",
        partnerPhone: "",
      });
      setPartnerEmailFromMember(false);
      setPartnerPhoneFromMember(false);
    }
  };

  const clearPartnerSelection = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      partnerMemberId: null,
      partnerFirstName: "",
      partnerLastName: "",
      partnerClubName: "",
      partnerEmail: "",
      partnerPhone: "",
    });
    setPartnerQuery("");
    setPartnerEmailFromMember(false);
    setPartnerPhoneFromMember(false);
    setPartnerSuggestions([]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    if (!draft.submitterClubName.trim() || !draft.partnerClubName.trim()) {
      onError("Renseignez le club de chacun des deux joueurs.");
      return;
    }
    if (!poolMinimumReached) {
      onError(
        `Pour la phase de poules, vous devez cocher au moins ${tournament.minimumAvailabilitySlots} créneaux dont ${tournament.minimumWeekendAvailabilitySlots} le week-end.`,
      );
      return;
    }
    if (!finalsMinimumReached) {
      onError(
        `Pour la phase finale, vous devez cocher au moins ${TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS} créneaux.`,
      );
      return;
    }

    setSaving(true);
    onError("");
    onMessage("");
    try {
      await tournamentService.saveMine(tournament.id, draft);
      await onReload();
      onMessage(
        registration
          ? "Votre inscription a été mise à jour."
          : "Votre équipe est inscrite au tournoi.",
      );
    } catch (saveError) {
      onError(
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
    onError("");
    onMessage("");
    try {
      await tournamentService.withdrawMine(tournament.id);
      await onReload();
      onMessage("Votre inscription a été retirée.");
    } catch (withdrawError) {
      onError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Impossible de retirer votre inscription.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadingIdentity || !identity || !draft) {
    return <p role="status">Préparation du formulaire d’inscription…</p>;
  }

  const selectedSeries = tournament.series.find(
    (series) => series.id === draft.seriesId,
  );

  return (
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
            <option value="front">{playerRoleLabels.front}</option>
            <option value="back">{playerRoleLabels.back}</option>
          </select>
        </label>

        <label>
          Votre prénom
          <input
            required
            disabled={saving || Boolean(identity.memberId)}
            value={draft.submitterFirstName}
            onChange={(event) =>
              setDraft({ ...draft, submitterFirstName: event.target.value })
            }
          />
        </label>

        <label>
          Votre nom
          <input
            required
            disabled={saving || Boolean(identity.memberId)}
            value={draft.submitterLastName}
            onChange={(event) =>
              setDraft({ ...draft, submitterLastName: event.target.value })
            }
          />
        </label>

        <label>
          Votre club
          <input
            required
            disabled={saving}
            readOnly={Boolean(identity.memberId)}
            value={draft.submitterClubName}
            onChange={(event) =>
              setDraft({ ...draft, submitterClubName: event.target.value })
            }
          />
          {identity.memberId && (
            <small>Récupéré depuis votre fiche licencié.</small>
          )}
        </label>

        <label>
          Votre e-mail
          <input
            required
            type="email"
            disabled={saving}
            readOnly={identity.emailFromMember}
            value={draft.contactEmail}
            onChange={(event) =>
              setDraft({ ...draft, contactEmail: event.target.value })
            }
          />
          {identity.emailFromMember && (
            <small>Récupéré depuis votre fiche licencié.</small>
          )}
        </label>

        <label>
          Votre téléphone
          <input
            required
            type="tel"
            disabled={saving}
            readOnly={identity.phoneFromMember}
            value={draft.contactPhone}
            onChange={(event) =>
              setDraft({ ...draft, contactPhone: event.target.value })
            }
          />
          {identity.phoneFromMember && (
            <small>Récupéré depuis votre fiche licencié.</small>
          )}
        </label>
      </div>

      <fieldset className="public-partner-fieldset">
        <legend>Partenaire</legend>
        <div className="public-registration-form__grid">
          <label className="public-registration-form__wide">
            Rechercher dans les licenciés
            <input
              autoComplete="off"
              disabled={saving}
              placeholder="Tapez au moins 2 lettres du prénom ou du nom"
              value={partnerQuery}
              onChange={(event) => changePartnerQuery(event.target.value)}
            />
            <small>
              La recherche porte sur les licenciés actifs du club. Pour un
              partenaire d’un autre club, ne sélectionnez personne et renseignez
              directement ses coordonnées ci-dessous.
            </small>
          </label>

          <label>
            Poste du partenaire
            <select disabled value={partnerRole}>
              <option value="front">{playerRoleLabels.front}</option>
              <option value="back">{playerRoleLabels.back}</option>
            </select>
            <small>Le binôme doit contenir un Avant et un Arrière.</small>
          </label>
        </div>

        {searchingPartner && <p role="status">Recherche…</p>}
        {partnerSuggestions.length > 0 && (
          <div className="public-partner-suggestions">
            {partnerSuggestions.map((member) => (
              <button
                key={member.id}
                type="button"
                disabled={saving}
                onClick={() => selectPartner(member)}
              >
                <strong>
                  {member.firstName} {member.lastName}
                </strong>
                <span>{member.clubName}</span>
                <small>
                  {member.hasEmail ? "E-mail renseigné" : "E-mail à saisir"} ·{" "}
                  {member.hasPhone
                    ? "Téléphone renseigné"
                    : "Téléphone à saisir"}
                </small>
              </button>
            ))}
          </div>
        )}

        {draft.partnerMemberId && (
          <div className="public-partner-selected">
            <span>Licencié sélectionné dans la base du club.</span>
            <button
              type="button"
              disabled={saving}
              onClick={clearPartnerSelection}
            >
              Changer de partenaire
            </button>
          </div>
        )}

        <div className="public-registration-form__grid">
          <label>
            Prénom du partenaire
            <input
              required
              disabled={saving}
              readOnly={Boolean(draft.partnerMemberId)}
              value={draft.partnerFirstName}
              onChange={(event) =>
                setDraft({ ...draft, partnerFirstName: event.target.value })
              }
            />
          </label>

          <label>
            Nom du partenaire
            <input
              required
              disabled={saving}
              readOnly={Boolean(draft.partnerMemberId)}
              value={draft.partnerLastName}
              onChange={(event) =>
                setDraft({ ...draft, partnerLastName: event.target.value })
              }
            />
          </label>

          <label>
            Club du partenaire
            <input
              required
              disabled={saving}
              readOnly={Boolean(draft.partnerMemberId)}
              value={draft.partnerClubName}
              onChange={(event) =>
                setDraft({ ...draft, partnerClubName: event.target.value })
              }
            />
            {draft.partnerMemberId && (
              <small>Récupéré depuis la fiche licencié.</small>
            )}
          </label>

          <label>
            E-mail du partenaire
            <input
              required={!partnerEmailFromMember}
              type={partnerEmailFromMember ? "text" : "email"}
              disabled={saving}
              readOnly={partnerEmailFromMember}
              value={
                partnerEmailFromMember
                  ? "Récupéré depuis la fiche licencié"
                  : draft.partnerEmail
              }
              onChange={(event) =>
                setDraft({ ...draft, partnerEmail: event.target.value })
              }
            />
          </label>

          <label>
            Téléphone du partenaire
            <input
              required={!partnerPhoneFromMember}
              type={partnerPhoneFromMember ? "text" : "tel"}
              disabled={saving}
              readOnly={partnerPhoneFromMember}
              value={
                partnerPhoneFromMember
                  ? "Récupéré depuis la fiche licencié"
                  : draft.partnerPhone
              }
              onChange={(event) =>
                setDraft({ ...draft, partnerPhone: event.target.value })
              }
            />
          </label>
        </div>
      </fieldset>

      <div className="public-registration-team-summary">
        <strong>Série : {selectedSeries?.name ?? "—"}</strong>
        <span>
          J1 : {draft.submitterFirstName} {draft.submitterLastName} ·{" "}
          {draft.submitterClubName || "club à renseigner"} &nbsp;|&nbsp; J2 :{" "}
          {draft.partnerFirstName || "—"} {draft.partnerLastName} ·{" "}
          {draft.partnerClubName || "club à renseigner"}
        </span>
      </div>

      <TournamentAvailabilityGrid
        tournament={tournament}
        value={draft.availabilitySlots}
        disabled={saving}
        onChange={(availabilitySlots) =>
          setDraft({ ...draft, availabilitySlots })
        }
      />

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

      <div className="public-registration-form__actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={saving || !availabilityMinimumReached}
        >
          {registration ? "Mettre à jour mon équipe" : "Inscrire mon équipe"}
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
  );
}
