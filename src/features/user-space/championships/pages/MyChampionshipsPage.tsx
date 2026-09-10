import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Send,
  Trophy,
} from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  myChampionshipResultSettingsService,
  type MyChampionshipResultSettings,
} from "@/features/user-space/championships/services/myChampionshipResultSettingsService";
import {
  myChampionshipRankingContextService,
  type MyChampionshipRankingContext,
  type MyChampionshipRankingPool,
  type MyChampionshipRankingStanding,
} from "@/features/user-space/championships/services/myChampionshipRankingContextService";
import {
  myChampionshipsService,
  type MyChampionship,
  type MyChampionshipMatch,
} from "@/features/user-space/championships/services/myChampionshipsService";
import "./MyChampionshipsPage.css";

const statusLabels: Record<string, string> = {
  preparation: "Préparation",
  active: "En cours",
  completed: "Terminé",
  archived: "Archivé",
};

const matchStatusLabels: Record<string, string> = {
  to_schedule: "À organiser",
  scheduled: "Programmée",
  postponed: "Reportée",
  played: "Jouée",
  forfeit: "Forfait",
  cancelled: "Annulée",
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeParts = (match: MyChampionshipMatch) => ({
  date: match.agreementOn ?? match.reportOn ?? match.scheduledOn,
  time: match.agreementTime ?? match.reportTime ?? match.scheduledTime,
});

const matchTimestamp = (match: MyChampionshipMatch) => {
  const { date, time } = dateTimeParts(match);
  if (!date) return null;
  const parsed = new Date(`${date}T${time?.slice(0, 5) || "12:00"}:00`);
  const value = parsed.getTime();
  return Number.isNaN(value) ? null : value;
};

const displayDate = (value: string | null) => {
  if (!value) return "Date à définir";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const displayTime = (value: string | null) =>
  value ? value.slice(0, 5) : "Horaire à définir";

const hasOfficialResult = (match: MyChampionshipMatch) =>
  match.scoreRaw !== null ||
  (match.scoreMine !== null && match.scoreOpponent !== null);

const displayScore = (match: MyChampionshipMatch) => {
  if (match.scoreMine !== null && match.scoreOpponent !== null) {
    return `${match.scoreMine} – ${match.scoreOpponent}`;
  }
  if (match.scoreRaw) return match.scoreRaw;
  if (match.submission) {
    return `${match.submission.scoreMine} – ${match.submission.scoreOpponent}`;
  }
  return "Résultat en attente";
};

const resultTone = (match: MyChampionshipMatch) => {
  const mine = match.scoreMine ?? match.submission?.scoreMine ?? null;
  const opponent =
    match.scoreOpponent ?? match.submission?.scoreOpponent ?? null;
  if (mine === null || opponent === null) return "pending";
  if (mine > opponent) return "win";
  if (mine < opponent) return "loss";
  return "draw";
};

const officialSourceHref = (value: string) =>
  /^https?:\/\//iu.test(value) ? value : `https://${value}`;

function ResultSubmission({
  match,
  settings,
  onSaved,
}: {
  match: MyChampionshipMatch;
  settings: MyChampionshipResultSettings | null;
  onSaved: () => Promise<void>;
}) {
  const submission = match.submission;
  const timestamp = matchTimestamp(match);
  const matchAllowsSubmission =
    !hasOfficialResult(match) &&
    !["cancelled", "forfeit"].includes(match.status) &&
    (timestamp === null || timestamp <= Date.now());
  const configured = Boolean(
    settings?.inputMode && settings.winningScore !== null,
  );
  const canSubmit = matchAllowsSubmission && configured;
  const [editing, setEditing] = useState(false);
  const [scoreMine, setScoreMine] = useState(
    submission?.status === "pending" ? String(submission.scoreMine) : "",
  );
  const [scoreOpponent, setScoreOpponent] = useState(
    submission?.status === "pending" ? String(submission.scoreOpponent) : "",
  );
  const [comment, setComment] = useState(
    submission?.status === "pending" ? (submission.comment ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isSets = settings?.inputMode === "sets";
  const winningScore = settings?.winningScore ?? null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mine = Number(scoreMine);
    const opponent = Number(scoreOpponent);
    if (!configured || winningScore === null) {
      setError("Le format de résultat n’est pas encore paramétré.");
      return;
    }
    if (
      !Number.isInteger(mine) ||
      !Number.isInteger(opponent) ||
      mine < 0 ||
      opponent < 0 ||
      mine === opponent ||
      Math.max(mine, opponent) !== winningScore ||
      Math.min(mine, opponent) >= winningScore
    ) {
      setError(
        isSets
          ? `La partie doit avoir un vainqueur à ${winningScore} manche${winningScore > 1 ? "s" : ""}.`
          : `La partie doit avoir un vainqueur à ${winningScore} point${winningScore > 1 ? "s" : ""}.`,
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      await myChampionshipsService.submitResult(
        match.id,
        mine,
        opponent,
        comment.trim(),
      );
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer votre résultat.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="my-championships__submission">
      {submission?.status === "pending" && (
        <div className="my-championships__submission-status is-pending">
          <Send aria-hidden="true" />
          <span>
            <strong>
              Résultat proposé : {submission.scoreMine} –{" "}
              {submission.scoreOpponent}
            </strong>
            En attente de confirmation par la source officielle.
          </span>
        </div>
      )}
      {submission?.status === "confirmed_official" && (
        <div className="my-championships__submission-status is-confirmed">
          <CheckCircle2 aria-hidden="true" />
          <span>
            <strong>La proposition de votre équipe a été confirmée.</strong>
            La mise à jour officielle correspond à votre proposition.
          </span>
        </div>
      )}
      {submission?.status === "conflict_official" && (
        <div className="my-championships__submission-status is-conflict">
          <AlertTriangle aria-hidden="true" />
          <span>
            <strong>Résultat officiel différent.</strong>
            Votre équipe avait proposé {submission.scoreMine} –{" "}
            {submission.scoreOpponent}
            {submission.officialScoreMine !== null &&
              submission.officialScoreOpponent !== null &&
              ` · Source officielle : ${submission.officialScoreMine} – ${submission.officialScoreOpponent}`}
          </span>
        </div>
      )}

      {matchAllowsSubmission && !configured && (
        <div className="my-championships__submission-status is-pending">
          <AlertTriangle aria-hidden="true" />
          <span>
            <strong>Saisie du résultat non paramétrée.</strong>
            L’administrateur du championnat doit d’abord choisir un score en
            points ou en manches.
          </span>
        </div>
      )}

      {canSubmit && !editing && (
        <button
          type="button"
          className="my-championships__submission-toggle"
          onClick={() => setEditing(true)}
        >
          <Send aria-hidden="true" />
          {submission?.status === "pending"
            ? "Corriger ma proposition"
            : "Saisir le résultat"}
        </button>
      )}

      {canSubmit && editing && winningScore !== null && (
        <form className="my-championships__submission-form" onSubmit={submit}>
          <div className="my-championships__score-fields">
            <label>
              <span>{isSets ? "Nos manches" : "Nos points"}</span>
              <input
                type="number"
                min="0"
                max={winningScore}
                inputMode="numeric"
                value={scoreMine}
                onChange={(event) => setScoreMine(event.target.value)}
                required
              />
            </label>
            <label>
              <span>{isSets ? "Manches adverses" : "Points adverses"}</span>
              <input
                type="number"
                min="0"
                max={winningScore}
                inputMode="numeric"
                value={scoreOpponent}
                onChange={(event) => setScoreOpponent(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="my-championships__submission-comment">
            <span>Commentaire facultatif</span>
            <input
              type="text"
              maxLength={250}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Ex. partie terminée à 20h15"
            />
          </label>
          {error && (
            <div className="my-championships__submission-error" role="alert">
              {error}
            </div>
          )}
          <div className="my-championships__submission-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Envoi…" : "Envoyer le résultat"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError("");
              }}
              disabled={saving}
            >
              Annuler
            </button>
          </div>
          <small>
            Format attendu : premier à {winningScore}{" "}
            {isSets ? "manche(s)" : "point(s)"}. Cette proposition n’écrase
            jamais le résultat officiel. Elle sera confirmée ou signalée comme
            différente lors de la prochaine mise à jour officielle.
          </small>
        </form>
      )}
    </div>
  );
}

function MatchRow({
  match,
  settings,
  emphasis,
  onResultSaved,
  readOnly = false,
}: {
  match: MyChampionshipMatch;
  settings: MyChampionshipResultSettings | null;
  emphasis?: "next" | "last";
  onResultSaved: () => Promise<void>;
  readOnly?: boolean;
}) {
  const { date, time } = dateTimeParts(match);
  const place = match.agreementVenue ?? match.venue;
  const tone = resultTone(match);
  return (
    <article
      className={`my-championships__match${
        emphasis ? ` my-championships__match--${emphasis}` : ""
      }`}
    >
      <div className="my-championships__match-summary">
        <div className="my-championships__match-date">
          <strong>{displayDate(date)}</strong>
          <span>{displayTime(time)}</span>
        </div>
        <div className="my-championships__match-main">
          <span>
            {match.phase}
            {match.poolCode ? ` · Poule ${match.poolCode}` : ""}
          </span>
          <strong>vs {match.opponentLabel || "Adversaire à définir"}</strong>
          {place && <small>{place}</small>}
        </div>
        <div className={`my-championships__match-result is-${tone}`}>
          <strong>{displayScore(match)}</strong>
          <span>
            {hasOfficialResult(match)
              ? "Résultat officiel"
              : match.submission
                ? "Résultat proposé"
                : (matchStatusLabels[match.status] ?? match.status)}
          </span>
        </div>
      </div>
      {!readOnly && (
        <ResultSubmission
          match={match}
          settings={settings}
          onSaved={onResultSaved}
        />
      )}
    </article>
  );
}

type RankingRow = MyChampionshipRankingStanding;

function PoolTable({
  pool,
  fallback,
}: {
  pool: MyChampionshipRankingPool | null;
  fallback: MyChampionship;
}) {
  const rows: RankingRow[] = pool
    ? pool.standings
    : fallback.poolStandings.map((team) => ({
        teamId: team.teamId,
        teamLabel: team.teamLabel,
        clubName: team.clubName,
        teamNumber: team.teamNumber,
        officialRank: team.officialRank,
        officialPoints: team.officialPoints,
        isMyTeam: team.isMyTeam,
        played: team.played,
        wins: team.wins,
        draws: team.draws,
        losses: team.losses,
        scoreFor: team.scoreFor,
        scoreAgainst: team.scoreAgainst,
        scoreDifference: team.scoreDifference,
        hasOfficialStanding: team.statsSource === "official",
      }));

  if (rows.length === 0) {
    return (
      <div className="my-championships__empty-block">
        Le classement de cette poule n’est pas encore disponible.
      </div>
    );
  }

  const hasOfficial = rows.some((team) => team.hasOfficialStanding);
  return (
    <>
      <div className="my-championships__table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rang</th>
              <th>Équipe</th>
              <th>Pts</th>
              <th>J</th>
              <th>V</th>
              <th>D</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => (
              <tr
                key={team.teamId}
                className={team.isMyTeam ? "is-mine" : undefined}
              >
                <td>
                  <strong>{team.officialRank ?? "—"}</strong>
                </td>
                <td>
                  <strong>{team.teamLabel}</strong>
                  <span>{team.clubName}</span>
                </td>
                <td>{team.officialPoints ?? "—"}</td>
                <td>{team.played}</td>
                <td>{team.wins}</td>
                <td>{team.losses}</td>
                <td>
                  {team.scoreDifference > 0 ? "+" : ""}
                  {team.scoreDifference}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        {hasOfficial
          ? "Rang, points et statistiques issus du classement officiel importé. Pelote Manager ne recalcule pas les règles de classement."
          : "Classement officiel non encore disponible pour cette poule."}
      </small>
    </>
  );
}

const qualificationLabel = (
  rank: number,
  context: MyChampionshipRankingContext,
) => {
  const { directCutoff, barrageStart, barrageEnd } = context.qualification;
  if (directCutoff !== null && rank <= directCutoff) {
    return { key: "direct", label: "Zone de qualification directe" } as const;
  }
  if (
    barrageStart !== null &&
    barrageEnd !== null &&
    rank >= barrageStart &&
    rank <= barrageEnd
  ) {
    return { key: "barrage", label: "Zone barrage" } as const;
  }
  return { key: "outside", label: "Hors zone de qualification" } as const;
};

function GeneralTable({ context }: { context: MyChampionshipRankingContext }) {
  const myStanding = context.generalStandings.find((team) => team.isMyTeam);
  const myZone = myStanding
    ? qualificationLabel(myStanding.rank, context)
    : null;

  if (context.generalStandings.length === 0) {
    return (
      <div className="my-championships__empty-block">
        Le classement général officiel à l’issue des poules n’est pas encore
        disponible.
      </div>
    );
  }

  return (
    <>
      {myStanding && myZone && (
        <div
          className={`my-championships__qualification is-${myZone.key}`}
          role="status"
        >
          <div>
            <span>Votre situation</span>
            <strong>
              {myStanding.rank}e / {context.generalStandings.length}
            </strong>
          </div>
          <p>{myZone.label}</p>
        </div>
      )}
      <div className="my-championships__table-scroll">
        <table>
          <thead>
            <tr>
              <th>Gén.</th>
              <th>Équipe</th>
              <th>Poule</th>
              <th>Rang poule</th>
              <th>Pts</th>
              <th>J</th>
              <th>V</th>
              <th>D</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {context.generalStandings.map((team) => {
              const zone = qualificationLabel(team.rank, context);
              const boundaryClass =
                team.rank === context.qualification.directCutoff
                  ? " qualification-boundary-direct"
                  : team.rank === context.qualification.barrageEnd
                    ? " qualification-boundary-barrage"
                    : "";
              return (
                <tr
                  key={team.teamId}
                  className={`${team.isMyTeam ? "is-mine" : ""} is-${zone.key}${boundaryClass}`.trim()}
                >
                  <td>
                    <strong>{team.rank}</strong>
                  </td>
                  <td>
                    <strong>{team.teamLabel}</strong>
                    <span>{team.clubName}</span>
                  </td>
                  <td>{team.poolCode ?? "—"}</td>
                  <td>{team.poolRank ?? "—"}</td>
                  <td>{team.points ?? "—"}</td>
                  <td>{team.played}</td>
                  <td>{team.wins}</td>
                  <td>{team.losses}</td>
                  <td>
                    {team.scoreDifference > 0 ? "+" : ""}
                    {team.scoreDifference}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="my-championships__qualification-legend">
        {context.qualification.directCutoff !== null && (
          <span className="is-direct">
            Qualification directe : 1 à {context.qualification.directCutoff}
          </span>
        )}
        {context.qualification.barrageStart !== null &&
          context.qualification.barrageEnd !== null && (
            <span className="is-barrage">
              Barrage : {context.qualification.barrageStart} à{" "}
              {context.qualification.barrageEnd}
            </span>
          )}
      </div>
      <small>
        Classement général et statistiques issus de la source officielle. Les
        zones sont déduites uniquement des phases finales officielles déjà
        publiées.
      </small>
    </>
  );
}

function Standings({
  championship,
  context,
}: {
  championship: MyChampionship;
  context: MyChampionshipRankingContext | null;
}) {
  const [view, setView] = useState<"mine" | "pools" | "general">("mine");
  const myPool = context?.pools.find((pool) => pool.isMyPool) ?? null;
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(
    myPool?.poolId ?? championship.poolId,
  );
  const selectedPool =
    context?.pools.find((pool) => pool.poolId === selectedPoolId) ?? myPool;

  if (!championship.poolId) {
    return (
      <div className="my-championships__empty-block">
        Cette équipe n’est pas rattachée à une poule dans la source officielle.
      </div>
    );
  }

  return (
    <div className="my-championships__standings-wrap">
      <div className="my-championships__standings-heading">
        <div>
          <p className="my-championships__label">Classements officiels</p>
          <strong>{championship.divisionName}</strong>
        </div>
        <span>Source fédérale</span>
      </div>
      <div className="my-championships__ranking-tabs" role="tablist">
        <button
          type="button"
          className={view === "mine" ? "is-active" : undefined}
          onClick={() => setView("mine")}
        >
          Ma poule
        </button>
        <button
          type="button"
          className={view === "pools" ? "is-active" : undefined}
          onClick={() => setView("pools")}
          disabled={!context || context.pools.length === 0}
        >
          Toutes les poules
        </button>
        <button
          type="button"
          className={view === "general" ? "is-active" : undefined}
          onClick={() => setView("general")}
          disabled={!context}
        >
          Classement général
        </button>
      </div>
      {view === "mine" && (
        <div>
          <div className="my-championships__ranking-subtitle">
            <strong>
              {myPool?.poolName ?? `Poule ${championship.poolCode ?? "—"}`}
            </strong>
            <span>Votre poule</span>
          </div>
          <PoolTable pool={myPool} fallback={championship} />
        </div>
      )}
      {view === "pools" && context && (
        <div>
          <div className="my-championships__pool-tabs">
            {context.pools.map((pool) => (
              <button
                type="button"
                key={pool.poolId}
                className={
                  pool.poolId === selectedPool?.poolId ? "is-active" : undefined
                }
                onClick={() => setSelectedPoolId(pool.poolId)}
              >
                Poule {pool.poolCode}
                {pool.isMyPool && <small>Vous</small>}
              </button>
            ))}
          </div>
          {selectedPool && (
            <>
              <div className="my-championships__ranking-subtitle">
                <strong>
                  {selectedPool.poolName ?? `Poule ${selectedPool.poolCode}`}
                </strong>
                <span>
                  {selectedPool.isMyPool
                    ? "Votre poule"
                    : "Autre poule de la série"}
                </span>
              </div>
              <PoolTable pool={selectedPool} fallback={championship} />
            </>
          )}
        </div>
      )}
      {view === "general" && context && <GeneralTable context={context} />}
    </div>
  );
}

function ChampionshipCard({
  championship,
  settings,
  rankingContext,
  onResultSaved,
}: {
  championship: MyChampionship;
  settings: MyChampionshipResultSettings | null;
  rankingContext: MyChampionshipRankingContext | null;
  onResultSaved: () => Promise<void>;
}) {
  const now = Date.now();
  const readOnly = championship.championshipStatus === "archived";
  const sortedMatches = useMemo(
    () =>
      [...championship.matches].sort((left, right) => {
        const leftTime = matchTimestamp(left);
        const rightTime = matchTimestamp(right);
        if (leftTime === null && rightTime === null) return 0;
        if (leftTime === null) return 1;
        if (rightTime === null) return -1;
        return leftTime - rightTime;
      }),
    [championship.matches],
  );
  const nextMatch =
    sortedMatches.find((match) => {
      const timestamp = matchTimestamp(match);
      return (
        timestamp !== null &&
        timestamp >= now &&
        !hasOfficialResult(match) &&
        !match.submission
      );
    }) ?? null;
  const lastResult =
    [...sortedMatches].reverse().find((match) => {
      const timestamp = matchTimestamp(match);
      return (
        hasOfficialResult(match) ||
        match.submission !== null ||
        (timestamp !== null && timestamp < now && match.status === "played")
      );
    }) ?? null;
  const otherMatches = sortedMatches.filter(
    (match) => match.id !== nextMatch?.id && match.id !== lastResult?.id,
  );
  const generalStanding = rankingContext?.generalStandings.find(
    (team) => team.isMyTeam,
  );

  return (
    <article className="my-championships__card">
      <header className="my-championships__card-header">
        <div>
          <p className="my-championships__eyebrow">
            {championship.seasonLabel}
          </p>
          <h2>{championship.championshipName}</h2>
          <p>{championship.specialty}</p>
        </div>
        <div className="my-championships__header-actions">
          <span>
            {statusLabels[championship.championshipStatus] ??
              championship.championshipStatus}
          </span>
          {championship.sourceUrl && (
            <a
              href={officialSourceHref(championship.sourceUrl)}
              target="_blank"
              rel="noreferrer"
            >
              Source officielle <ExternalLink aria-hidden="true" />
            </a>
          )}
        </div>
      </header>
      <div className="my-championships__identity-grid">
        <div>
          <span>Série</span>
          <strong>{championship.divisionName}</strong>
        </div>
        <div>
          <span>Poule</span>
          <strong>{championship.poolCode ?? "—"}</strong>
        </div>
        <div>
          <span>Équipe</span>
          <strong>{championship.teamLabel}</strong>
        </div>
        <div>
          <span>Classement général</span>
          <strong>
            {generalStanding
              ? `${generalStanding.rank}e / ${rankingContext?.generalStandings.length ?? "—"}`
              : "Non importé"}
          </strong>
        </div>
      </div>
      <section className="my-championships__players" aria-label="Mon équipe">
        <p className="my-championships__label">Mon équipe</p>
        <div>
          {championship.players.map((player) => (
            <span key={`${player.firstName}-${player.lastName}`}>
              <strong>
                {player.firstName} {player.lastName}
              </strong>
              {player.isMe && <small>Vous</small>}
            </span>
          ))}
        </div>
      </section>
      {(nextMatch || lastResult) && (
        <section className="my-championships__highlights">
          {nextMatch && (
            <div>
              <p className="my-championships__label">Prochaine partie</p>
              <MatchRow
                match={nextMatch}
                settings={settings}
                emphasis="next"
                onResultSaved={onResultSaved}
                readOnly={readOnly}
              />
            </div>
          )}
          {lastResult && (
            <div>
              <p className="my-championships__label">Dernier résultat</p>
              <MatchRow
                match={lastResult}
                settings={settings}
                emphasis="last"
                onResultSaved={onResultSaved}
                readOnly={readOnly}
              />
            </div>
          )}
        </section>
      )}
      <Standings championship={championship} context={rankingContext} />
      <details className="my-championships__calendar">
        <summary>
          Voir toutes mes parties <span>{championship.matches.length}</span>
        </summary>
        <div>
          {otherMatches.length > 0 ? (
            otherMatches.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                settings={settings}
                onResultSaved={onResultSaved}
                readOnly={readOnly}
              />
            ))
          ) : (
            <div className="my-championships__empty-block">
              Aucune autre partie à afficher.
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

export function MyChampionshipsPage() {
  const [championships, setChampionships] = useState<MyChampionship[]>([]);
  const [resultSettings, setResultSettings] = useState(
    new Map<string, MyChampionshipResultSettings>(),
  );
  const [rankingContexts, setRankingContexts] = useState(
    new Map<string, MyChampionshipRankingContext>(),
  );
  const [selectedHistorySeason, setSelectedHistorySeason] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentChampionships = useMemo(
    () =>
      championships.filter(
        (championship) => championship.championshipStatus !== "archived",
      ),
    [championships],
  );

  const archivedBySeason = useMemo(() => {
    const grouped = new Map<string, MyChampionship[]>();
    for (const championship of championships) {
      if (championship.championshipStatus !== "archived") continue;
      const season = championship.seasonLabel || "Saison non renseignée";
      const items = grouped.get(season) ?? [];
      items.push(championship);
      grouped.set(season, items);
    }
    return grouped;
  }, [championships]);

  const historySeasons = useMemo(
    () =>
      [...archivedBySeason.keys()].sort((left, right) =>
        right.localeCompare(left, "fr", { numeric: true }),
      ),
    [archivedBySeason],
  );

  useEffect(() => {
    if (
      selectedHistorySeason !== null &&
      !archivedBySeason.has(selectedHistorySeason)
    ) {
      setSelectedHistorySeason(null);
    }
  }, [archivedBySeason, selectedHistorySeason]);

  const applyLoadedData = useCallback(
    (
      items: MyChampionship[],
      settings: MyChampionshipResultSettings[],
      contexts: MyChampionshipRankingContext[],
    ) => {
      setChampionships(items);
      setResultSettings(
        new Map(settings.map((item) => [item.championshipId, item] as const)),
      );
      setRankingContexts(
        new Map(
          contexts.map(
            (item) =>
              [
                `${item.championshipId}:${item.divisionId}:${item.myTeamId}`,
                item,
              ] as const,
          ),
        ),
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    const [items, settings, contexts] = await Promise.all([
      myChampionshipsService.list(),
      myChampionshipResultSettingsService.list(),
      myChampionshipRankingContextService.list(),
    ]);
    applyLoadedData(items, settings, contexts);
  }, [applyLoadedData]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      myChampionshipsService.list(),
      myChampionshipResultSettingsService.list(),
      myChampionshipRankingContextService.list(),
    ])
      .then(([items, settings, contexts]) => {
        if (active) applyLoadedData(items, settings, contexts);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger vos championnats.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyLoadedData]);

  const championshipCard = (championship: MyChampionship) => (
    <ChampionshipCard
      key={`${championship.championshipId}-${championship.teamId}`}
      championship={championship}
      settings={resultSettings.get(championship.championshipId) ?? null}
      rankingContext={
        rankingContexts.get(
          `${championship.championshipId}:${championship.divisionId}:${championship.teamId}`,
        ) ?? null
      }
      onResultSaved={refresh}
    />
  );

  const selectedHistory = selectedHistorySeason
    ? (archivedBySeason.get(selectedHistorySeason) ?? [])
    : [];

  return (
    <UserSpaceShell>
      <section
        className="my-championships"
        aria-labelledby="my-championships-title"
      >
        <header className="my-championships__page-header">
          <div className="my-championships__page-icon">
            <Trophy aria-hidden="true" />
          </div>
          <div>
            <p className="my-championships__eyebrow">Mon espace</p>
            <h1 id="my-championships-title">Mes championnats</h1>
            <p>
              Retrouvez vos championnats en cours ou à venir. Vos saisons
              terminées restent disponibles dans l’historique.
            </p>
          </div>
        </header>
        {loading ? (
          <div className="my-championships__state">Chargement…</div>
        ) : error ? (
          <div className="my-championships__state is-error" role="alert">
            {error}
          </div>
        ) : championships.length === 0 ? (
          <div className="my-championships__state">
            <strong>Aucun championnat rattaché à votre compte.</strong>
            <span>
              Dès qu’une licence de championnat est reliée à votre profil, vos
              équipes et vos parties apparaissent ici automatiquement.
            </span>
          </div>
        ) : (
          <>
            {currentChampionships.length > 0 ? (
              <div className="my-championships__list">
                {currentChampionships.map(championshipCard)}
              </div>
            ) : (
              <div className="my-championships__empty-block">
                Aucun championnat en cours ou à venir.
              </div>
            )}

            {historySeasons.length > 0 && (
              <section
                className="my-championships__standings-wrap"
                aria-labelledby="my-championships-history-title"
              >
                <div className="my-championships__standings-heading">
                  <div>
                    <p className="my-championships__label">Archives</p>
                    <strong id="my-championships-history-title">
                      Historique
                    </strong>
                  </div>
                  <span>Saisons terminées</span>
                </div>
                <div
                  className="my-championships__ranking-tabs"
                  role="tablist"
                  aria-label="Saisons archivées"
                >
                  {historySeasons.map((season) => (
                    <button
                      type="button"
                      role="tab"
                      key={season}
                      aria-selected={selectedHistorySeason === season}
                      className={
                        selectedHistorySeason === season
                          ? "is-active"
                          : undefined
                      }
                      onClick={() =>
                        setSelectedHistorySeason((current) =>
                          current === season ? null : season,
                        )
                      }
                    >
                      {season}
                    </button>
                  ))}
                </div>
                {selectedHistorySeason ? (
                  <div className="my-championships__list">
                    {selectedHistory.map(championshipCard)}
                  </div>
                ) : (
                  <div className="my-championships__empty-block">
                    Choisissez une saison pour consulter vos anciens
                    championnats.
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </UserSpaceShell>
  );
}
