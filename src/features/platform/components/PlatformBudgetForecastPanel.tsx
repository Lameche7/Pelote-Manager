import { useMemo } from "react";
import {
  buildPlatformBudgetForecasts,
  buildPlatformBudgetTotals,
} from "../budget/platformBudgetForecast";
import type {
  PlatformClub,
  PlatformCostPlan,
} from "../services/platformRegistryService";
import "./PlatformBudgetForecastPanel.css";

function formatCost(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatForecastMonth(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`));
}

type PlatformBudgetForecastPanelProps = {
  clubs: PlatformClub[];
  plans: PlatformCostPlan[];
};

export function PlatformBudgetForecastPanel({
  clubs,
  plans,
}: PlatformBudgetForecastPanelProps) {
  const forecasts = useMemo(() => buildPlatformBudgetForecasts(plans), [plans]);
  const totals = useMemo(
    () => buildPlatformBudgetTotals(forecasts),
    [forecasts],
  );
  const clubNames = useMemo(
    () => new Map(clubs.map((club) => [club.id, club.name])),
    [clubs],
  );

  return (
    <section
      className="platform-budget"
      aria-labelledby="platform-budget-title"
    >
      <div className="platform-budget__heading">
        <div>
          <p className="platform-kicker">Pilotage financier</p>
          <h2 id="platform-budget-title">Prévision budgétaire mensuelle</h2>
        </div>
        <p>
          Projection calculée à partir des plans de coût courants. Ce document
          n’est ni une facture ni une autorisation de dépense.
        </p>
      </div>

      {forecasts.length === 0 ? (
        <p className="platform-budget__empty">
          Aucune prévision n’est disponible tant qu’aucun plan de coût courant
          n’a été enregistré.
        </p>
      ) : (
        <>
          <div className="platform-budget__totals">
            {totals.map((total) => (
              <article key={total.currency}>
                <div>
                  <strong>{total.currency}</strong>
                  <span>{formatForecastMonth(total.forecastMonth)}</span>
                </div>
                <dl>
                  <div>
                    <dt>Mensuel estimé</dt>
                    <dd>
                      {formatCost(total.monthlyTotalCents, total.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Déjà autorisé</dt>
                    <dd>
                      {formatCost(total.clearedMonthlyCents, total.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>À approuver</dt>
                    <dd>
                      {formatCost(total.pendingMonthlyCents, total.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Coûts ponctuels</dt>
                    <dd>
                      {formatCost(total.oneTimeTotalCents, total.currency)}
                    </dd>
                  </div>
                </dl>
                <small>
                  {total.clubCount} club{total.clubCount > 1 ? "s" : ""} ·{" "}
                  {total.pendingApprovalCount} approbation
                  {total.pendingApprovalCount > 1 ? "s" : ""} en attente
                </small>
              </article>
            ))}
          </div>

          <div className="platform-budget__clubs">
            {forecasts.map((forecast) => (
              <article key={`${forecast.clubId}:${forecast.currency}`}>
                <div className="platform-budget__club-heading">
                  <strong>
                    {clubNames.get(forecast.clubId) ?? "Club non renseigné"}
                  </strong>
                  <span>{forecast.currency}</span>
                </div>
                <dl>
                  <div>
                    <dt>Mensuel</dt>
                    <dd>
                      {formatCost(
                        forecast.monthlyTotalCents,
                        forecast.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Autorisé</dt>
                    <dd>
                      {formatCost(
                        forecast.clearedMonthlyCents,
                        forecast.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>À approuver</dt>
                    <dd>
                      {formatCost(
                        forecast.pendingMonthlyCents,
                        forecast.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Ponctuel</dt>
                    <dd>
                      {formatCost(
                        forecast.oneTimeTotalCents,
                        forecast.currency,
                      )}
                    </dd>
                  </div>
                </dl>
                <small>
                  {forecast.currentPlanCount} plan
                  {forecast.currentPlanCount > 1 ? "s" : ""} courant
                  {forecast.currentPlanCount > 1 ? "s" : ""} ·{" "}
                  {forecast.pendingApprovalCount} à approuver
                </small>
              </article>
            ))}
          </div>

          {totals.length > 1 && (
            <p className="platform-budget__notice">
              Les devises sont présentées séparément et ne sont jamais
              converties automatiquement.
            </p>
          )}
        </>
      )}
    </section>
  );
}
