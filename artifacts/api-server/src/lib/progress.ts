interface ActivityLike {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualProgress: number;
}

function durationDays(start: string | null, end: string | null): number {
  if (!start || !end) return 1;
  const diff = Math.ceil(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(1, diff);
}

export function calcWeightedProgress(activities: ActivityLike[]): number {
  if (activities.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const a of activities) {
    const w = durationDays(a.plannedStartDate, a.plannedEndDate);
    weightedSum += a.actualProgress * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}


export function calcActivityPlannedProgress(
  activity: { plannedStartDate: string | null; plannedEndDate: string | null },
  today: Date = new Date(),
): number {
  if (!activity.plannedStartDate || !activity.plannedEndDate) return 0;
  const start = new Date(activity.plannedStartDate);
  const end = new Date(activity.plannedEndDate);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return today >= start ? 100 : 0;

  const elapsed = today.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 100;
  return (elapsed / duration) * 100;
}

export function calcPlannedProgressForProject(
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
  today: Date = new Date(),
): number {
  if (activities.length === 0) {
    return Math.min(100, (daysElapsed / totalDays) * 100);
  }

  const sum = activities.reduce(
    (s, a) => s + calcActivityPlannedProgress(a, today),
    0,
  );
  return Math.min(100, sum / activities.length);
}

export function calcDelayDays(
  plannedProgress: number,
  actualProgress: number,
  totalDays: number,
): number {
  if (actualProgress >= plannedProgress) return 0;
  return Math.round((plannedProgress - actualProgress) / 100 * totalDays);
}
