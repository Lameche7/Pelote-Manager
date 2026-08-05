export type PlatformBudgetPlan = {
  clubId: string;
  currency: string;
  oneTimeCents: number;
  monthlyCents: number;
  createsBillableResource: boolean;
  status: "pending" | "approved" | "expired" | "revoked" | "superseded";
};

export type PlatformBudgetForecast = {
  clubId: string;
  currency: string;
  forecastMonth: string;
  oneTimeTotalCents: number;
  monthlyTotalCents: number;
  clearedOneTimeCents: number;
  clearedMonthlyCents: number;
  pendingOneTimeCents: number;
  pendingMonthlyCents: number;
  currentPlanCount: number;
  billablePlanCount: number;
  pendingApprovalCount: number;
};

export type PlatformBudgetTotal = Omit<PlatformBudgetForecast, "clubId"> & {
  clubCount: number;
};

function normalizeCents(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function getForecastMonth(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isCleared(plan: PlatformBudgetPlan) {
  return !plan.createsBillableResource || plan.status === "approved";
}

export function buildPlatformBudgetForecasts(
  plans: PlatformBudgetPlan[],
  now = new Date(),
): PlatformBudgetForecast[] {
  const forecastMonth = getForecastMonth(now);
  const forecasts = new Map<string, PlatformBudgetForecast>();

  for (const plan of plans) {
    if (plan.status === "superseded") continue;

    const key = `${plan.clubId}:${plan.currency}`;
    const forecast = forecasts.get(key) ?? {
      clubId: plan.clubId,
      currency: plan.currency,
      forecastMonth,
      oneTimeTotalCents: 0,
      monthlyTotalCents: 0,
      clearedOneTimeCents: 0,
      clearedMonthlyCents: 0,
      pendingOneTimeCents: 0,
      pendingMonthlyCents: 0,
      currentPlanCount: 0,
      billablePlanCount: 0,
      pendingApprovalCount: 0,
    };
    const oneTimeCents = normalizeCents(plan.oneTimeCents);
    const monthlyCents = normalizeCents(plan.monthlyCents);
    const cleared = isCleared(plan);

    forecast.oneTimeTotalCents += oneTimeCents;
    forecast.monthlyTotalCents += monthlyCents;
    forecast.currentPlanCount += 1;

    if (plan.createsBillableResource) {
      forecast.billablePlanCount += 1;
    }

    if (cleared) {
      forecast.clearedOneTimeCents += oneTimeCents;
      forecast.clearedMonthlyCents += monthlyCents;
    } else {
      forecast.pendingOneTimeCents += oneTimeCents;
      forecast.pendingMonthlyCents += monthlyCents;
      forecast.pendingApprovalCount += 1;
    }

    forecasts.set(key, forecast);
  }

  return [...forecasts.values()].sort(
    (left, right) =>
      left.clubId.localeCompare(right.clubId) ||
      left.currency.localeCompare(right.currency),
  );
}

export function buildPlatformBudgetTotals(
  forecasts: PlatformBudgetForecast[],
): PlatformBudgetTotal[] {
  const totals = new Map<string, PlatformBudgetTotal>();

  for (const forecast of forecasts) {
    const total = totals.get(forecast.currency) ?? {
      currency: forecast.currency,
      forecastMonth: forecast.forecastMonth,
      oneTimeTotalCents: 0,
      monthlyTotalCents: 0,
      clearedOneTimeCents: 0,
      clearedMonthlyCents: 0,
      pendingOneTimeCents: 0,
      pendingMonthlyCents: 0,
      currentPlanCount: 0,
      billablePlanCount: 0,
      pendingApprovalCount: 0,
      clubCount: 0,
    };

    total.oneTimeTotalCents += forecast.oneTimeTotalCents;
    total.monthlyTotalCents += forecast.monthlyTotalCents;
    total.clearedOneTimeCents += forecast.clearedOneTimeCents;
    total.clearedMonthlyCents += forecast.clearedMonthlyCents;
    total.pendingOneTimeCents += forecast.pendingOneTimeCents;
    total.pendingMonthlyCents += forecast.pendingMonthlyCents;
    total.currentPlanCount += forecast.currentPlanCount;
    total.billablePlanCount += forecast.billablePlanCount;
    total.pendingApprovalCount += forecast.pendingApprovalCount;
    total.clubCount += 1;

    totals.set(forecast.currency, total);
  }

  return [...totals.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency),
  );
}
