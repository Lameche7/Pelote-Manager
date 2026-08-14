import type { TournamentSportingRules } from "@/features/admin/tournaments/services/tournamentAdminService";

type Props = {
  rules: TournamentSportingRules;
  disabled: boolean;
  onChange: (next: TournamentSportingRules) => void;
  onSave?: () => void;
  showSaveButton?: boolean;
};

const numberValue = (value: string) => Number(value || 0);

export function TournamentSportingRulesSection({
  rules,
  disabled,
  onChange,
  onSave,
  showSaveButton = true,
}: Props) {
  const straightWin = rules.baseWinPoints + rules.offensiveBonusPoints;
  const decidingWin = rules.baseWinPoints;
  const decidingLoss = rules.baseLossPoints + rules.defensiveBonusPoints;
  const straightLoss = rules.baseLossPoints;

  return (
    <section className="tournament-config">
      <header>
        <div>
          <h3>3. Règles sportives & classement</h3>
          <p>
            Ces paramètres seront la source de vérité du futur moteur de
            résultats et de classement. Un score peut se terminer avec un seul
            point d’écart.
          </p>
        </div>
      </header>

      <div className="tournament-form__grid">
        <label>
          Format des parties
          <select
            disabled={disabled}
            value={rules.matchFormat}
            onChange={(event) =>
              onChange({
                ...rules,
                matchFormat: event.target
                  .value as TournamentSportingRules["matchFormat"],
              })
            }
          >
            <option value="best_of_three_sets">2 manches gagnantes</option>
            <option value="single_game">Une seule partie</option>
          </select>
        </label>

        {rules.matchFormat === "best_of_three_sets" ? (
          <>
            <label>
              Points des manches principales
              <input
                type="number"
                min="1"
                disabled={disabled}
                value={rules.mainSetPoints}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    mainSetPoints: numberValue(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Points de la manche décisive
              <input
                type="number"
                min="1"
                disabled={disabled}
                value={rules.decidingSetPoints}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    decidingSetPoints: numberValue(event.target.value),
                  })
                }
              />
            </label>
          </>
        ) : (
          <label>
            Nombre de points de la partie
            <input
              type="number"
              min="1"
              disabled={disabled}
              value={rules.singleGamePoints}
              onChange={(event) =>
                onChange({
                  ...rules,
                  singleGamePoints: numberValue(event.target.value),
                })
              }
            />
          </label>
        )}

        <label>
          Points de base — victoire
          <input
            type="number"
            min="0"
            disabled={disabled}
            value={rules.baseWinPoints}
            onChange={(event) =>
              onChange({
                ...rules,
                baseWinPoints: numberValue(event.target.value),
              })
            }
          />
        </label>

        <label>
          Points de base — défaite
          <input
            type="number"
            min="0"
            disabled={disabled}
            value={rules.baseLossPoints}
            onChange={(event) =>
              onChange({
                ...rules,
                baseLossPoints: numberValue(event.target.value),
              })
            }
          />
        </label>

        <label>
          Bonus offensif
          <input
            type="number"
            min="0"
            disabled={disabled}
            value={rules.offensiveBonusPoints}
            onChange={(event) =>
              onChange({
                ...rules,
                offensiveBonusPoints: numberValue(event.target.value),
              })
            }
          />
        </label>

        <label>
          Bonus défensif
          <input
            type="number"
            min="0"
            disabled={disabled}
            value={rules.defensiveBonusPoints}
            onChange={(event) =>
              onChange({
                ...rules,
                defensiveBonusPoints: numberValue(event.target.value),
              })
            }
          />
        </label>

        {rules.matchFormat === "single_game" && (
          <>
            <label>
              Seuil bonus offensif — écart minimum
              <input
                type="number"
                min="1"
                disabled={disabled}
                value={rules.offensiveBonusMargin}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    offensiveBonusMargin: numberValue(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Seuil bonus défensif — écart maximum
              <input
                type="number"
                min="1"
                disabled={disabled}
                value={rules.defensiveBonusMargin}
                onChange={(event) =>
                  onChange({
                    ...rules,
                    defensiveBonusMargin: numberValue(event.target.value),
                  })
                }
              />
            </label>
          </>
        )}

        <label>
          Critère principal de classement
          <select
            disabled={disabled}
            value={rules.rankingMode}
            onChange={(event) =>
              onChange({
                ...rules,
                rankingMode: event.target
                  .value as TournamentSportingRules["rankingMode"],
              })
            }
          >
            <option value="points_per_match">
              Points de classement / partie
            </option>
            <option value="total_points">Total des points de classement</option>
          </select>
        </label>

        <label>
          Goal-average
          <select
            disabled={disabled}
            value={rules.goalAverageMode}
            onChange={(event) =>
              onChange({
                ...rules,
                goalAverageMode: event.target
                  .value as TournamentSportingRules["goalAverageMode"],
              })
            }
          >
            <option value="point_difference_per_match">
              Différence de points / partie
            </option>
            <option value="point_difference">
              Différence totale de points
            </option>
          </select>
        </label>
      </div>

      <div className="tournaments-alert">
        {rules.matchFormat === "best_of_three_sets" ? (
          <>
            <strong>Barème calculé :</strong> victoire 2–0 = {straightWin} pt
            {straightWin > 1 ? "s" : ""} · victoire 2–1 = {decidingWin} pt
            {decidingWin > 1 ? "s" : ""} · défaite 1–2 = {decidingLoss} pt
            {decidingLoss > 1 ? "s" : ""} · défaite 0–2 = {straightLoss} pt
            {straightLoss > 1 ? "s" : ""}.
          </>
        ) : (
          <>
            <strong>Barème calculé :</strong> victoire = {rules.baseWinPoints}{" "}
            pt
            {rules.baseWinPoints > 1 ? "s" : ""}, +{rules.offensiveBonusPoints}{" "}
            si l’écart est d’au moins {rules.offensiveBonusMargin} points ·
            défaite = {rules.baseLossPoints} pt
            {rules.baseLossPoints > 1 ? "s" : ""}, +{rules.defensiveBonusPoints}{" "}
            si l’écart est d’au plus {rules.defensiveBonusMargin} points.
          </>
        )}
      </div>

      <p>
        Le Ranking Engine calculera toujours les points marqués et encaissés, la
        différence de points, les points de classement et leurs valeurs par
        partie afin de comparer correctement des poules de tailles différentes.
      </p>

      {!disabled && showSaveButton && (
        <button className="tournaments-primary" type="button" onClick={onSave}>
          Enregistrer les règles sportives
        </button>
      )}
    </section>
  );
}
