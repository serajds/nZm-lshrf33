interface ActivityLike {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualProgress: number;
  weight?: number;
}

export type PlannedCurve = "linear" | "scurve";

/**
 * S-curve approximation using a logistic function.
 * Maps elapsed fraction f ∈ [0,1] to progress ∈ [0,100] with slow start, fast middle, slow end.
 * f=0 → 0, f=0.5 → 50, f=1 → 100.
 */
function scurveProgress(fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 100;
  const k = 6;
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const a = sigmoid(-k / 2);
  const b = sigmoid(k / 2);
  const v = (sigmoid(k * (fraction - 0.5)) - a) / (b - a);
  return Math.max(0, Math.min(100, v * 100));
}

export function calcActivityPlannedProgress(
  activity: { plannedStartDate: string | null; plannedEndDate: string | null },
  today: Date = new Date(),
  curve: PlannedCurve = "linear",
): number {
  if (!activity.plannedStartDate || !activity.plannedEndDate) return 0;
  const start = new Date(activity.plannedStartDate);
  const end = new Date(activity.plannedEndDate);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return today >= start ? 100 : 0;

  const elapsed = today.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 100;
  const fraction = elapsed / duration;
  return curve === "scurve" ? scurveProgress(fraction) : fraction * 100;
}

function activityWeight(a: ActivityLike): number {
  const w = a.weight;
  if (w == null || !Number.isFinite(w) || w <= 0) return 1;
  return w;
}

/**
 * Weighted planned progress for the project.
 * Uses each activity's weight (default 1) so that bigger items dominate the percentage.
 * Falls back to a linear time-based estimate when there are no activities.
 */
export function calcPlannedProgressForProject(
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
  today: Date = new Date(),
  curve: PlannedCurve = "linear",
): number {
  if (activities.length === 0) {
    if (totalDays <= 0) return 0;
    return Math.min(100, (daysElapsed / totalDays) * 100);
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const a of activities) {
    const w = activityWeight(a);
    weightedSum += calcActivityPlannedProgress(a, today, curve) * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return Math.min(100, weightedSum / totalWeight);
}

/**
 * Weighted actual progress for the project (used for SPI / EVM-style metrics).
 */
export function calcActualProgressForProject(activities: ActivityLike[]): number {
  if (activities.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const a of activities) {
    const w = activityWeight(a);
    weightedSum += (a.actualProgress ?? 0) * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return Math.min(100, Math.max(0, weightedSum / totalWeight));
}

export function calcDelayDays(
  plannedProgress: number,
  actualProgress: number,
  totalDays: number,
): number {
  if (actualProgress >= plannedProgress) return 0;
  return Math.round((plannedProgress - actualProgress) / 100 * totalDays);
}

/**
 * تجاوز المدة (calendar overrun): days strictly after plannedEnd while progress < 100.
 * Both dates normalized to UTC midnight so on-the-day comparisons return 0.
 */
export function calcOverrunDays(
  today: Date,
  plannedEnd: Date | string | null | undefined,
  actualProgress: number,
): number {
  if (actualProgress >= 100 || plannedEnd == null) return 0;
  const end = plannedEnd instanceof Date ? new Date(plannedEnd) : new Date(plannedEnd);
  if (Number.isNaN(end.getTime())) return 0;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const diff = Math.floor((t - e) / 86400000);
  return Math.max(0, diff);
}

/**
 * Schedule Performance Index (EVM): SPI = EV / PV = actualProgress / plannedProgress.
 * SPI > 1 → ahead, < 1 → behind, = 1 → on schedule.
 * Returns null when planned progress is 0 (no meaningful baseline yet).
 */
export function calcSPI(plannedProgress: number, actualProgress: number): number | null {
  if (plannedProgress <= 0) return null;
  return Math.round((actualProgress / plannedProgress) * 100) / 100;
}

/**
 * Forecast project completion date based on current pace.
 * Uses the elapsed days and current actual progress to extrapolate when 100% will be reached.
 * Returns null when progress is 0 (cannot extrapolate) or when already complete.
 */
export function calcForecastCompletionDate(
  startDate: Date,
  today: Date,
  actualProgress: number,
): Date | null {
  if (actualProgress >= 100) return today;
  if (actualProgress <= 0) return null;
  const daysElapsed = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / 86400000));
  const totalEstimatedDays = (daysElapsed / actualProgress) * 100;
  const forecast = new Date(startDate.getTime() + totalEstimatedDays * 86400000);
  return forecast;
}

/**
 * Expected progress percentage at the contractual end date if the current pace continues.
 */
export function calcExpectedProgressAtEnd(
  startDate: Date,
  endDate: Date,
  today: Date,
  actualProgress: number,
): number {
  if (actualProgress >= 100) return 100;
  if (actualProgress <= 0) return 0;
  const daysElapsed = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / 86400000));
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
  const pace = actualProgress / daysElapsed;
  return Math.min(100, Math.max(0, pace * totalDays));
}
