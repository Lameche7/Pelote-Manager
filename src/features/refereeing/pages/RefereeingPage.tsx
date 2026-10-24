import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TournamentScoreEditor } from "@/features/tournaments/components/TournamentScoreEditor";
import { WhistleIcon } from "@/features/refereeing/components/WhistleIcon";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  refereeingService,
  type RefereeingMatch,
  type RefereeingParticipation,
} from "@/features/refereeing/services/refereeingService";
import "./RefereeingPage.css";
const date = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "long",
      }).format(new Date(v + "T12:00:00"))
    : "Date à confirmer";
const time = (v: string | null) =>
  v ? v.slice(0, 5).replace(":", "h") : "Horaire à confirmer";
// The referee enters both teams' scores in one clearly labelled dialog.
export function RefereeingPage() {
  const [searchParams] = useSearchParams();
  const focusMatchId = searchParams.get("match");
  const [scoreMatch, setScoreMatch] = useState<RefereeingMatch | null>(null);
  const [scoreLeft, setScoreLeft] = useState("");
  const [scoreRight, setScoreRight] = useState("");
  const [scoreError, setScoreError] = useState("");
  const [tournamentEditor, setTournamentEditor] = useState<{
    matchId: string;
    rules: {
      matchFormat: "single_game" | "best_of_three_sets";
      singleGamePoints: number;
      mainSetPoints: number;
      decidingSetPoints: number;
    };
  } | null>(null);
  const [items, setItems] = useState<RefereeingMatch[]>([]),
    [participation, setParticipation] = useState<RefereeingParticipation[]>([]),
    [statsOpen, setStatsOpen] = useState(false),
    [groupsOpen, setGroupsOpen] = useState({
      championship: false,
      tournament: false,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const load = async () => {
    const [matches, stats] = await Promise.all([
      refereeingService.list(),
      refereeingService.participation(),
    ]);
    setItems(matches);
    setParticipation(stats);
  };
  useEffect(() => {
    let active = true;
    const refresh = () =>
      load().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Erreur");
      });
    refresh().finally(() => {
      if (active) setLoading(false);
    });
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  const upcoming = useMemo(
    () =>
      items.filter((x) =>
        focusMatchId && items.some((match) => match.match_id === focusMatchId)
          ? x.match_id === focusMatchId
          : x.is_mine ||
            !x.play_date ||
            x.play_date >= new Date().toISOString().slice(0, 10),
      ),
    [items, focusMatchId],
  );
  const championship = upcoming.filter((x) => x.source_type === "championship"),
    tournaments = upcoming.filter((x) => x.source_type === "tournament");
  const mine = upcoming.filter((x) => x.is_mine),
    open = upcoming.filter((x) => !x.referee_profile_id);
  const take = async (x: RefereeingMatch) => {
    setBusy(x.match_id);
    setError("");
    try {
      await refereeingService.volunteer(x);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de prendre cet arbitrage.",
      );
    } finally {
      setBusy("");
    }
  };
  const withdraw = async (x: RefereeingMatch) => {
    if (!window.confirm("Tu veux vraiment te retirer de cet arbitrage ?"))
      return;
    setBusy(x.match_id);
    setError("");
    try {
      await refereeingService.withdraw(x);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de retirer cet arbitrage.",
      );
    } finally {
      setBusy("");
    }
  };
  const submitScore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scoreMatch) return;
    const sa = Number(scoreLeft);
    const sb = Number(scoreRight);
    if (
      !scoreLeft.trim() ||
      !scoreRight.trim() ||
      !Number.isInteger(sa) ||
      !Number.isInteger(sb) ||
      sa < 0 ||
      sb < 0 ||
      sa === sb
    ) {
      setScoreError("Saisis deux scores entiers différents.");
      return;
    }
    setBusy(scoreMatch.match_id);
    setScoreError("");
    try {
      await refereeingService.submitChampionshipScore(
        scoreMatch.match_id,
        sa,
        sb,
      );
      setScoreMatch(null);
      await load();
    } catch (e) {
      setScoreError(
        e instanceof Error
          ? e.message
          : "Impossible d’enregistrer le résultat.",
      );
    } finally {
      setBusy("");
    }
  };
  const openChampionshipScore = (x: RefereeingMatch) => {
    setScoreMatch(x);
    setScoreLeft("");
    setScoreRight("");
    setScoreError("");
  };
  const openTournamentScore = async (x: RefereeingMatch) => {
    setBusy(x.match_id);
    setError("");
    try {
      const r = await refereeingService.tournamentRules(x.match_id);
      if (r.has_result) {
        setError("Un résultat a déjà été saisi pour cette partie.");
        return;
      }
      setTournamentEditor({
        matchId: x.match_id,
        rules: {
          matchFormat: r.match_format,
          singleGamePoints: r.single_game_points,
          mainSetPoints: r.main_set_points,
          decidingSetPoints: r.deciding_set_points,
        },
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de charger la saisie.",
      );
    } finally {
      setBusy("");
    }
  };
  const isFinished = (x: RefereeingMatch) => {
    if (!x.play_date || !x.play_time) return false;
    const start = new Date(`${x.play_date}T${x.play_time.slice(0, 5)}:00`);
    return (
      !Number.isNaN(start.getTime()) &&
      Date.now() >= start.getTime() + 60 * 60 * 1000
    );
  };
  const totalLicensed = participation[0]?.total_licensed ?? 0,
    differentReferees = participation[0]?.different_referees ?? 0,
    totalAssignments = participation.reduce(
      (sum, x) => sum + Number(x.arbitration_count),
      0,
    ),
    participationRate = totalLicensed
      ? Math.round((differentReferees / totalLicensed) * 100)
      : 0;
  const Stats = () => (
    <section className="ref-stats">
      <button
        className="ref-stats__toggle"
        type="button"
        onClick={() => setStatsOpen((v) => !v)}
        aria-expanded={statsOpen}
      >
        <span>
          <strong>Participation à l’arbitrage</strong>
          <small>
            {differentReferees} arbitre(s) différent(s) / {totalLicensed}{" "}
            licencié(s) · {totalAssignments} arbitrage(s) attribué(s) ·{" "}
            {participationRate}% de participation
          </small>
        </span>
        <span>{statsOpen ? "Masquer le détail ▲" : "Voir le détail ▼"}</span>
      </button>
      {statsOpen && (
        <div className="ref-stats__detail">
          <table>
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Arbitrages</th>
              </tr>
            </thead>
            <tbody>
              {participation.map((x) => (
                <tr
                  key={x.member_id}
                  className={
                    Number(x.arbitration_count) === 0 ? "ref-stats__zero" : ""
                  }
                >
                  <td>{x.player_name}</td>
                  <td>{x.arbitration_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
  const Card = ({ x, action }: { x: RefereeingMatch; action: boolean }) => (
    <article
      className={
        "ref-card " + (x.referee_profile_id ? "ref-card--ok" : "ref-card--open")
      }
    >
      <div className="ref-card__top">
        <span>
          {x.source_type === "championship" ? "Championnat" : "Tournoi"}
        </span>
        <strong>
          {x.referee_profile_id
            ? "🟢 Arbitre confirmé"
            : "🔴 Arbitre recherché"}
        </strong>
      </div>
      <h3>
        {x.team1_label} <span>contre</span> {x.team2_label}
      </h3>
      <p>
        <strong>
          {date(x.play_date)} · {time(x.play_time)}
        </strong>
        {x.venue ? <> · {x.venue}</> : null}
      </p>
      <small>{x.competition_label}</small>
      {x.referee_name && (
        <p className="ref-card__ref">
          Arbitre : <strong>{x.referee_name}</strong>
        </p>
      )}
      {x.is_mine && x.source_type === "tournament" && (
        <button
          disabled={busy === x.match_id || !isFinished(x)}
          onClick={() => void openTournamentScore(x)}
        >
          Saisie Résultat
        </button>
      )}
      {x.is_mine && x.source_type === "championship" && (
        <button
          disabled={busy === x.match_id || !isFinished(x)}
          onClick={() => openChampionshipScore(x)}
        >
          {isFinished(x) ? "Saisir le résultat" : "Saisie Résultat"}
        </button>
      )}
      {x.is_mine && (
        <button
          className="ref-card__withdraw"
          disabled={busy === x.match_id}
          onClick={() => void withdraw(x)}
        >
          {busy === x.match_id ? "Retrait…" : "Me retirer"}
        </button>
      )}
      {action && (
        <button disabled={busy === x.match_id} onClick={() => void take(x)}>
          {busy === x.match_id ? "Attribution…" : "Je peux arbitrer"}
        </button>
      )}
    </article>
  );
  return (
    <UserSpaceShell>
      <section className="ref-page">
        <header>
          <p className="ref-page__eyebrow">Vie du club</p>
          <h1>
            <WhistleIcon aria-hidden="true" width="28" height="28" /> Arbitrage
          </h1>
          <p>
            Les parties de championnat à domicile et les tournois pour lesquels
            l’arbitrage est activé.
          </p>
        </header>
        {error && (
          <p role="alert" className="ref-page__error">
            {error}
          </p>
        )}
        {loading ? (
          <p>Chargement…</p>
        ) : (
          <>
            <Stats />
            <div className="ref-page__summary">
              <strong>{mine.length}</strong>
              <span>arbitrage(s) à venir pour moi</span>
              <strong>{open.length}</strong>
              <span>partie(s) encore à pourvoir</span>
            </div>
            {(
              [
                {
                  key: "championship",
                  title: "Championnat",
                  items: championship,
                },
                { key: "tournament", title: "Tournois", items: tournaments },
              ] as const
            ).map((group) => {
              const groupMine = group.items.filter((x) => x.is_mine),
                groupOpen = group.items.filter((x) => !x.referee_profile_id);
              return (
                <section className="ref-group" key={group.key}>
                  <div className="ref-group__heading">
                    <h2>{group.title}</h2>
                    <div className="ref-group__actions">
                      <span>{groupOpen.length} à pourvoir</span>
                      <button
                        type="button"
                        onClick={() =>
                          setGroupsOpen((v) => ({
                            ...v,
                            [group.key]: !v[group.key],
                          }))
                        }
                        aria-expanded={groupsOpen[group.key]}
                      >
                        {groupsOpen[group.key] ? "Masquer ▲" : "Afficher ▼"}
                      </button>
                    </div>
                  </div>
                  {groupsOpen[group.key] && (
                    <>
                      <h3 className="ref-section-title">
                        Mes prochains arbitrages
                      </h3>
                      <div className="ref-grid">
                        {groupMine.length ? (
                          groupMine.map((x) => (
                            <Card key={x.match_id} x={x} action={false} />
                          ))
                        ) : (
                          <p className="ref-empty">Aucun arbitrage prévu.</p>
                        )}
                      </div>
                      <h3 className="ref-section-title">Parties à arbitrer</h3>
                      <div className="ref-grid">
                        {groupOpen.length ? (
                          groupOpen.map((x) => (
                            <Card key={x.match_id} x={x} action />
                          ))
                        ) : (
                          <p className="ref-empty">
                            Toutes les parties sont couvertes 👍
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </>
        )}
        {(scoreMatch || tournamentEditor) && (
          <div className="ref-score-backdrop" role="presentation">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="ref-score-title"
              className="ref-score-dialog"
            >
              <h2 id="ref-score-title">Saisir le résultat</h2>
              {scoreMatch ? (
                <form onSubmit={(event) => void submitScore(event)}>
                  <p className="ref-score-dialog__context">
                    {scoreMatch.competition_label} ·{" "}
                    {date(scoreMatch.play_date)} · {time(scoreMatch.play_time)}
                  </p>
                  <div className="ref-score-dialog__teams">
                    <label>
                      <strong>{scoreMatch.team1_label}</strong>
                      <span>Points marqués</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        required
                        autoFocus
                        value={scoreLeft}
                        onChange={(event) => setScoreLeft(event.target.value)}
                        disabled={busy === scoreMatch.match_id}
                      />
                    </label>
                    <span className="ref-score-dialog__versus">—</span>
                    <label>
                      <strong>{scoreMatch.team2_label}</strong>
                      <span>Points marqués</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        required
                        value={scoreRight}
                        onChange={(event) => setScoreRight(event.target.value)}
                        disabled={busy === scoreMatch.match_id}
                      />
                    </label>
                  </div>
                  {scoreError && (
                    <p role="alert" className="ref-page__error">
                      {scoreError}
                    </p>
                  )}
                  <p className="ref-score-dialog__hint">
                    Vérifie les noms des équipes avant de transmettre le
                    résultat au club.
                  </p>
                  <div className="ref-score-dialog__actions">
                    <button
                      type="button"
                      onClick={() => setScoreMatch(null)}
                      disabled={busy === scoreMatch.match_id}
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={
                        busy === scoreMatch.match_id ||
                        !scoreLeft.trim() ||
                        !scoreRight.trim()
                      }
                    >
                      {busy === scoreMatch.match_id
                        ? "Enregistrement…"
                        : "Valider le résultat"}
                    </button>
                  </div>
                </form>
              ) : tournamentEditor ? (
                <>
                  <p className="ref-score-dialog__context">
                    {
                      items.find((x) => x.match_id === tournamentEditor.matchId)
                        ?.competition_label
                    }
                  </p>
                  <TournamentScoreEditor
                    rules={tournamentEditor.rules}
                    leftLabel={
                      items.find((x) => x.match_id === tournamentEditor.matchId)
                        ?.team1_label ?? "Équipe 1"
                    }
                    rightLabel={
                      items.find((x) => x.match_id === tournamentEditor.matchId)
                        ?.team2_label ?? "Équipe 2"
                    }
                    disabled={busy === tournamentEditor.matchId}
                    submitLabel="Valider le résultat"
                    onCancel={() => setTournamentEditor(null)}
                    onSubmit={async (score) => {
                      setBusy(tournamentEditor.matchId);
                      try {
                        await refereeingService.submitTournamentScore(
                          tournamentEditor.matchId,
                          score.sets,
                        );
                        setTournamentEditor(null);
                        await load();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Impossible de saisir le résultat.",
                        );
                        throw e;
                      } finally {
                        setBusy("");
                      }
                    }}
                  />
                </>
              ) : null}
            </section>
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
