export interface ActivityLike {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualProgress: number;
  weight?: number;
  externalSourceGroupId?: number | null;
  plannedProgress?: number | null;
}

export type PlannedCurve = "linear" | "scurve";
/** Stored weight is only interpreted in custom mode; duration is the live default. */
export type ActivityWeightMode = "duration" | "equal" | "custom";

const MS_PER_DAY = 86400000;

/** Normalize a date/instant to its UTC calendar day. */
export function utcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Number.NaN);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Signed calendar-day difference between two values, using UTC days. */
export function utcDayDifference(later: Date | string, earlier: Date | string): number {
  return Math.floor((utcDay(later).getTime() - utcDay(earlier).getTime()) / MS_PER_DAY);
}

/** A usable scheduled project has valid dates in chronological order. */
export function hasValidProjectSchedule(
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
): boolean {
  if (!startDate || !endDate) return false;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

/**
 * Standard rounding for ALL displayed percentages across the system.
 * Single source of truth: 1 decimal place. Use everywhere a percentage
 * leaves the API or is shown to the user to keep numbers consistent.
 */
export function roundPercent(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * Single source of truth for "is this activity overdue?".
 * An activity is delayed when it has a planned end date that has passed,
 * and it is not yet complete (neither by status nor by actualProgress).
 * Pass `noSchedule=true` for activities belonging to a project without a
 * schedule — those are never counted as delayed.
 */
export function isActivityDelayed(
  activity: { 
    plannedStartDate?: string | null; 
    plannedEndDate: string | null; 
    actualEndDate?: string | null;
    status: string; 
    actualProgress: number 
  },
  today: Date = new Date(),
  noSchedule: boolean = false,
): boolean {
  if (noSchedule) return false;
  
  const startOfDay = (d: string | null | undefined) => {
    if (!d) return null;
    const date = utcDay(d);
    if (isNaN(date.getTime())) return null;
    return date;
  };

  const t = utcDay(today);
  const plannedEnd = startOfDay(activity.plannedEndDate);
  const plannedStart = startOfDay(activity.plannedStartDate);

  // Case 1: Completed but was late
  if (activity.status === "completed" || activity.actualProgress >= 100) {
    if (!plannedEnd) return false;
    const actualEnd = startOfDay(activity.actualEndDate) || t; 
    return actualEnd > plannedEnd;
  }

  // Case 2: Not started but start date passed
  if (activity.status === "not_started" && activity.actualProgress <= 0) {
    if (!plannedStart) return false;
    return t > plannedStart;
  }

  // Case 3: In progress but end date passed
  if (!plannedEnd) return false;
  return t > plannedEnd;
}

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
  activity: {
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    externalSourceGroupId?: number | null;
    plannedProgress?: number | null;
  },
  today: Date = new Date(),
  curve: PlannedCurve = "linear",
): number {
  if (activity.externalSourceGroupId != null && Number.isFinite(activity.plannedProgress)) {
    return Math.max(0, Math.min(100, activity.plannedProgress!));
  }
  if (!activity.plannedStartDate || !activity.plannedEndDate) return 0;
  const start = new Date(activity.plannedStartDate);
  const end = new Date(activity.plannedEndDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const startDay = utcDay(start).getTime();
  const endDay = utcDay(end).getTime();
  const asOfDay = utcDay(today).getTime();
  const duration = endDay - startDay;
  if (duration <= 0) return asOfDay >= startDay ? 100 : 0;

  const elapsed = asOfDay - startDay;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 100;
  const fraction = elapsed / duration;
  return curve === "scurve" ? scurveProgress(fraction) : fraction * 100;
}

export function effectiveActivityWeight(
  a: Pick<ActivityLike, "plannedStartDate" | "plannedEndDate" | "weight">,
  mode: ActivityWeightMode = "duration",
): number {
  if (mode === "equal") return 1;
  if (mode === "custom") {
    const w = a.weight;
    return w != null && Number.isFinite(w) && w > 0 ? w : 1;
  }
  if (!a.plannedStartDate || !a.plannedEndDate) return 1;
  const validCalendarDate = (value: string) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return true; // UTC instants are also accepted by utcDay.
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validCalendarDate(a.plannedStartDate) || !validCalendarDate(a.plannedEndDate)) return 1;
  const start = utcDay(a.plannedStartDate).getTime();
  const end = utcDay(a.plannedEndDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.floor((end - start) / MS_PER_DAY) + 1);
}

/** One weighted average for both live planned and actual group/project totals. */
export function weightedActivityProgress<T extends Pick<ActivityLike, "plannedStartDate" | "plannedEndDate" | "weight">>(
  activities: readonly T[],
  value: (activity: T) => number | null | undefined,
  mode: ActivityWeightMode = "duration",
): number {
  let total = 0;
  let sum = 0;
  for (const activity of activities) {
    const weight = effectiveActivityWeight(activity, mode);
    const progress = value(activity);
    sum += (progress != null && Number.isFinite(progress) ? progress : 0) * weight;
    total += weight;
  }
  return total > 0 ? Math.min(100, Math.max(0, sum / total)) : 0;
}

/**
 * Weighted planned progress for the project.
 * Uses inclusive scheduled calendar days as each activity's default weight.
 * Falls back to a linear time-based estimate when there are no activities.
 */
export function calcPlannedProgressForProject(
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
  today: Date = new Date(),
  curve: PlannedCurve = "linear",
  mode: ActivityWeightMode = "duration",
): number {
  if (activities.length === 0) {
    if (totalDays <= 0) return 0;
    return Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
  }

  return weightedActivityProgress(activities, a => calcActivityPlannedProgress(a, today, curve), mode);
}

/**
 * Weighted actual progress for the project (used for SPI / EVM-style metrics).
 */
export function calcActualProgressForProject(activities: ActivityLike[], mode: ActivityWeightMode = "duration"): number {
  return weightedActivityProgress(activities, a => a.actualProgress, mode);
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
  const end = utcDay(plannedEnd);
  if (Number.isNaN(end.getTime())) return 0;
  const diff = utcDayDifference(today, end);
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
 * Forecast project completion date using the EVM EAC(t) formula:
 *   EAC(t) = start + (Planned Duration / SPI)
 * where SPI = actualProgress / plannedProgress.
 *
 * This respects the baseline schedule: a project that is on its planned curve
 * (SPI ≈ 1) is forecast to finish on time, even if absolute progress is still low
 * because most planned work has not started yet. Falls back to a naive
 * pace-based extrapolation only when there is no usable planned baseline.
 */
export function calcForecastCompletionDate(
  startDate: Date,
  endDate: Date | null | undefined,
  today: Date,
  plannedProgress: number,
  actualProgress: number,
): Date | null {
  if (actualProgress >= 100) return today;
  if (actualProgress <= 0 && plannedProgress <= 0) return null;

  if (endDate && plannedProgress > 0 && actualProgress > 0) {
    const plannedDurationDays = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000),
    );
    const spi = actualProgress / plannedProgress;
    if (spi > 0) {
      const forecastDays = plannedDurationDays / spi;
      return new Date(startDate.getTime() + forecastDays * 86400000);
    }
  }

  if (actualProgress > 0) {
    const daysElapsed = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / 86400000));
    const totalEstimatedDays = (daysElapsed / actualProgress) * 100;
    return new Date(startDate.getTime() + totalEstimatedDays * 86400000);
  }
  return null;
}

/**
 * Expected progress percentage at the contractual end date if the current SPI is sustained.
 * Uses EVM logic: at the contract end, planned progress is 100, so expected actual = 100 × SPI.
 */
export function calcExpectedProgressAtEnd(
  plannedProgress: number,
  actualProgress: number,
): number {
  if (actualProgress >= 100) return 100;
  if (plannedProgress <= 0) return actualProgress;
  const spi = actualProgress / plannedProgress;
  return Math.min(100, Math.max(0, 100 * spi));
}
