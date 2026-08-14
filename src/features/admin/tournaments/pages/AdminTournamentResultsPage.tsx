import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TournamentScoreEditor,
  type TournamentScorePayload,
} from "@/features/tournaments/components/TournamentScoreEditor";
import {
  tournamentResultsAdminService,
  type AdminTournamentResultMatch,
  type AdminTournamentResultsWorkspace,
} from "@/features/admin/tournaments/services/tournamentResultsAdminService";
import "./AdminTournamentResultsPage.css";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const scoreLabel = (match: AdminTournamentResultMatch) =>
  match.result?.score.sets
    .map((set) => `${set.teamA}-${set.teamB}`)
    .join(" · ") ?? "—";

export function AdminTournamentResultsPage() {
  const [workspaces, setWorkspaces] = useState<AdminTournamentResultsWorkspace[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const loaded = await tournamentResultsAdminService.getWorkspace();
    setWorkspaces(loaded);
    setSelectedId((current) =>
      current && loaded.some((workspace) => workspace.id === current)
        ? current
        : (loaded[0]?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    load()
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Chargement des résultats impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [selectedId, workspaces],
  );

  const pendingCount =
    selected?.matches.filter(
      (match) => match.result?.status === "pending_validation",
    ).length ?? 0;

  const validatedCount =
    selected?.matches.filter((match) => match.result?.status === "validated")
      .length ?? 0;

  const validate = async (matchId: string) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentResultsAdminService.validate(matchId);
      await load();
      setMessage("Résultat validé. Il pourra alimenter le classement.");
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Validation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const save = async (matchId: string, score: TournamentScorePayload) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentResultsAdminService.save(matchId, score);
      setEditingMatchId(null);
      await load();
      setMessage("Résultat enregistré et validé par l’administration.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-page tournament-results-page">
        <p role="status">Chargement du Result Engine…</p>
      </section>
    );
  }

  return (
    <section className="admin-page tournament-results-page">
      <header className="admin-page__header tournament-results-heading">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Résultats</h1>
          <p className="admin-page__lead">
            Validez les résultats transmis par les joueurs ou saisissez-les
            directement. Seuls les résultats validés alimenteront le classement.
          </p>
        </div>
      </header>

      {error && (
        <p className="tournament-results-alert tournament-results-alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="tournament-results-alert" role="status">
          {message}
        </p>
      )}

      {workspaces.length === 0 ? (
        <div className="admin-card tournament-results-empty">
          <h2>Aucun planning publié</h2>
          <p>
            Les résultats deviennent disponibles dès qu’un tournoi possède un
            planning publié.
          </p>
        </div>
      ) : (
        <>
          <div className="admin-card tournament-results-toolbar">
            <label>
              Tournoi
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setEditingMatchId(null);
                }}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <strong>{pendingCount}</strong>
              <span>à valider</span>
            </div>
            <div>
              <strong>{validatedCount}</strong>
              <span>validés</span>
            </div>
          </div>

          {selected && (
            <div className="tournament-results-list">
              {selected.matches.map((match) => {
                const editing = editingMatchId === match.id;
                return (
                  <article className="admin-card tournament-result-card" key={match.id}>
                    <header>
                      <div>
                        <span>
                          {match.seriesName} · Poule {match.poolNumber}
                        </span>
                        <strong>
                          {match.teamALabel} — {match.teamBLabel}
                        </strong>
                        <small>
                          {dateFormatter.format(new Date(`${match.playDate}T12:00:00`))}
                          {" · "}
                          {match.startsAt} · {match.resourceName}
                        </small>
                      </div>
                      <div className="tournament-result-card__status">
                        {match.result ? (
                          <>
                            <strong>{scoreLabel(match)}</strong>
                            <span
                              data-status={match.result.status}
                            >
                              {match.result.status === "validated"
                                ? "Validé"
                                : "À valider"}
                            </span>
                          </>
                        ) : (
                          <span data-status="missing">Résultat manquant</span>
                        )}
                      </div>
                    </header>

                    {match.result && (
                      <p className="tournament-result-card__calculation">
                        Points de classement calculés : {match.teamALabel}{" "}
                        <strong>{match.result.teamARankingPoints}</strong> ·{" "}
                        {match.teamBLabel}{" "}
                        <strong>{match.result.teamBRankingPoints}</strong>
                      </p>
                    )}

                    {!editing && (
                      <div className="tournament-result-card__actions">
                        {match.result?.status === "pending_validation" && (
                          <button
                            className="tournament-results-primary"
                            type="button"
                            disabled={saving}
                            onClick={() => void validate(match.id)}
                          >
                            Valider ce résultat
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setEditingMatchId(match.id)}
                        >
                          {match.result ? "Corriger le score" : "Saisir le résultat"}
                        </button>
                      </div>
                    )}

                    {editing && (
                      <TournamentScoreEditor
                        rules={selected.sportingRules}
                        teamSide="a"
                        leftLabel={match.teamALabel}
                        rightLabel={match.teamBLabel}
                        initialScore={match.result?.score ?? null}
                        disabled={saving}
                        submitLabel={
                          saving ? "Enregistrement…" : "Enregistrer et valider"
                        }
                        onCancel={() => setEditingMatchId(null)}
                        onSubmit={(score) => save(match.id, score)}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
