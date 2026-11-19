export type BackfillActivity = {
  id: number;
  name: string;
  status: string;
  actualProgress: number;
  weight: number;
  actualStartDate: string | null;
  actualEndDate: string | null;
  externalSourceGroupId: number | null;
  hasHistoricalSource?: boolean;
  historicalSourceProgress?: number;
  actualHistoricalUnverified?: boolean;
};

export type BackfillSuspension = {
  type: string;
  startDate: string;
  endDate: string;
  approvedBy?: string | null;
};

export type BackfillInput = {
  periodStart: string;
  realityDate: string;
  realityProgress: number;
  activityInputs?: Array<{
    activityId: number;
    startDate?: string;
    completionDate?: string;
    points?: Array<{ date: string; progress: number }>;
  }>;
  referencePoints?: Array<{ date: string; progress: number }>;
  verifiedProjectPoints?: Array<{ date: string; progress: number }>;
  automatic?: boolean;
};

export type BackfillDay = {
  date: string;
  progress: number;
  activities: Array<BackfillActivity & { actualProgress: number; status: string }>;
};

export type BackfillPreview = {
  valid: boolean;
  methodology: string;
  periodStart: string;
  realityDate: string;
  days: number;
  excludedDays: string[];
  assumptions: string[];
  warnings: string[];
  conflicts: string[];
  estimatedActivities: number;
  unavailableActivities: number;
  realityProgress: number;
  calculatedRealityProgress: number;
  realityDifference: number;
  samples: Array<{ date: string; progress: number }>;
  snapshots: BackfillDay[];
  availableActivityIds: number[];
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 3_660;
const METHOD = "activity-linear-between-confirmed-dated-points-v2";

export function validBackfillDay(day: unknown): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function weightedProgress(activities: Array<{ actualProgress: number; weight: number }>) {
  const weightOf = (activity: { weight: number }) =>
    Number.isFinite(activity.weight) && activity.weight > 0 ? activity.weight : 1;
  const total = activities.reduce((sum, activity) => sum + weightOf(activity), 0);
  return total
    ? Math.round(activities.reduce((sum, activity) => sum + activity.actualProgress * weightOf(activity), 0) / total * 10) / 10
    : 0;
}

function interpolate(points: Array<{ day: number; progress: number }>, day: number): number {
  if (!points.length) return 0;
  if (day <= points[0].day) return points[0].progress;
  for (let i = 1; i < points.length; i++) {
    if (day <= points[i].day) {
      const left = points[i - 1], right = points[i];
      if (right.day === left.day) return right.progress;
      const ratio = (day - left.day) / (right.day - left.day);
      return left.progress + (right.progress - left.progress) * ratio;
    }
  }
  return points.at(-1)!.progress;
}

function upperBound(values: number[], target: number): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function progressAtWorkingDay(
  start: number,
  end: number,
  day: number,
  startProgress: number,
  endProgress: number,
  excludedDays: number[],
): number {
  if (day <= start) return startProgress;
  if (day >= end) return endProgress;
  const excludedBetween = (fromExclusive: number, toInclusive: number) =>
    upperBound(excludedDays, toInclusive) - upperBound(excludedDays, fromExclusive);
  const total = end - start - excludedBetween(start, end);
  const elapsed = day - start - excludedBetween(start, day);
  if (total === 0) return day >= end ? endProgress : startProgress;
  return startProgress + (endProgress - startProgress) * elapsed / total;
}

/** Reconstructs only a reviewed estimate; it never writes to project data. */
export function previewHistoricalProgress(
  project: { startDate: string | null; noSchedule: boolean },
  activities: BackfillActivity[],
  suspensions: BackfillSuspension[],
  input: BackfillInput,
  options: {
    includeSnapshots?: boolean;
    onSnapshot?: (snapshot: BackfillDay) => Promise<void>;
  } = {},
): Promise<BackfillPreview> {
  return previewHistoricalProgressAsync(project, activities, suspensions, input, options);
}

async function previewHistoricalProgressAsync(
  project: { startDate: string | null; noSchedule: boolean },
  activities: BackfillActivity[],
  suspensions: BackfillSuspension[],
  input: BackfillInput,
  options: {
    includeSnapshots?: boolean;
    onSnapshot?: (snapshot: BackfillDay) => Promise<void>;
  },
): Promise<BackfillPreview> {
  const includeSnapshots = options.includeSnapshots !== false;
  const warnings: string[] = [];
  const conflicts: string[] = [];
  const assumptions = [
    "تُستخدم أوزان البنود الحالية؛ لا يتوفر سجل مؤرخ لتغير الأوزان.",
    "يُستخدم البرنامج الحالي كنقطة مرجعية فقط؛ لا يُفترض أنه كان نافذًا تاريخيًا.",
    "تُوزع النسب خطيًا بين النقاط المؤكدة، مع تثبيت التقدم خلال العطلات الرسمية والقوة القاهرة المسجلة.",
    "تُحفظ اللقطات عند بداية اليوم بتوقيت ليبيا (Africa/Tripoli)، ووقت التسجيل الحقيقي منفصل.",
  ];
  const invalid = !validBackfillDay(input.periodStart) || !validBackfillDay(input.realityDate)
    || input.periodStart > input.realityDate || !Number.isFinite(input.realityProgress)
    || input.realityProgress < 0 || input.realityProgress > 100;
  const empty: BackfillPreview = {
    valid: false, methodology: METHOD, periodStart: input.periodStart, realityDate: input.realityDate,
    days: 0, excludedDays: [], assumptions, warnings: [], conflicts: [], estimatedActivities: 0,
    unavailableActivities: 0, realityProgress: input.realityProgress, calculatedRealityProgress: 0,
    realityDifference: 0, samples: [], snapshots: [],
    availableActivityIds: [],
  };
  if (invalid) {
    empty.conflicts.push("حدود الفترة أو نقطة واقع الحال غير صالحة.");
    return empty;
  }

  const first = dayNumber(input.periodStart), reality = dayNumber(input.realityDate);
  if (reality - first + 1 > MAX_DAYS) {
    empty.conflicts.push(`الفترة تتجاوز الحد الآمن البالغ ${MAX_DAYS} يومًا.`);
    return empty;
  }

  const excluded = new Set<number>();
  for (const suspension of suspensions) {
    if (!["official_holiday", "force_majeure"].includes(suspension.type)
      || !validBackfillDay(suspension.startDate) || !validBackfillDay(suspension.endDate)
      || suspension.startDate > suspension.endDate) continue;
    if (!suspension.approvedBy?.trim()) {
      if (suspension.endDate >= input.periodStart && suspension.startDate <= input.realityDate) {
        warnings.push(`التوقف «${suspension.startDate} — ${suspension.endDate}» غير معتمد؛ لم تُستبعد أيامه.`);
      }
      continue;
    }
    const from = Math.max(first, dayNumber(suspension.startDate));
    const to = Math.min(reality, dayNumber(suspension.endDate));
    for (let day = from; day <= to; day++) excluded.add(day);
  }
  const excludedDayNumbers = [...excluded].sort((a, b) => a - b);
  const excludedDays = excludedDayNumbers.map(dayString);
  const overrides = new Map((input.activityInputs ?? []).map(item => [item.activityId, item]));
  const referencePoints = (input.referencePoints ?? []).filter(point =>
    validBackfillDay(point.date) && point.date >= input.periodStart && point.date <= input.realityDate
    && Number.isFinite(point.progress) && point.progress >= 0 && point.progress <= 100,
  ).map(point => ({ day: dayNumber(point.date), progress: point.progress })).sort((a, b) => a.day - b.day);
  if ((input.referencePoints ?? []).length !== referencePoints.length) {
    conflicts.push("توجد نقطة مرجعية خارج الفترة أو بنسبة غير صالحة.");
  }
  for (let index = 1; index < referencePoints.length; index++) {
    if (referencePoints[index].day === referencePoints[index - 1].day
      || referencePoints[index].progress < referencePoints[index - 1].progress) {
      conflicts.push("النقاط المرجعية مكررة أو يتراجع التقدم بينها؛ راجع القيم قبل الاعتماد.");
      break;
    }
  }
  const verifiedProjectPoints = (input.verifiedProjectPoints ?? []).filter(point =>
    validBackfillDay(point.date) && point.date >= input.periodStart && point.date <= input.realityDate
    && Number.isFinite(point.progress) && point.progress >= 0 && point.progress <= 100,
  ).map(point => ({ day: dayNumber(point.date), progress: point.progress }));
  const pointByDay = new Map<number, { day: number; progress: number }>();
  for (const point of [...verifiedProjectPoints, ...referencePoints.map(point => ({
    day: point.day, progress: point.progress,
  }))].sort((a, b) => a.day - b.day)) {
    const existing = pointByDay.get(point.day);
    if (existing && Math.abs(existing.progress - point.progress) > 0.1) {
      conflicts.push(`تتعارض النقاط المرجعية الموثقة في ${dayString(point.day)}؛ لم تُعدّل أي قيمة موثقة.`);
      continue;
    }
    if (!existing) pointByDay.set(point.day, point);
  }
  const reviewedProjectPoints = [...pointByDay.values()].sort((a, b) => a.day - b.day);
  for (let index = 1; index < reviewedProjectPoints.length; index++) {
    if (reviewedProjectPoints[index].progress < reviewedProjectPoints[index - 1].progress) {
      conflicts.push("تتراجع القيم التاريخية الموثقة؛ لا يمكن استيفاء منحنى أحادي دون تغييرها.");
      break;
    }
  }
  const lastVerifiedProgress = reviewedProjectPoints.at(-1)?.progress;
  const roundedToReportedPrecision = (progress: number) => Math.round((progress + Number.EPSILON) * 10) / 10;
  if (lastVerifiedProgress !== undefined
    && roundedToReportedPrecision(lastVerifiedProgress) > roundedToReportedPrecision(input.realityProgress)) {
    conflicts.push("آخر نقطة تاريخية أعلى من واقع الحال؛ لا يجوز خفض قيمة موثقة لإكمال المنحنى.");
  }

  const perActivity = activities.map(activity => {
    const override = overrides.get(activity.id);
    const linked = activity.externalSourceGroupId != null;
    const sourcePoints = override?.points ?? [];
    const hasSourceAnchor = sourcePoints.some(point => validBackfillDay(point.date) && point.date <= input.periodStart);
    const hasItemAnchor = sourcePoints.some(point => validBackfillDay(point.date) && point.date <= input.periodStart);
    const isLinked = linked && !(activity.hasHistoricalSource === true && hasSourceAnchor);
    let startDate = activity.actualStartDate ?? override?.startDate ?? null;
    let endDate = activity.actualEndDate ?? override?.completionDate ?? null;
    const targetValue = linked && activity.historicalSourceProgress !== undefined
      ? activity.historicalSourceProgress : activity.actualProgress;
    const target = clamp(Number.isFinite(targetValue) ? targetValue : 0);
    let unavailable = false;
    let start = startDate && validBackfillDay(startDate) ? dayNumber(startDate) : null;
    let end = endDate && validBackfillDay(endDate) ? dayNumber(endDate) : null;

    if (isLinked) {
      unavailable = true;
      warnings.push(`البند المرتبط «${activity.name}»: لا يمكن إعادة بنائه دون تاريخ موثق للمشروع المصدر.`);
    } else if (!linked && (activity.status === "completed" || target >= 100)) {
      if (!end && !input.automatic) {
        unavailable = true;
        warnings.push(`البند المكتمل «${activity.name}»: أدخل تاريخ الإكمال الفعلي؛ لن يُخمن النظام نهايته.`);
      }
      if (!start) {
        unavailable = true;
        warnings.push(`البند المكتمل «${activity.name}»: تاريخ بدايته الفعلية غير متاح.`);
      }
    } else if (!linked && (activity.status === "in_progress" || target > 0)) {
      if (!start && !hasItemAnchor) {
        unavailable = true;
        warnings.push(`البند الجاري «${activity.name}»: أدخل تاريخ بداية تقديريًا؛ لن تُستخدم البداية المخططة تلقائيًا.`);
      }
    }
    if ((startDate && !validBackfillDay(startDate)) || (endDate && !validBackfillDay(endDate))) {
      unavailable = true;
      warnings.push(`البند «${activity.name}»: يوجد تاريخ فعلي غير صالح.`);
    }
    if (start != null && end != null && end < start) {
      unavailable = true;
      warnings.push(`البند «${activity.name}»: تاريخ النهاية يسبق البداية.`);
    }

    const itemPoints = [
      ...(start != null ? [{ day: start, progress: 0 }] : []),
      ...(override?.points ?? []).filter(point => validBackfillDay(point.date)
        && point.date <= input.realityDate
        && Number.isFinite(point.progress) && point.progress >= 0 && point.progress <= 100)
        .map(point => ({ day: dayNumber(point.date), progress: point.progress })),
      { day: reality, progress: target },
    ].sort((a, b) => a.day - b.day);
    const uniquePoints = itemPoints.filter((point, index) =>
      index === 0 || point.day !== itemPoints[index - 1].day,
    );
    const invalidPoints = uniquePoints.some((point, index) =>
      index > 0 && point.progress < uniquePoints[index - 1].progress,
    );
    if (invalidPoints) {
      conflicts.push(`النقاط المرجعية تتجاوز أو تتعارض مع النسبة الحالية في «${activity.name}».`);
      unavailable = true;
    }
    if (activity.status === "not_started" && target === 0) {
      return { activity, unavailable, value: (day: number) => day >= reality ? target : 0 };
    }
    if (unavailable) return { activity, unavailable, value: (_day: number) => target };

    const baseStart = start ?? uniquePoints[0]?.day ?? first;
    const baseEnd = activity.status === "completed" || target >= 100 ? end ?? reality : reality;
    const value = (day: number) => {
      if (day >= reality) return target;
      if (activity.status === "completed" && day >= baseEnd) return 100;
      const points = uniquePoints.filter(point => point.day <= reality);
      if (points.length > 1) return clamp(interpolate(points, day));
      return clamp(progressAtWorkingDay(baseStart, reality, day, 0, target, excludedDayNumbers));
    };
    return {
      activity, unavailable, value,
      historyStartDate: startDate && validBackfillDay(startDate) ? startDate : null,
      historyEndDate: endDate && validBackfillDay(endDate) ? endDate : null,
    };
  });

  const unavailableActivities = perActivity.filter(item => item.unavailable).length;
  const estimatedActivities = perActivity.length - unavailableActivities;
  const calculatedRealityProgress = weightedProgress(activities.map(activity => ({
    actualProgress: clamp(activity.actualProgress),
    weight: Number.isFinite(activity.weight) && activity.weight > 0 ? activity.weight : 1,
  })));
  const finalAnchor = pointByDay.get(reality);
  if (finalAnchor && Math.abs(finalAnchor.progress - calculatedRealityProgress) > 0.1) {
    conflicts.push("نقطة واقع الحال تتعارض مع قيمة موثقة في التاريخ نفسه.");
  }
  pointByDay.set(reality, { day: reality, progress: calculatedRealityProgress });
  const projectAnchors = [
    ...[...pointByDay.values()].sort((a, b) => a.day - b.day),
  ];
  const anchorCorrections = projectAnchors.map(anchor => ({
    day: anchor.day,
    difference: anchor.progress - weightedProgress(perActivity.map(item => ({
      actualProgress: item.value(anchor.day), weight: item.activity.weight,
    }))),
  }));
  const snapshots: BackfillDay[] = [];
  const dayCount = reality - first + 1;
  const sampleStride = Math.max(1, Math.ceil(dayCount / 12));
  const samples: Array<{ date: string; progress: number }> = [];
  const neverStartedIds = new Set(activities.filter(activity => activity.status === "not_started"
    && activity.actualProgress <= 0).map(activity => activity.id));
  let dayIndex = 0;
  for (let day = first; day <= reality; day++) {
    const rawItems = perActivity.map(({ activity, value, unavailable, historyStartDate, historyEndDate }) => {
      const actualProgress = day === reality ? clamp(activity.actualProgress) : clamp(value(day));
      const date = dayString(day);
      return {
        ...activity,
        actualProgress,
        actualHistoricalUnverified: unavailable,
        actualStartDate: historyStartDate && historyStartDate <= date ? historyStartDate : null,
        actualEndDate: historyEndDate && historyEndDate <= date ? historyEndDate : null,
        status: actualProgress >= 100 ? "completed" : actualProgress > 0 ? "in_progress" : "not_started",
      };
    });
    let correction = 0;
    const nextCorrection = anchorCorrections.findIndex(anchor => anchor.day >= day);
    if (nextCorrection === 0) correction = anchorCorrections[0].difference;
    else if (nextCorrection > 0) {
      const left = anchorCorrections[nextCorrection - 1], right = anchorCorrections[nextCorrection];
      const fraction = (day - left.day) / Math.max(1, right.day - left.day);
      correction = left.difference + (right.difference - left.difference) * fraction;
    }
    const items = [...rawItems];
    let remaining = correction;
    const totalWeight = items.filter(item => !item.actualHistoricalUnverified)
      .reduce((sum, item) => sum + (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1), 0);
    for (let pass = 0; pass < 6 && Math.abs(remaining) > 0.05; pass++) {
      const adjustable = items.filter(item => !item.actualHistoricalUnverified
        && !neverStartedIds.has(item.id)
        && (remaining > 0 ? item.actualProgress < 100 : item.actualProgress > 0));
      if (!adjustable.length) break;
      const adjustableWeight = adjustable.reduce((sum, item) =>
        sum + (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1), 0);
      const step = remaining * totalWeight / adjustableWeight;
      let appliedWeighted = 0;
      for (const item of adjustable) {
        const before = item.actualProgress;
        item.actualProgress = clamp(before + step);
        appliedWeighted += (item.actualProgress - before) * (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1);
        item.status = item.actualProgress >= 100 ? "completed" : item.actualProgress > 0 ? "in_progress" : "not_started";
      }
      remaining -= totalWeight ? appliedWeighted / totalWeight : 0;
    }
    if (Math.abs(remaining) > 0.2 && projectAnchors.some(anchor => anchor.day === day)) {
      conflicts.push(`لا يمكن توزيع نقطة ${dayString(day)} دون تجاوز القيم الموثقة أو بدء بند غير مبدوء.`);
    }
    const date = dayString(day);
    const progress = weightedProgress(items.filter(item => !item.actualHistoricalUnverified));
    const snapshot = { date, progress, activities: items };
    if (includeSnapshots) snapshots.push(snapshot);
    if (options.onSnapshot) await options.onSnapshot(snapshot);
    if (dayIndex % sampleStride === 0 || dayIndex === dayCount - 1) samples.push({ date, progress });
    dayIndex++;
  }

  const realityDifference = Math.round((input.realityProgress - calculatedRealityProgress) * 10) / 10;
  if (Math.abs(realityDifference) > 0.1) {
    conflicts.push(`واقع الحال المدخل ${input.realityProgress}% يختلف عن المحسوب من البنود الحالية ${calculatedRealityProgress}%.`);
  }
  if (project.noSchedule) warnings.push("المشروع بلا جدول؛ لن تُحسب مقارنة مخططة تاريخية.");
  else if (!project.startDate || !validBackfillDay(project.startDate)) {
    warnings.push("تاريخ بداية المشروع غير متاح؛ الفترة التقديرية لا تثبت تاريخ بدء التنفيذ.");
  }
  if (unavailableActivities) warnings.push("بعض البنود غير متاحة تاريخيًا؛ التقارير ستوضح ذلك بدل اعتماد قيمها الحالية.");

  return {
    valid: conflicts.length === 0,
    methodology: METHOD,
    periodStart: input.periodStart,
    realityDate: input.realityDate,
    days: dayCount,
    excludedDays,
    assumptions,
    warnings: [...new Set(warnings)],
    conflicts: [...new Set(conflicts)],
    estimatedActivities,
    unavailableActivities,
    realityProgress: input.realityProgress,
    calculatedRealityProgress,
    realityDifference,
    samples,
    snapshots,
    availableActivityIds: perActivity.filter(item => !item.unavailable).map(item => item.activity.id),
  };
}

export const historicalBackfillMethodology = METHOD;
