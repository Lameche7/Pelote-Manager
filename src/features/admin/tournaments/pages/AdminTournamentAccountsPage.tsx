import { useEffect, useMemo, useState } from "react";
import {
  adminTournamentAccountService,
  type TournamentAccountAuditRow,
  type TournamentAccountCandidate,
} from "@/features/admin/tournaments/services/adminTournamentAccountService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import "./AdminTournamentAccountsPage.css";

const candidateLabel = (candidate: TournamentAccountCandidate) => {
  const name = [candidate.firstName, candidate.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || candidate.displayName || candidate.email || "Compte PILOTOKI";
};

const statusLabel = (status: TournamentAccountAuditRow["status"]) => {
  if (status === "recognized") return "Accès confirmé";
  if (status === "probable") return "Compte probable non lié";
  return "Aucun compte trouvé";
};

export function AdminTournamentAccountsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [items, setItems] = useState<TournamentAccountAuditRow[]>([]);
  const [filter, setFilter] = useState<"all" | "attention">("attention");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [linking, setLinking] = useState<TournamentAccountAuditRow | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidates, setCandidates] = useState<TournamentAccountCandidate[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAudit = async (tournamentId: string) => {
    if (!tournamentId) return;
    setItems(await adminTournamentAccountService.list(tournamentId));
  };

  useEffect(() => {
    let active = true;
    tournamentAdminService
      .list()
      .then(async (list) => {
        if (!active) return;
        setTournaments(list);
        const preferred =
          list.find((item) => !["archived", "cancelled"].includes(item.status)) ??
          list[0];
        if (preferred) {
          setSelectedId(preferred.id);
          const audit = await adminTournamentAccountService.list(preferred.id);
          if (active) setItems(audit);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger le contrôle des comptes.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseTournament = async (tournamentId: string) => {
    setSelectedId(tournamentId);
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadAudit(tournamentId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de charger le contrôle des comptes.",
      );
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(
    () => ({
      total: items.length,
      recognized: items.filter((item) => item.status === "recognized").length,
      probable: items.filter((item) => item.status === "probable").length,
      unmatched: items.filter((item) => item.status === "unmatched").length,
    }),
    [items],
  );

  const displayed = useMemo(
    () =>
      filter === "attention"
        ? items.filter((item) => item.status !== "recognized")
        : items,
    [filter, items],
  );

  const openLink = async (item: TournamentAccountAuditRow) => {
    setLinking(item);
    setCandidateSearch("");
    setSelectedProfileId(item.candidates[0]?.id ?? "");
    setCandidates(item.candidates);
    setError("");
    setMessage("");
    if (item.candidates.length === 0) {
      setSearching(true);
      try {
        const result = await adminTournamentAccountService.searchCandidates(
          item.externalIdentityId,
        );
        setCandidates(result);
        setSelectedProfileId(result[0]?.id ?? "");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de rechercher les comptes.",
        );
      } finally {
        setSearching(false);
      }
    }
  };

  const searchCandidates = async () => {
    if (!linking) return;
    setSearching(true);
    setError("");
    try {
      const result = await adminTournamentAccountService.searchCandidates(
        linking.externalIdentityId,
        candidateSearch,
      );
      setCandidates(result);
      setSelectedProfileId(result[0]?.id ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de rechercher les comptes.",
      );
    } finally {
      setSearching(false);
    }
  };

  const confirmLink = async () => {
    if (!linking || !selectedProfileId || !selectedId) return;
    const candidate = candidates.find((item) => item.id === selectedProfileId);
    const label = candidate ? candidateLabel(candidate) : "ce compte";
    if (
      !window.confirm(
        `Rattacher ${linking.firstName} ${linking.lastName} au compte ${label} ?`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      await adminTournamentAccountService.link(
        linking.externalIdentityId,
        selectedProfileId,
      );
      await loadAudit(selectedId);
      setMessage(
        `${linking.firstName} ${linking.lastName} est maintenant reconnu dans PILOTOKI.`,
      );
      setLinking(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de rattacher ce compte.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page admin-tournament-accounts">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Comptes joueurs</h1>
          <p className="admin-page__lead">
            Vérifiez que les participants ayant créé un compte PILOTOKI sont
            bien reconnus et peuvent accéder à leurs tournois.
          </p>
        </div>
      </header>

      {error && <p className="admin-tournament-accounts__error">{error}</p>}
      {message && <p className="admin-tournament-accounts__success">{message}</p>}

      <div className="admin-card admin-tournament-accounts__toolbar">
        <label>
          Tournoi
          <select
            value={selectedId}
            onChange={(event) => void chooseTournament(event.target.value)}
          >
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-tournament-accounts__filters">
          <button
            type="button"
            className={filter === "attention" ? "active" : ""}
            onClick={() => setFilter("attention")}
          >
            À corriger ({counts.probable + counts.unmatched})
          </button>
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            Tous ({counts.total})
          </button>
        </div>
      </div>

      <div className="admin-tournament-accounts__summary">
        <span><strong>{counts.recognized}</strong> accès confirmés</span>
        <span><strong>{counts.probable}</strong> comptes probables non liés</span>
        <span><strong>{counts.unmatched}</strong> sans compte trouvé</span>
      </div>

      {loading ? (
        <p role="status">Contrôle des comptes…</p>
      ) : (
        <div className="admin-card admin-tournament-accounts__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Participation</th>
                <th>État</th>
                <th>Compte PILOTOKI</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((item) => (
                <tr key={item.externalIdentityId}>
                  <td><strong>{item.firstName} {item.lastName}</strong></td>
                  <td>
                    {item.participations.map((participation) => (
                      <div key={`${participation.teamId}-${participation.seriesName}`}>
                        {participation.seriesName}
                        {participation.partnerName
                          ? ` · avec ${participation.partnerName}`
                          : ""}
                      </div>
                    ))}
                  </td>
                  <td>
                    <span className={`account-status account-status--${item.status}`}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>
                    {item.linkedProfile
                      ? `${candidateLabel(item.linkedProfile)} · ${item.linkedProfile.email}`
                      : item.candidates[0]
                        ? `${candidateLabel(item.candidates[0])} · ${item.candidates[0].email}`
                        : "—"}
                  </td>
                  <td>
                    {item.status !== "recognized" && (
                      <button type="button" onClick={() => void openLink(item)}>
                        Rattacher
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayed.length === 0 && (
            <p className="admin-tournament-accounts__empty">
              Aucun compte à corriger pour ce tournoi.
            </p>
          )}
        </div>
      )}

      {linking && (
        <div className="admin-tournament-accounts__backdrop">
          <div className="admin-tournament-accounts__dialog" role="dialog" aria-modal="true">
            <h2>Rattacher {linking.firstName} {linking.lastName}</h2>
            <p>
              Choisissez le compte PILOTOKI correspondant. Le rattachement donnera
              accès au tournoi, aux reports et aux résultats de cette participation.
            </p>

            <div className="admin-tournament-accounts__search">
              <input
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
                placeholder="Nom, prénom ou e-mail"
              />
              <button type="button" disabled={searching} onClick={() => void searchCandidates()}>
                {searching ? "Recherche…" : "Rechercher"}
              </button>
            </div>

            <div className="admin-tournament-accounts__candidates">
              {candidates.map((candidate) => (
                <label key={candidate.id}>
                  <input
                    type="radio"
                    name="profile"
                    value={candidate.id}
                    checked={selectedProfileId === candidate.id}
                    onChange={() => setSelectedProfileId(candidate.id)}
                  />
                  <span>
                    <strong>{candidateLabel(candidate)}</strong>
                    <small>{candidate.email}</small>
                  </span>
                </label>
              ))}
              {!searching && candidates.length === 0 && (
                <p>Aucun compte correspondant. Lancez une recherche manuelle.</p>
              )}
            </div>

            <footer>
              <button type="button" className="secondary" onClick={() => setLinking(null)}>
                Annuler
              </button>
              <button
                type="button"
                disabled={!selectedProfileId || saving}
                onClick={() => void confirmLink()}
              >
                {saving ? "Rattachement…" : "Confirmer le rattachement"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
