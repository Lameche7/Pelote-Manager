import { useEffect, useState, type FormEvent } from "react";
import "./TournamentScoreEditor.css";

export type TournamentSportingRulesSummary = {
  matchFormat: "single_game" | "best_of_three_sets";
  singleGamePoints: number;
  mainSetPoints: number;
  decidingSetPoints: number;
};

export type TournamentScoreSet = {
  teamA: number;
  teamB: number;
};

export type TournamentScorePayload = {
  sets: TournamentScoreSet[];
};

type DraftSet = {
  left: string;
  right: string;
};

type Props = {
  rules: TournamentSportingRulesSummary;
  teamSide?: "a" | "b";
  leftLabel?: string;
  rightLabel?: string;
  initialScore?: TournamentScorePayload | null;
  disabled?: boolean;
  submitLabel?: string;
  onSubmit: (score: TournamentScorePayload) => Promise<void> | void;
  onCancel?: () => void;
};

const emptySet = (): DraftSet => ({ left: "", right: "" });

const toDraftSets = (
  score: TournamentScorePayload | null | undefined,
  teamSide: "a" | "b",
  minimumRows: number,
): DraftSet[] => {
  const mapped = (score?.sets ?? []).map((set) => ({
    left: String(teamSide === "a" ? set.teamA : set.teamB),
    right: String(teamSide === "a" ? set.teamB : set.teamA),
  }));
  while (mapped.length < minimumRows) mapped.push(emptySet());
  return mapped;
};

export function TournamentScoreEditor({
  rules,
  teamSide = "a",
  leftLabel = "Équipe A",
  rightLabel = "Équipe B",
  initialScore,
  disabled = false,
  submitLabel = "Enregistrer le résultat",
  onSubmit,
  onCancel,
}: Props) {
  const minimumRows = rules.matchFormat === "single_game" ? 1 : 2;
  const [sets, setSets] = useState<DraftSet[]>(() =>
    toDraftSets(initialScore, teamSide, minimumRows),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    setSets(toDraftSets(initialScore, teamSide, minimumRows));
    setError("");
  }, [initialScore, minimumRows, teamSide]);

  const targetFor = (index: number) =>
    rules.matchFormat === "single_game"
      ? rules.singleGamePoints
      : index < 2
        ? rules.mainSetPoints
        : rules.decidingSetPoints;

  const update = (index: number, side: keyof DraftSet, value: string) => {
    setSets((current) =>
      current.map((set, setIndex) =>
        setIndex === index ? { ...set, [side]: value } : set,
      ),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const completed = sets.filter(
      (set) => set.left.trim() !== "" || set.right.trim() !== "",
    );

    if (completed.length < minimumRows || completed.some((set) => !set.left || !set.right)) {
      setError("Renseignez le score complet de chaque manche jouée.");
      return;
    }

    if (rules.matchFormat === "best_of_three_sets" && completed.length > 3) {
      setError("Une partie se joue au maximum en trois manches.");
      return;
    }

    const payload: TournamentScorePayload = {
      sets: completed.map((set) => {
        const left = Number(set.left);
        const right = Number(set.right);
        return teamSide === "a"
          ? { teamA: left, teamB: right }
          : { teamA: right, teamB: left };
      }),
    };

    if (
      payload.sets.some(
        (set) =>
          !Number.isInteger(set.teamA) ||
          !Number.isInteger(set.teamB) ||
          set.teamA < 0 ||
          set.teamB < 0,
      )
    ) {
      setError("Les scores doivent être des nombres entiers positifs.");
      return;
    }

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Enregistrement du résultat impossible.",
      );
    }
  };

  return (
    <form className="tournament-score-editor" onSubmit={submit}>
      <div className="tournament-score-editor__heading">
        <strong>{leftLabel}</strong>
        <span>Score</span>
        <strong>{rightLabel}</strong>
      </div>

      {sets.map((set, index) => (
        <div className="tournament-score-editor__row" key={index}>
          <input
            aria-label={`${leftLabel} manche ${index + 1}`}
            type="number"
            min="0"
            max={targetFor(index)}
            required={index < minimumRows}
            disabled={disabled}
            value={set.left}
            onChange={(event) => update(index, "left", event.target.value)}
          />
          <span>
            {rules.matchFormat === "single_game"
              ? `${rules.singleGamePoints} pts`
              : `Manche ${index + 1} · ${targetFor(index)} pts`}
          </span>
          <input
            aria-label={`${rightLabel} manche ${index + 1}`}
            type="number"
            min="0"
            max={targetFor(index)}
            required={index < minimumRows}
            disabled={disabled}
            value={set.right}
            onChange={(event) => update(index, "right", event.target.value)}
          />
        </div>
      ))}

      {rules.matchFormat === "best_of_three_sets" && sets.length === 2 && (
        <button
          className="tournament-score-editor__secondary"
          type="button"
          disabled={disabled}
          onClick={() => setSets((current) => [...current, emptySet()])}
        >
          + Ajouter la manche décisive
        </button>
      )}

      {rules.matchFormat === "best_of_three_sets" && sets.length === 3 && !initialScore?.sets?.[2] && (
        <button
          className="tournament-score-editor__secondary"
          type="button"
          disabled={disabled}
          onClick={() => setSets((current) => current.slice(0, 2))}
        >
          Retirer la manche décisive
        </button>
      )}

      {error && (
        <p className="tournament-score-editor__error" role="alert">
          {error}
        </p>
      )}

      <div className="tournament-score-editor__actions">
        {onCancel && (
          <button type="button" disabled={disabled} onClick={onCancel}>
            Annuler
          </button>
        )}
        <button type="submit" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
