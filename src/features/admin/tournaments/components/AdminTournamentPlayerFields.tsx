import { useEffect, useState } from "react";
import { adminTournamentTeamService } from "@/features/admin/tournaments/services/adminTournamentTeamService";
import type {
  TournamentMemberSuggestion,
  TournamentTeamPlayer,
} from "@/features/tournaments/types";
import "./AdminTournamentPlayerFields.css";

type Props = {
  tournamentId: string;
  teamId: string | null;
  player: TournamentTeamPlayer;
  excludedMemberId?: string | null;
  disabled: boolean;
  onChange: (player: TournamentTeamPlayer) => void;
  onError: (message: string) => void;
};

const playerLabel = (player: TournamentTeamPlayer) =>
  player.role === "front" ? "Avant" : "Arrière";

export function AdminTournamentPlayerFields({
  tournamentId,
  teamId,
  player,
  excludedMemberId,
  disabled,
  onChange,
  onError,
}: Props) {
  const [query, setQuery] = useState(
    player.memberId ? `${player.firstName} ${player.lastName}`.trim() : "",
  );
  const [suggestions, setSuggestions] = useState<TournamentMemberSuggestion[]>(
    [],
  );
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (player.memberId) {
      setQuery(`${player.firstName} ${player.lastName}`.trim());
      setSuggestions([]);
    }
  }, [player.firstName, player.lastName, player.memberId]);

  useEffect(() => {
    if (player.memberId || query.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      adminTournamentTeamService
        .searchMembers(tournamentId, query, teamId)
        .then((results) => {
          if (!active) return;
          setSuggestions(
            excludedMemberId
              ? results.filter((member) => member.id !== excludedMemberId)
              : results,
          );
        })
        .catch((searchError: unknown) => {
          if (!active) return;
          onError(
            searchError instanceof Error
              ? searchError.message
              : "Recherche des licenciés impossible.",
          );
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [excludedMemberId, onError, player.memberId, query, teamId, tournamentId]);

  const selectMember = (member: TournamentMemberSuggestion) => {
    onChange({
      ...player,
      memberId: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      clubName: member.clubName,
      email: "",
      phone: "",
      emailFromMember: member.hasEmail,
      phoneFromMember: member.hasPhone,
    });
    setQuery(`${member.firstName} ${member.lastName}`.trim());
    setSuggestions([]);
  };

  const clearMember = () => {
    onChange({
      ...player,
      memberId: null,
      firstName: "",
      lastName: "",
      clubName: "",
      email: "",
      phone: "",
      emailFromMember: false,
      phoneFromMember: false,
    });
    setQuery("");
    setSuggestions([]);
  };

  const update = (changes: Partial<TournamentTeamPlayer>) =>
    onChange({ ...player, ...changes });

  return (
    <fieldset>
      <legend>{playerLabel(player)}</legend>

      <div className="admin-tournament-member-search">
        {player.memberId ? (
          <div className="admin-tournament-member-selected">
            <div>
              <strong>
                {player.firstName} {player.lastName}
              </strong>
              <small>{player.clubName} · licencié du club</small>
            </div>
            <button type="button" disabled={disabled} onClick={clearMember}>
              Changer
            </button>
          </div>
        ) : (
          <label>
            Rechercher un licencié du club
            <input
              autoComplete="off"
              disabled={disabled}
              placeholder="Tapez au moins 2 lettres du prénom ou du nom"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <small>
              Sélectionnez un licencié existant ou remplissez les champs
              manuellement pour un joueur extérieur.
            </small>
          </label>
        )}

        {searching && <small>Recherche…</small>}
        {suggestions.length > 0 && (
          <div className="admin-tournament-member-suggestions">
            {suggestions.map((member) => (
              <button
                key={member.id}
                type="button"
                disabled={disabled}
                onClick={() => selectMember(member)}
              >
                <strong>
                  {member.firstName} {member.lastName}
                </strong>
                <span>{member.clubName}</span>
                <small>
                  {member.hasEmail ? "e-mail ✓" : "e-mail à compléter"} ·{" "}
                  {member.hasPhone ? "tél. ✓" : "tél. à compléter"}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-tournament-team-form__grid">
        <label>
          Prénom
          <input
            required
            disabled={disabled}
            readOnly={Boolean(player.memberId)}
            value={player.firstName}
            onChange={(event) => update({ firstName: event.target.value })}
          />
        </label>
        <label>
          Nom
          <input
            required
            disabled={disabled}
            readOnly={Boolean(player.memberId)}
            value={player.lastName}
            onChange={(event) => update({ lastName: event.target.value })}
          />
        </label>
        <label>
          Club
          <input
            required
            disabled={disabled}
            readOnly={Boolean(player.memberId)}
            value={player.clubName}
            onChange={(event) => update({ clubName: event.target.value })}
          />
        </label>
        <label>
          E-mail
          <input
            required={!player.emailFromMember}
            type={player.emailFromMember ? "text" : "email"}
            disabled={disabled}
            readOnly={Boolean(player.emailFromMember)}
            value={
              player.emailFromMember
                ? "Récupéré depuis la fiche licencié"
                : (player.email ?? "")
            }
            onChange={(event) => update({ email: event.target.value })}
          />
        </label>
        <label>
          Téléphone
          <input
            required={!player.phoneFromMember}
            type={player.phoneFromMember ? "text" : "tel"}
            disabled={disabled}
            readOnly={Boolean(player.phoneFromMember)}
            value={
              player.phoneFromMember
                ? "Récupéré depuis la fiche licencié"
                : (player.phone ?? "")
            }
            onChange={(event) => update({ phone: event.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}
