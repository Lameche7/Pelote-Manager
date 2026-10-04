import { useMemo, useState } from "react";
import {
  CalendarCheck2,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  Send,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  myChampionshipsService,
  type MyChampionship,
  type MyChampionshipMatch,
} from "@/features/user-space/championships/services/myChampionshipsService";
import type { MyChampionshipResultSettings } from "@/features/user-space/championships/services/myChampionshipResultSettingsService";
import {
  RequiredFieldMark,
  RequiredFieldsNotice,
} from "@/shared/components/forms/RequiredField";
import { ROUTES } from "@/shared/config";
import "./ChampionshipMatchActionCard.css";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const displayDate = (value: string | null) => {
  if (!value) return "Date à définir";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const displayTime = (value: string | null) =>
  value ? value.slice(0, 5) : "Horaire à définir";

const reservationDateTimeParts = (match: MyChampionshipMatch) => {
  if (!match.reservation?.startsAt) return null;
  const startsAt = new Date(match.reservation.startsAt);
  if (Number.isNaN(startsAt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startsAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
};

const dateTimeParts = (match: MyChampionshipMatch) =>
  reservationDateTimeParts(match) ??
  (match.manualSchedule
    ? {
        date: match.manualSchedule.scheduledOn,
        time: match.manualSchedule.scheduledTime,
      }
    : {
        date: match.agreementOn ?? match.reportOn ?? match.scheduledOn,
        time: match.agreementTime ?? match.reportTime ?? match.scheduledTime,
      });

const hasOfficialResult = (match: MyChampionshipMatch) =>
  match.scoreRaw !== null ||
  (match.scoreMine !== null && match.scoreOpponent !== null);

const resultTone = (match: MyChampionshipMatch) => {
  const mine = match.scoreMine ?? match.submission?.scoreMine ?? null;
  const opponent =
    match.scoreOpponent ?? match.submission?.scoreOpponent ?? null;
  if (mine === null || opponent === null) return "pending";
  return mine > opponent ? "win" : mine < opponent ? "loss" : "invalid";
};

const matchEndTimestamp = (match: MyChampionshipMatch): number | null => {
  if (match.status === "played" || hasOfficialResult(match)) return Date.now() - 1;
  if (match.reservation?.endsAt) {
    const end = new Date(match.reservation.endsAt).getTime();
    if (!Number.isNaN(end)) return end;
  }
  const { date, time } = dateTimeParts(match);
  if (!date) return null;
  if (time) {
    const start = new Date(`${date}T${time.slice(0, 5)}:00`).getTime();
    if (!Number.isNaN(start)) return start + 60 * 60 * 1000;
  }
  const endOfDay = new Date(`${date}T23:59:59`).getTime();
  return Number.isNaN(endOfDay) ? null : endOfDay;
};

const phoneHref = (phone: string) => `tel:${phone.replace(/[^+\d]/gu, "")}`;

export function ChampionshipMatchActionCard({
  championship,
  match,
  settings,
  onChanged,
  featured = false,
  targeted = false,
  readOnly = false,
}: {
  championship: MyChampionship;
  match: MyChampionshipMatch;
  settings: MyChampionshipResultSettings | null;
  onChanged: () => Promise<void>;
  featured?: boolean;
  targeted?: boolean;
  readOnly?: boolean;
}) {
  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(
    match.manualSchedule?.scheduledOn ?? "",
  );
  const [scheduleTime, setScheduleTime] = useState(
    match.manualSchedule?.scheduledTime?.slice(0, 5) ?? "",
  );
  const [scheduleVenue, setScheduleVenue] = useState(
    match.manualSchedule?.venue ?? "",
  );
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [resultEditing, setResultEditing] = useState(false);
  const [scoreMine, setScoreMine] = useState(
    match.submission?.status === "pending"
      ? String(match.submission.scoreMine)
      : "",
  );
  const [scoreOpponent, setScoreOpponent] = useState(
    match.submission?.status === "pending"
      ? String(match.submission.scoreOpponent)
      : "",
  );
  const [resultComment, setResultComment] = useState(
    match.submission?.status === "pending" ? (match.submission.comment ?? "") : "",
  );
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState("");
  const [venueSaving, setVenueSaving] = useState(false);

  const { date, time } = dateTimeParts(match);
  const finalStatus = ["played", "forfeit", "cancelled"].includes(match.status);
  const officialResult = hasOfficialResult(match);
  const endTimestamp = matchEndTimestamp(match);
  const finished =
    match.status === "played" ||
    officialResult ||
    (endTimestamp !== null && endTimestamp <= Date.now());
  const winningScore = settings?.winningScore ?? null;
  const configuredResult = Boolean(settings?.inputMode && winningScore !== null);
  const place =
    match.reservation?.resourceName ??
    match.manualSchedule?.venue ??
    match.agreementVenue ??
    match.venue;
  const tone = resultTone(match);
  const mine = match.scoreMine ?? match.submission?.scoreMine ?? null;
  const opponent = match.scoreOpponent ?? match.submission?.scoreOpponent ?? null;
  const scoreVisible = mine !== null && opponent !== null;

  const reservationHref = useMemo(() => {
    if (
      readOnly ||
      match.reservation ||
      officialResult ||
      match.submission ||
      finalStatus ||
      finished ||
      !match.opponentTeamId ||
      (match.teamSide !== "a" && !match.playsAtMyClub)
    ) {
      return null;
    }
    const params = new URLSearchParams({ championshipMatch: match.id });
    const preferredDate =
      match.manualSchedule?.scheduledOn ??
      match.agreementOn ??
      match.reportOn ??
      match.scheduledOn;
    if (preferredDate) params.set("date", preferredDate);
    return `${ROUTES.reservations}?${params.toString()}`;
  }, [finished, finalStatus, match, officialResult, readOnly]);

  const canProgram =
    !readOnly &&
    match.teamSide === "b" &&
    !match.playsAtMyClub &&
    !match.reservation &&
    !officialResult &&
    !match.submission &&
    !finalStatus &&
    !finished;

  const canSubmitResult =
    !readOnly &&
    finished &&
    !officialResult &&
    !["forfeit", "cancelled"].includes(match.status) &&
    configuredResult;

  const reservationReason = match.reservation
    ? "Terrain déjà réservé"
    : finished
      ? "Partie terminée"
      : match.teamSide === "b" && !match.playsAtMyClub
        ? "Partie à l’extérieur"
        : finalStatus || officialResult
          ? "Partie clôturée"
          : "Réserver un créneau";

  const programmingReason = canProgram
    ? match.manualSchedule
      ? "Modifier la programmation"
      : "Renseigner la programmation"
    : match.reservation
      ? "Programmée par la réservation"
      : match.teamSide === "a" || match.playsAtMyClub
        ? "Partie jouée dans notre trinquet"
        : finished
          ? "Partie terminée"
          : "Programmation indisponible";

  const resultReason = officialResult
    ? "Résultat officiel"
    : !finished
      ? "Disponible après la partie"
      : !configuredResult
        ? "Format de score non paramétré"
        : match.submission?.status === "pending"
          ? "Corriger le résultat saisi"
          : "Saisir le résultat";

  const saveManualSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduleDate || !scheduleTime) return;
    setScheduleSaving(true);
    setScheduleError("");
    try {
      await myChampionshipsService.setManualSchedule(
        match.id,
        scheduleDate,
        scheduleTime,
        scheduleVenue.trim(),
      );
      setScheduleEditing(false);
      await onChanged();
    } catch (cause) {
      setScheduleError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer la programmation.",
      );
    } finally {
      setScheduleSaving(false);
    }
  };

  const submitResult = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scoreA = Number(scoreMine);
    const scoreB = Number(scoreOpponent);
    if (
      winningScore === null ||
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < 0 ||
      scoreB < 0 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== winningScore ||
      Math.min(scoreA, scoreB) >= winningScore
    ) {
      setResultError(
        winningScore === null
          ? "Le format du résultat n’est pas paramétré."
          : `La partie doit avoir un vainqueur à ${winningScore}.`,
      );
      return;
    }
    setResultSaving(true);
    setResultError("");
    try {
      await myChampionshipsService.submitResult(
        match.id,
        scoreA,
        scoreB,
        resultComment.trim(),
      );
      setResultEditing(false);
      await onChanged();
    } catch (cause) {
      setResultError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer le résultat.",
      );
    } finally {
      setResultSaving(false);
    }
  };

  const toggleHomeVenue = async () => {
    setVenueSaving(true);
    try {
      await myChampionshipsService.setHomeVenue(match.id, !match.playsAtMyClub);
      await onChanged();
    } finally {
      setVenueSaving(false);
    }
  };

  return (
    <article
      id={`championship-match-${match.id}`}
      className={`championship-match-action${featured ? " is-featured" : ""}${
        targeted ? " is-targeted" : ""
      }`}
    >
      <header className="championship-match-action__header">
        <div>
          <p>
            {championship.divisionName}
            {championship.poolCode ? ` · Poule ${championship.poolCode}` : ""}
          </p>
          <h3>
            {championship.players
              .map((player) => `${player.firstName} ${player.lastName}`)
              .join(" / ")}
          </h3>
          <span>{championship.clubName}</span>
        </div>
        <div className="championship-match-action__round">
          <strong>{displayDate(match.scheduledOn)}</strong>
          <span>Journée fédérale</span>
        </div>
      </header>

      <div className="championship-match-action__opponent">
        <div className="championship-match-action__opponent-icon">
          <Users aria-hidden="true" />
        </div>
        <div>
          <span>Adversaires</span>
          <strong>
            {match.opponentPlayers.length > 0
              ? match.opponentPlayers
                  .map((player) => `${player.firstName} ${player.lastName}`)
                  .join(" / ")
              : match.opponentLabel}
          </strong>
          <small>{match.opponentClubName ?? match.opponentLabel}</small>
        </div>
        <span
          className={`championship-match-action__venue-tag is-${
            match.teamSide === "a" ? "home" : "away"
          }`}
        >
          {match.teamSide === "a" ? "À domicile" : "À l’extérieur"}
        </span>
      </div>

      <div className="championship-match-action__schedule">
        <div>
          <CalendarCheck2 aria-hidden="true" />
          <span>
            <small>Programmation</small>
            <strong>{displayDate(date)}</strong>
            <em>{displayTime(time)}</em>
          </span>
        </div>
        <div>
          <MapPin aria-hidden="true" />
          <span>
            <small>Lieu</small>
            <strong>{place || "À définir"}</strong>
          </span>
        </div>
        {match.opponentResponsiblePhone && (
          <a href={phoneHref(match.opponentResponsiblePhone)}>
            <Phone aria-hidden="true" />
            <span>
              <small>Responsable adverse</small>
              <strong>{match.opponentResponsibleName ?? "Contacter"}</strong>
              <em>{match.opponentResponsiblePhone}</em>
            </span>
          </a>
        )}
      </div>

      {scoreVisible && (
        <div className={`championship-match-action__score is-${tone}`}>
          <span>
            <strong>{championship.teamLabel}</strong>
            <small>{championship.clubName}</small>
          </span>
          <strong>{mine}</strong>
          <b>–</b>
          <strong>{opponent}</strong>
          <span>
            <strong>{match.opponentLabel}</strong>
            <small>{match.opponentClubName}</small>
          </span>
          <em>
            {officialResult
              ? "Résultat officiel"
              : "Résultat saisi · en attente du comité"}
          </em>
        </div>
      )}

      <div className="championship-match-action__actions">
        {reservationHref ? (
          <Link className="championship-match-action__action is-primary" to={reservationHref}>
            <CalendarPlus aria-hidden="true" />
            <span>
              <strong>Réserver un créneau</strong>
              <small>Choisir le terrain et l’horaire</small>
            </span>
          </Link>
        ) : (
          <button type="button" className="championship-match-action__action" disabled>
            <CalendarPlus aria-hidden="true" />
            <span>
              <strong>Réserver un créneau</strong>
              <small>{reservationReason}</small>
            </span>
          </button>
        )}

        <button
          type="button"
          className={`championship-match-action__action${canProgram ? " is-primary" : ""}`}
          disabled={!canProgram}
          onClick={() => setScheduleEditing(true)}
        >
          <Clock3 aria-hidden="true" />
          <span>
            <strong>
              {match.manualSchedule ? "Modifier la programmation" : "Renseigner la programmation"}
            </strong>
            <small>{programmingReason}</small>
          </span>
        </button>

        <button
          type="button"
          className={`championship-match-action__action${canSubmitResult ? " is-result" : ""}`}
          disabled={!canSubmitResult}
          onClick={() => setResultEditing(true)}
        >
          <Send aria-hidden="true" />
          <span>
            <strong>
              {match.submission?.status === "pending"
                ? "Corriger le résultat"
                : "Saisir le résultat"}
            </strong>
            <small>{resultReason}</small>
          </span>
        </button>
      </div>

      {match.teamSide === "b" &&
        !match.reservation &&
        !officialResult &&
        !match.submission &&
        !finished &&
        !readOnly && (
          <button
            type="button"
            className="championship-match-action__secondary"
            onClick={() => void toggleHomeVenue()}
            disabled={venueSaving}
          >
            <MapPin aria-hidden="true" />
            {venueSaving
              ? "Mise à jour…"
              : match.playsAtMyClub
                ? "Ne plus jouer cette partie dans notre trinquet"
                : "Finalement jouer cette partie dans notre trinquet"}
          </button>
        )}

      {scheduleEditing && canProgram && (
        <form className="championship-match-action__form" onSubmit={saveManualSchedule}>
          <header>
            <strong>Renseigner la programmation réelle</strong>
            <span>Date, heure et éventuellement lieu convenus avec l’adversaire.</span>
          </header>
          <div className="championship-match-action__form-grid">
            <label>
              <span>Date <RequiredFieldMark /></span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Heure <RequiredFieldMark /></span>
              <input
                type="time"
                value={scheduleTime}
                onChange={(event) => setScheduleTime(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Lieu</span>
              <input
                type="text"
                value={scheduleVenue}
                maxLength={160}
                placeholder="Ex. Trinquet de Pau"
                onChange={(event) => setScheduleVenue(event.target.value)}
              />
            </label>
          </div>
          {scheduleError && <div role="alert">{scheduleError}</div>}
          <footer>
            <button type="submit" disabled={scheduleSaving}>
              {scheduleSaving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={() => setScheduleEditing(false)}>
              Annuler
            </button>
          </footer>
        </form>
      )}

      {resultEditing && canSubmitResult && winningScore !== null && (
        <form className="championship-match-action__form" onSubmit={submitResult}>
          <header>
            <strong>Saisir le résultat</strong>
            <span>
              Il restera affiché comme résultat saisi jusqu’à la mise à jour du
              comité, qui deviendra ensuite la référence officielle.
            </span>
          </header>
          <RequiredFieldsNotice />
          <div className="championship-match-action__form-grid is-score">
            <label>
              <span>Notre score <RequiredFieldMark /></span>
              <input
                type="number"
                min="0"
                max={winningScore}
                value={scoreMine}
                onChange={(event) => setScoreMine(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Score adverse <RequiredFieldMark /></span>
              <input
                type="number"
                min="0"
                max={winningScore}
                value={scoreOpponent}
                onChange={(event) => setScoreOpponent(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Commentaire</span>
              <input
                type="text"
                maxLength={250}
                value={resultComment}
                onChange={(event) => setResultComment(event.target.value)}
              />
            </label>
          </div>
          {resultError && <div role="alert">{resultError}</div>}
          <footer>
            <button type="submit" disabled={resultSaving}>
              {resultSaving ? "Envoi…" : "Valider le résultat"}
            </button>
            <button type="button" onClick={() => setResultEditing(false)}>
              Annuler
            </button>
          </footer>
        </form>
      )}

      {match.submission?.status === "confirmed_official" && (
        <div className="championship-match-action__confirmed">
          <CheckCircle2 aria-hidden="true" />
          Votre résultat saisi a été confirmé par la mise à jour officielle.
        </div>
      )}
    </article>
  );
}
