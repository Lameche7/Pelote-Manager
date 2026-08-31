import { Fragment, useMemo, useState } from "react";
import {
  errebotIdentityReasonLabel,
  errebotIdentityStatusLabel,
  type ErrebotIdentityMatch,
  type ErrebotIdentityMatchRequest,
} from "../domain/errebotIdentityMatching";
import {
  errebotImportService,
  type ErrebotIdentityCandidate,
} from "../services/errebotImportService";
import "./ErrebotIdentityReview.css";

type ReviewFilter = "review" | "all" | "unmatched" | "verified";

type Props = {
  matches: ErrebotIdentityMatch[];
  requests: ErrebotIdentityMatchRequest[];
  onMatchesChange: (matches: ErrebotIdentityMatch[]) => void;
};

const filterLabels: Array<{ value: ReviewFilter; label: string }> = [
  { value: "review", label: "À décider" },
  { value: "all", label: "Tous" },
  { value: "unmatched", label: "Non trouvés" },
  { value: "verified", label: "Vérifiés" },
];

export function ErrebotIdentityReview({
  matches,
  requests,
  onMatchesChange,
}: Props) {
  const [filter, setFilter] = useState<ReviewFilter>("review");
  const [activeSearchKey, setActiveSearchKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [candidates, setCandidates] = useState<ErrebotIdentityCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const requestByKey = useMemo(
    () => new Map(requests.map((request) => [request.externalKey, request])),
    [requests],
  );

  const visibleMatches = useMemo(
    () =>
      matches.filter((match) => {
        if (filter === "all") return true;
        if (filter === "review") {
          return match.status === "suggested" || match.status === "conflict";
        }
        return match.status === filter;
      }),
    [filter, matches],
  );

  const reviewCount = matches.filter(
    (match) => match.status === "suggested" || match.status === "conflict",
  ).length;

  const search = async (value: string) => {
    const query = value.trim();
    setSearchText(value);
    setError("");
    if (query.length < 2) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    try {
      setCandidates(await errebotImportService.searchIdentityCandidates(query));
    } catch (cause) {
      setCandidates([]);
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de rechercher les licenciés.",
      );
    } finally {
      setSearching(false);
    }
  };

  const openSearch = (match: ErrebotIdentityMatch) => {
    const initial = `${match.firstName} ${match.lastName}`.trim();
    setActiveSearchKey(match.externalKey);
    setCandidates([]);
    void search(initial);
  };

  const confirm = async (match: ErrebotIdentityMatch, memberId: string) => {
    const request = requestByKey.get(match.externalKey);
    if (!request) {
      setError("Identité Errebot introuvable dans la prévisualisation locale.");
      return;
    }

    setBusyKey(match.externalKey);
    setError("");
    try {
      const confirmed = await errebotImportService.confirmIdentityMatch(
        request,
        memberId,
      );
      onMatchesChange(
        matches.map((current) =>
          current.externalKey === confirmed.externalKey ? confirmed : current,
        ),
      );
      setActiveSearchKey(null);
      setCandidates([]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de confirmer ce rapprochement.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="admin-card admin-tournament-import__card errebot-identity-review">
      <div>
        <h2>Rapprochement des joueurs</h2>
        <p>
          Confirmez uniquement les correspondances sûres. Les joueurs non
          trouvés et les suggestions laissées sans validation resteront externes
          lors de l’import.
        </p>
      </div>

      <div className="errebot-identity-review__filters" aria-label="Filtrer les joueurs">
        {filterLabels.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "is-active" : ""}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
            {item.value === "review" ? ` (${reviewCount})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <p className="admin-tournament-import__alert" role="alert">
          {error}
        </p>
      )}

      <div className="admin-tournament-import__table-wrap">
        <table className="admin-tournament-import__table admin-tournament-import__matches">
          <thead>
            <tr>
              <th>Équipe</th>
              <th>Joueur Errebot</th>
              <th>Statut</th>
              <th>Correspondance Pelote Manager</th>
              <th>Pourquoi</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleMatches.map((match) => (
              <Fragment key={match.externalKey}>
                <tr>
                  <td>#{match.teamExternalId}</td>
                  <td>
                    {match.firstName} {match.lastName}
                  </td>
                  <td>
                    <span
                      className={`admin-tournament-import__match-status is-${match.status}`}
                    >
                      {errebotIdentityStatusLabel(match.status)}
                    </span>
                  </td>
                  <td>
                    {match.memberDisplayName ? (
                      <div className="admin-tournament-import__candidate">
                        <strong>{match.memberDisplayName}</strong>
                        <span>
                          {match.licenceNumber ?? "Licence inconnue"}
                          {match.clubName ? ` · ${match.clubName}` : ""}
                          {match.linkedAccount ? " · compte lié" : ""}
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{errebotIdentityReasonLabel(match.reason)}</td>
                  <td>
                    <div className="errebot-identity-review__row-actions">
                      {match.status === "suggested" && match.memberId && (
                        <button
                          type="button"
                          className="admin-tournament-import__primary"
                          disabled={busyKey === match.externalKey}
                          onClick={() => void confirm(match, match.memberId!)}
                        >
                          {busyKey === match.externalKey
                            ? "Validation…"
                            : "Confirmer"}
                        </button>
                      )}
                      {match.status !== "verified" && (
                        <button
                          type="button"
                          disabled={busyKey === match.externalKey}
                          onClick={() => openSearch(match)}
                        >
                          Rechercher
                        </button>
                      )}
                      {match.status === "verified" && <span>Validé</span>}
                    </div>
                  </td>
                </tr>

                {activeSearchKey === match.externalKey && (
                  <tr className="errebot-identity-review__search-row">
                    <td colSpan={6}>
                      <div className="errebot-identity-review__search-panel">
                        <label>
                          Rechercher un licencié
                          <input
                            value={searchText}
                            autoFocus
                            onChange={(event) => void search(event.target.value)}
                            placeholder="Nom, prénom ou numéro de licence"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSearchKey(null);
                            setCandidates([]);
                          }}
                        >
                          Fermer
                        </button>
                      </div>

                      {searching ? (
                        <p>Recherche en cours…</p>
                      ) : candidates.length > 0 ? (
                        <div className="errebot-identity-review__candidates">
                          {candidates.map((candidate) => (
                            <div key={candidate.id}>
                              <span>
                                <strong>{candidate.displayName}</strong>
                                <small>
                                  {candidate.licenceNumber ?? "Licence inconnue"}
                                  {candidate.clubName
                                    ? ` · ${candidate.clubName}`
                                    : ""}
                                  {candidate.linkedAccount
                                    ? " · compte lié"
                                    : ""}
                                </small>
                              </span>
                              <button
                                type="button"
                                className="admin-tournament-import__primary"
                                disabled={busyKey === match.externalKey}
                                onClick={() => void confirm(match, candidate.id)}
                              >
                                Associer
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : searchText.trim().length >= 2 ? (
                        <p>Aucun licencié trouvé avec cette recherche.</p>
                      ) : null}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {visibleMatches.length === 0 && (
        <p className="admin-tournament-import__success">
          Aucun joueur ne reste dans ce filtre.
        </p>
      )}

      <p className="admin-tournament-import__privacy-note">
        Une validation est persistée comme identité Errebot vérifiée et pourra
        être réutilisée lors d’un prochain tournoi. La recherche manuelle ne
        renvoie ni email ni téléphone.
      </p>
    </div>
  );
}
