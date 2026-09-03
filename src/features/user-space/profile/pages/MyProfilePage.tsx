import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, Building2, Mail, Trophy, UserRound } from "lucide-react";
import {
  externalParticipationService,
  type ExternalParticipationCandidate,
} from "@/features/auth/services/externalParticipationService";
import {
  memberService,
  MemberRegistrationError,
  MemberServiceError,
  type MemberIdentity,
} from "@/features/members/services/memberService";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  memberProfileService,
  type MemberProfileDetails,
} from "@/features/user-space/profile/services/memberProfileService";
import { CLUB_CONFIG } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./MyProfilePage.css";

const EMPTY_LICENCE_IDENTITY: MemberIdentity = {
  licenceNumber: "",
  lastName: "",
  firstName: "",
  birthDate: "",
};

type IdentityAction = "participations" | "licence" | null;

const partnerLabel = (candidate: ExternalParticipationCandidate) => {
  const name = [candidate.partnerFirstName, candidate.partnerLastName]
    .filter(Boolean)
    .join(" ");
  return name ? `Avec ${name}` : "Partenaire non renseigné";
};

const roleLabel = (candidate: ExternalParticipationCandidate) =>
  candidate.role === "back" ? "Arrière" : "Avant";

export function MyProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [member, setMember] = useState<MemberProfileDetails | null>(null);
  const [identityAction, setIdentityAction] = useState<IdentityAction>(null);
  const [candidates, setCandidates] = useState<
    ExternalParticipationCandidate[]
  >([]);
  const [licenceIdentity, setLicenceIdentity] = useState<MemberIdentity>(
    EMPTY_LICENCE_IDENTITY,
  );
  const [searchingParticipations, setSearchingParticipations] = useState(false);
  const [claimingParticipationId, setClaimingParticipationId] = useState<
    string | null
  >(null);
  const [linkingLicence, setLinkingLicence] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    if (!profile?.memberId) {
      setMember(null);
      return;
    }
    let active = true;
    void memberProfileService
      .get(profile.memberId)
      .then((details) => {
        if (active) setMember(details);
      })
      .catch(() => {
        if (active) setMember(null);
      });
    return () => {
      active = false;
    };
  }, [profile?.memberId]);

  useEffect(() => {
    setLicenceIdentity((current) => ({
      ...current,
      firstName: current.firstName || profile?.firstName || "",
      lastName: current.lastName || profile?.lastName || "",
    }));
  }, [profile?.firstName, profile?.lastName]);

  if (!profile) return null;

  const firstName = member?.firstName || profile.firstName;
  const lastName = member?.lastName || profile.lastName;
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || profile.displayName;
  const hasLinkedLicence = Boolean(profile.memberId);
  const isActiveLicensee = Boolean(member?.isActive);
  const accountType = isActiveLicensee
    ? "Licencié actif"
    : hasLinkedLicence
      ? member
        ? "Licence inactive"
        : "Licence liée"
      : "Utilisateur non licencié";

  const updateLicenceIdentity = (
    field: keyof MemberIdentity,
    value: string,
  ) => {
    setLicenceIdentity((current) => ({ ...current, [field]: value }));
  };

  const openParticipations = async () => {
    const profileFirstName = (profile.firstName ?? "").trim();
    const profileLastName = (profile.lastName ?? "").trim();
    setIdentityAction("participations");
    setActionError("");
    setActionMessage("");
    setCandidates([]);

    if (profileFirstName.length < 2 || profileLastName.length < 2) {
      setActionError(
        "Votre profil doit contenir un prénom et un nom avant de rechercher vos participations.",
      );
      return;
    }

    setSearchingParticipations(true);
    try {
      const found = await externalParticipationService.find(
        profileFirstName,
        profileLastName,
      );
      setCandidates(found);
      if (found.length === 0) {
        setActionMessage(
          "Aucune nouvelle participation à rattacher n’a été trouvée avec votre nom et votre prénom.",
        );
      }
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Impossible de rechercher vos participations.",
      );
    } finally {
      setSearchingParticipations(false);
    }
  };

  const claimParticipation = async (
    candidate: ExternalParticipationCandidate,
  ) => {
    setClaimingParticipationId(candidate.externalIdentityId);
    setActionError("");
    setActionMessage("");
    try {
      await externalParticipationService.claim(candidate.externalIdentityId);
      setCandidates((current) =>
        current.filter(
          (item) => item.externalIdentityId !== candidate.externalIdentityId,
        ),
      );
      setActionMessage(
        `Votre participation au ${candidate.tournamentName} est maintenant rattachée à ce compte.`,
      );
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Impossible de rattacher cette participation.",
      );
    } finally {
      setClaimingParticipationId(null);
    }
  };

  const openLicence = () => {
    setIdentityAction("licence");
    setActionError("");
    setActionMessage("");
    setLicenceIdentity((current) => ({
      ...current,
      firstName: current.firstName || profile.firstName || "",
      lastName: current.lastName || profile.lastName || "",
    }));
  };

  const linkLicence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasLinkedLicence || linkingLicence) return;

    setLinkingLicence(true);
    setActionError("");
    setActionMessage("");
    try {
      const matches = await memberService.matchesLicence(licenceIdentity);
      if (!matches) {
        setActionError(
          "Les informations saisies ne correspondent à aucune licence enregistrée dans ce club.",
        );
        return;
      }

      await memberService.linkCurrentProfile(licenceIdentity);
      await refreshProfile();
      setIdentityAction(null);
      setLicenceIdentity(EMPTY_LICENCE_IDENTITY);
      setActionMessage(
        "Votre licence est maintenant rattachée à ce compte. Vos participations existantes sont conservées.",
      );
    } catch (caught) {
      if (
        caught instanceof MemberRegistrationError &&
        caught.registrationCode === "verification_rate_limited"
      ) {
        setActionError(
          "Trop de tentatives. Patientez quelques instants avant de réessayer.",
        );
      } else if (
        caught instanceof MemberServiceError &&
        caught.code === "23505"
      ) {
        setActionError("Cette licence est déjà associée à un autre compte.");
      } else {
        setActionError(
          caught instanceof Error
            ? caught.message
            : "Impossible de rattacher cette licence.",
        );
      }
    } finally {
      setLinkingLicence(false);
    }
  };

  return (
    <UserSpaceShell>
      <section className="my-profile" aria-labelledby="my-profile-title">
        <header>
          <p>Mon espace</p>
          <h1 id="my-profile-title">Mon profil</h1>
          <span>Consultez les informations associées à votre compte.</span>
        </header>

        {actionError && (
          <p
            className="my-profile__alert my-profile__alert--error"
            role="alert"
          >
            {actionError}
          </p>
        )}
        {actionMessage && (
          <p className="my-profile__alert" role="status">
            {actionMessage}
          </p>
        )}

        <div className="my-profile__panel">
          <div className="my-profile__identity">
            <span>
              <UserRound aria-hidden="true" />
            </span>
            <div>
              <strong>{displayName || profile.email}</strong>
              <small>{accountType}</small>
            </div>
          </div>
          <dl className="my-profile__details">
            <div>
              <dt>Nom</dt>
              <dd>{lastName || "—"}</dd>
            </div>
            <div>
              <dt>Prénom</dt>
              <dd>{firstName || "—"}</dd>
            </div>
            <div>
              <dt>
                <Mail aria-hidden="true" /> Adresse email
              </dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>
                <BadgeCheck aria-hidden="true" /> Statut réservation
              </dt>
              <dd>
                <span className="my-profile__account-type">{accountType}</span>
              </dd>
            </div>
            {hasLinkedLicence && member && (
              <>
                <div>
                  <dt>Numéro de licence</dt>
                  <dd>{member.licenceNumber}</dd>
                </div>
                <div>
                  <dt>
                    <Building2 aria-hidden="true" /> Club
                  </dt>
                  <dd>{CLUB_CONFIG.name}</dd>
                </div>
                <div>
                  <dt>Saison</dt>
                  <dd>{member.season}</dd>
                </div>
                <div>
                  <dt>Licence active</dt>
                  <dd>{member.isActive ? "Oui" : "Non"}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <section
          className="my-profile__connections"
          aria-labelledby="my-profile-connections-title"
        >
          <div className="my-profile__connections-heading">
            <div>
              <p>Mon identité Pelote Manager</p>
              <h2 id="my-profile-connections-title">Mes rattachements</h2>
            </div>
            <span>
              Votre compte reste le même, quel que soit le tournoi ou le club.
            </span>
          </div>

          <div className="my-profile__connection-actions">
            <button
              type="button"
              onClick={() => void openParticipations()}
              disabled={
                searchingParticipations || claimingParticipationId !== null
              }
            >
              <Trophy aria-hidden="true" />
              <span>
                <strong>Retrouver mes participations</strong>
                <small>
                  Rechercher les tournois où votre nom est déjà enregistré.
                </small>
              </span>
            </button>
            {!hasLinkedLicence && (
              <button
                type="button"
                onClick={openLicence}
                disabled={linkingLicence}
              >
                <BadgeCheck aria-hidden="true" />
                <span>
                  <strong>Rattacher ma licence</strong>
                  <small>
                    À utiliser lorsque votre licence est enregistrée dans ce
                    club.
                  </small>
                </span>
              </button>
            )}
          </div>

          {identityAction === "participations" && (
            <div className="my-profile__connection-panel">
              <div className="my-profile__connection-panel-heading">
                <div>
                  <h3>Participations trouvées</h3>
                  <p>
                    Confirmez uniquement une participation que vous reconnaissez
                    grâce au tournoi, à la série et au partenaire.
                  </p>
                </div>
                <button
                  type="button"
                  className="my-profile__close"
                  onClick={() => setIdentityAction(null)}
                >
                  Fermer
                </button>
              </div>

              {searchingParticipations ? (
                <p role="status">Recherche de vos participations…</p>
              ) : candidates.length > 0 ? (
                <div className="my-profile__participations">
                  {candidates.map((candidate) => (
                    <article
                      key={`${candidate.externalIdentityId}-${candidate.tournamentId}-${candidate.teamId}`}
                    >
                      <span>Il semblerait que vous participiez au</span>
                      <strong>{candidate.tournamentName}</strong>
                      <p>{candidate.seriesName}</p>
                      <p>{partnerLabel(candidate)}</p>
                      <small>Poste : {roleLabel(candidate)}</small>
                      <button
                        type="button"
                        disabled={claimingParticipationId !== null}
                        onClick={() => void claimParticipation(candidate)}
                      >
                        {claimingParticipationId ===
                        candidate.externalIdentityId
                          ? "Rattachement…"
                          : "Oui, c’est bien moi"}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="my-profile__empty">
                  Aucune participation non rattachée n’est disponible pour le
                  moment.
                </p>
              )}
            </div>
          )}

          {identityAction === "licence" && !hasLinkedLicence && (
            <form
              className="my-profile__connection-panel my-profile__licence-form"
              onSubmit={(event) => void linkLicence(event)}
            >
              <div className="my-profile__connection-panel-heading">
                <div>
                  <h3>Rattacher ma licence</h3>
                  <p>
                    Renseignez exactement les informations figurant sur votre
                    licence. Ce rattachement n’efface aucun tournoi déjà associé
                    à votre compte.
                  </p>
                </div>
                <button
                  type="button"
                  className="my-profile__close"
                  onClick={() => setIdentityAction(null)}
                >
                  Fermer
                </button>
              </div>

              <div className="my-profile__licence-fields">
                <label>
                  Numéro de licence
                  <input
                    value={licenceIdentity.licenceNumber}
                    onChange={(event) =>
                      updateLicenceIdentity("licenceNumber", event.target.value)
                    }
                    required
                    disabled={linkingLicence}
                  />
                </label>
                <label>
                  Nom
                  <input
                    autoComplete="family-name"
                    value={licenceIdentity.lastName}
                    onChange={(event) =>
                      updateLicenceIdentity("lastName", event.target.value)
                    }
                    required
                    disabled={linkingLicence}
                  />
                </label>
                <label>
                  Prénom
                  <input
                    autoComplete="given-name"
                    value={licenceIdentity.firstName}
                    onChange={(event) =>
                      updateLicenceIdentity("firstName", event.target.value)
                    }
                    required
                    disabled={linkingLicence}
                  />
                </label>
                <label>
                  Date de naissance
                  <input
                    type="date"
                    value={licenceIdentity.birthDate}
                    onChange={(event) =>
                      updateLicenceIdentity("birthDate", event.target.value)
                    }
                    required
                    disabled={linkingLicence}
                  />
                </label>
              </div>
              <button type="submit" disabled={linkingLicence}>
                {linkingLicence ? "Rattachement…" : "Vérifier et rattacher"}
              </button>
            </form>
          )}
        </section>
      </section>
    </UserSpaceShell>
  );
}
