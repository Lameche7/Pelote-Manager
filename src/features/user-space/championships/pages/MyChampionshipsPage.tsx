import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw, Trophy } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import { ChampionshipMatchActionCard } from "@/features/user-space/championships/components/ChampionshipMatchActionCard";
import { ChampionshipResultsExplorer } from "@/features/user-space/championships/components/ChampionshipResultsExplorer";
import { ChampionshipStandingsExplorer } from "@/features/user-space/championships/components/ChampionshipStandingsExplorer";
import {
  myChampionshipResultSettingsService,
  type MyChampionshipResultSettings,
} from "@/features/user-space/championships/services/myChampionshipResultSettingsService";
import {
  myChampionshipsService,
  type MyChampionship,
  type MyChampionshipMatch,
} from "@/features/user-space/championships/services/myChampionshipsService";
import "./MyChampionshipsPage.css";

type MatchEntry = {
  championship: MyChampionship;
  match: MyChampionshipMatch;
};

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const archivedDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const parisDateString = () => {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const championshipWeekendDay = () => {
  const today = parisDateString();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return today;
  if (weekday === 1) return addDays(today, -1);
  return addDays(today, 7 - weekday);
};

const displayRoundDate = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : shortDateFormatter.format(date);
};

const hasOfficialResult = (match: MyChampionshipMatch) =>
  match.scoreRaw !== null ||
  (match.scoreMine !== null && match.scoreOpponent !== null);

const isClosed = (match: MyChampionshipMatch) =>
  hasOfficialResult(match) ||
  Boolean(match.submission) ||
  ["played", "forfeit", "cancelled"].includes(match.status);

const roundTimestamp = (match: MyChampionshipMatch) => {
  const date = match.scheduledOn ?? match.manualSchedule?.scheduledOn;
  if (!date) return Number.MAX_SAFE_INTEGER;
  const value = new Date(`${date}T12:00:00`).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
};

const sortEntries = (left: MatchEntry, right: MatchEntry) =>
  roundTimestamp(left.match) - roundTimestamp(right.match);

const archivedScore = (match: MyChampionshipMatch) => {
  if (match.scoreMine !== null && match.scoreOpponent !== null) {
    return `${match.scoreMine} – ${match.scoreOpponent}`;
  }
  if (match.submission) {
    return `${match.submission.scoreMine} – ${match.submission.scoreOpponent}`;
  }
  return match.scoreRaw ?? "—";
};

export function MyChampionshipsPage() {
  const [searchParams] = useSearchParams();
  const targetMatchId = searchParams.get("match");
  const [championships, setChampionships] = useState<MyChampionship[]>([]);
  const [resultSettings, setResultSettings] = useState(
    new Map<string, MyChampionshipResultSettings>(),
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const focusDay = useMemo(() => championshipWeekendDay(), []);

  const load = useCallback(async () => {
    const [items, settings] = await Promise.all([
      myChampionshipsService.list(),
      myChampionshipResultSettingsService.list(),
    ]);
    setChampionships(items);
    setResultSettings(
      new Map(settings.map((item) => [item.championshipId, item] as const)),
    );
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      myChampionshipsService.list(),
      myChampionshipResultSettingsService.list(),
    ])
      .then(([items, settings]) => {
        if (!active) return;
        setChampionships(items);
        setResultSettings(
          new Map(settings.map((item) => [item.championshipId, item] as const)),
        );
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const currentChampionships = useMemo(
    () =>
      championships.filter(
        (championship) => championship.championshipStatus !== "archived",
      ),
    [championships],
  );

  const archivedChampionships = useMemo(
    () =>
      championships.filter(
        (championship) => championship.championshipStatus === "archived",
      ),
    [championships],
  );

  const allCurrentEntries = useMemo<MatchEntry[]>(
    () =>
      currentChampionships.flatMap((championship) =>
        championship.matches.map((match) => ({ championship, match })),
      ),
    [currentChampionships],
  );

  const focusEntries = useMemo(() => {
    const exact = allCurrentEntries
      .filter(
        ({ match }) =>
          match.scheduledOn === focusDay && match.status !== "cancelled",
      )
      .sort(sortEntries);
    if (exact.length > 0) return exact;

    const future = allCurrentEntries
      .filter(
        ({ match }) =>
          Boolean(match.scheduledOn) &&
          match.scheduledOn! >= focusDay &&
          match.status !== "cancelled",
      )
      .sort(sortEntries);
    const nextDay = future[0]?.match.scheduledOn;
    return nextDay
      ? future.filter(({ match }) => match.scheduledOn === nextDay)
      : [];
  }, [allCurrentEntries, focusDay]);

  const focusIds = useMemo(
    () => new Set(focusEntries.map(({ match }) => match.id)),
    [focusEntries],
  );

  const otherActionEntries = useMemo(
    () =>
      allCurrentEntries
        .filter(({ match }) => !focusIds.has(match.id) && !isClosed(match))
        .sort(sortEntries),
    [allCurrentEntries, focusIds],
  );

  const completedEntries = useMemo(
    () =>
      allCurrentEntries
        .filter(({ match }) => !focusIds.has(match.id) && isClosed(match))
        .sort((left, right) => sortEntries(right, left)),
    [allCurrentEntries, focusIds],
  );

  const primaryChampionship =
    focusEntries[0]?.championship ?? currentChampionships[0] ?? null;

  const targetedOtherMatch = otherActionEntries.some(
    ({ match }) => match.id === targetMatchId,
  );

  useEffect(() => {
    if (loading || !targetMatchId) return;
    window.setTimeout(() => {
      document
        .getElementById(`championship-match-${targetMatchId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, [loading, targetMatchId, championships]);

  const renderActionCard = (
    entry: MatchEntry,
    featured = false,
    readOnly = false,
  ) => (
    <ChampionshipMatchActionCard
      key={`${entry.championship.championshipId}-${entry.match.id}`}
      championship={entry.championship}
      match={entry.match}
      settings={
        resultSettings.get(entry.championship.championshipId) ?? null
      }
      onChanged={refresh}
      featured={featured}
      readOnly={readOnly}
      targeted={entry.match.id === targetMatchId}
    />
  );

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
              Votre partie du week-end, vos actions à faire, les rencontres du
              championnat et les classements au même endroit.
            </p>
          </div>
          <button
            type="button"
            className="my-championships__refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw aria-hidden="true" />
            {refreshing ? "Actualisation…" : "Actualiser"}
          </button>
        </header>

        <div className="my-championships__committee-note">
          <RefreshCw aria-hidden="true" />
          <span>
            <strong>Résultats du week-end</strong>
            Vous pouvez saisir votre score dès la fin de la partie. Il reste
            affiché comme résultat proposé puis, lors de la mise à jour du site
            du comité, le résultat officiel devient automatiquement la référence.
          </span>
        </div>

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
              Dès qu’une équipe de championnat est reliée à votre profil, elle
              apparaîtra ici.
            </span>
          </div>
        ) : (
          <>
            <section className="my-championships__weekend-focus">
              <header className="my-championships__section-heading">
                <div className="my-championships__section-icon is-weekend">
                  <CalendarDays aria-hidden="true" />
                </div>
                <div>
                  <p>Priorité</p>
                  <h2>Ma partie du week-end</h2>
                  <span>
                    Journée du {displayRoundDate(focusDay)} · cette journée reste
                    affichée jusqu’au lundi soir, puis la suivante prend sa place
                    à partir du mardi.
                  </span>
                </div>
              </header>

              {focusEntries.length > 0 ? (
                <div className="my-championships__focus-list">
                  {focusEntries.map((entry) => renderActionCard(entry, true))}
                </div>
              ) : (
                <div className="my-championships__state">
                  Aucune partie rattachée à cette journée.
                </div>
              )}
            </section>

            <details
              className="my-championships__history-block"
              open={targetedOtherMatch || undefined}
            >
              <summary>
                Mes autres parties · réserver / programmer à l’avance
                <span>{otherActionEntries.length}</span>
              </summary>
              {otherActionEntries.length > 0 ? (
                <div className="my-championships__other-list">
                  {otherActionEntries.map((entry) => renderActionCard(entry))}
                </div>
              ) : (
                <div className="my-championships__state">
                  Aucune autre partie à organiser pour le moment.
                </div>
              )}
            </details>

            {primaryChampionship && (
              <>
                <ChampionshipResultsExplorer
                  preferredChampionshipId={primaryChampionship.championshipId}
                  preferredDivisionId={primaryChampionship.divisionId}
                  preferredPoolId={primaryChampionship.poolId}
                  focusDay={focusDay}
                />
                <ChampionshipStandingsExplorer
                  championshipId={primaryChampionship.championshipId}
                  preferredDivisionId={primaryChampionship.divisionId}
                  preferredPoolId={primaryChampionship.poolId}
                />
              </>
            )}

            {completedEntries.length > 0 && (
              <details
                className="my-championships__history-block"
                open={completedEntries.some(
                  ({ match }) => match.id === targetMatchId,
                )}
              >
                <summary>
                  Parties déjà jouées / résultats
                  <span>{completedEntries.length}</span>
                </summary>
                <div className="my-championships__other-list">
                  {completedEntries.map((entry) => renderActionCard(entry))}
                </div>
              </details>
            )}

            {archivedChampionships.length > 0 && (
              <details className="my-championships__history-block">
                <summary>
                  Historique des saisons
                  <span>{archivedChampionships.length}</span>
                </summary>
                <div className="my-championships__archive-list">
                  {archivedChampionships.map((championship) => (
                    <section
                      key={`${championship.championshipId}-${championship.teamId}`}
                    >
                      <header>
                        <div>
                          <strong>{championship.championshipName}</strong>
                          <span>
                            {championship.seasonLabel} · {championship.divisionName}
                            {championship.poolCode
                              ? ` · Poule ${championship.poolCode}`
                              : ""}
                          </span>
                        </div>
                        <strong>{championship.teamLabel}</strong>
                      </header>
                      <div>
                        {[...championship.matches]
                          .sort((left, right) =>
                            (left.scheduledOn ?? "").localeCompare(
                              right.scheduledOn ?? "",
                            ),
                          )
                          .map((match) => (
                            <div key={match.id}>
                              <span>
                                {match.scheduledOn
                                  ? archivedDateFormatter.format(
                                      new Date(`${match.scheduledOn}T12:00:00`),
                                    )
                                  : "Date inconnue"}
                              </span>
                              <strong>vs {match.opponentLabel}</strong>
                              <b>{archivedScore(match)}</b>
                            </div>
                          ))}
                      </div>
                    </section>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </UserSpaceShell>
  );
}
