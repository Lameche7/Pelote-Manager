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
  onSaved,
}: {
  match: MyChampionshipMatch;
  onSaved: () => Promise<void>;
}) {
  const submission = match.submission;
  const timestamp = matchTimestamp(match);
  const canSubmit =
    !hasOfficialResult(match) &&
    !["cancelled", "forfeit"].includes(match.status) &&
    (timestamp === null || timestamp <= Date.now());
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mine = Number(scoreMine);
    const opponent = Number(scoreOpponent);
    if (
      !Number.isInteger(mine) ||
      !Number.isInteger(opponent) ||
      mine < 0 ||
      opponent < 0 ||
      mine > 200 ||
      opponent > 200
    ) {
      setError("Saisissez deux scores entiers compris entre 0 et 200.");
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

      {canSubmit && editing && (
        <form className="my-championships__submission-form" onSubmit={submit}>
          <div className="my-championships__score-fields">
            <label>
              <span>Notre score</span>
              <input
                type="number"
                min="0"
                max="200"
                inputMode="numeric"
                value={scoreMine}
                onChange={(event) => setScoreMine(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Score adversaire</span>
              <input
                type="number"
                min="0"
                max="200"
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
            Cette proposition n’écrase jamais le résultat officiel. Elle sera
            confirmée ou signalée comme différente lors de la prochaine mise à
            jour officielle.
          </small>
        </form>
      )}
    </div>
  );
}

function MatchRow({
  match,
  emphasis,
  onResultSaved,
}: {
  match: MyChampionshipMatch;
  emphasis?: "next" | "last";
  onResultSaved: () => Promise<void>;
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
      <ResultSubmission match={match} onSaved={onResultSaved} />
    </article>
  );
}

function Standings({ championship }: { championship: MyChampionship }) {
  if (!championship.poolId) {
    return (
      <div className="my-championships__empty-block">
        Cette équipe n’est pas rattachée à une poule dans la source officielle.
      </div>
    );
  }
  if (championship.poolStandings.length === 0) {
    return (
      <div className="my-championships__empty-block">
        Le classement de cette poule n’est pas encore disponible.
      </div>
    );
  }
  const hasOfficialRanks = championship.poolStandings.some(
    (team) => team.officialRank !== null,
  );
  return (
    <div className="my-championships__standings-wrap">
      <div className="my-championships__standings-heading">
        <div>
          <p className="my-championships__label">Classement de poule</p>
          <strong>
            {championship.poolName ?? `Poule ${championship.poolCode}`}
          </strong>
        </div>
        <span>
          {hasOfficialRanks
            ? "Rang officiel importé"
            : "Statistiques de résultats · rang officiel non importé"}
        </span>
      </div>
      <div className="my-championships__table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rang</th>
              <th>Équipe</th>
              <th>J</th>
              <th>V</th>
              <th>D</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {championship.poolStandings.map((team) => (
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
        Les statistiques J/V/D et +/- sont calculées à partir des scores
        importés. Pelote Manager ne recalcule pas le rang officiel avec une
        règle supposée.
      </small>
    </div>
  );
}

function ChampionshipCard({
  championship,
  onResultSaved,
}: {
  championship: MyChampionship;
  onResultSaved: () => Promise<void>;
}) {
  const now = Date.now();
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
          <span>Rang officiel</span>
          <strong>
            {championship.officialRank !== null
              ? `${championship.officialRank}e`
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
                emphasis="next"
                onResultSaved={onResultSaved}
              />
            </div>
          )}
          {lastResult && (
            <div>
              <p className="my-championships__label">Dernier résultat</p>
              <MatchRow
                match={lastResult}
                emphasis="last"
                onResultSaved={onResultSaved}
              />
            </div>
          )}
        </section>
      )}

      <Standings championship={championship} />

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
                onResultSaved={onResultSaved}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const items = await myChampionshipsService.list();
    setChampionships(items);
  }, []);

  useEffect(() => {
    let active = true;
    void myChampionshipsService
      .list()
      .then((items) => {
        if (active) setChampionships(items);
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
  }, []);

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
              Retrouvez vos équipes, vos prochaines parties, vos résultats et la
              situation de votre poule.
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
          <div className="my-championships__list">
            {championships.map((championship) => (
              <ChampionshipCard
                key={`${championship.championshipId}-${championship.teamId}`}
                championship={championship}
                onResultSaved={refresh}
              />
            ))}
          </div>
        )}
      </section>
    </UserSpaceShell>
  );
}
