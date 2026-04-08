interface ActivityLike {
  plannedStartDate: string;
  plannedEndDate: string;
  actualProgress: number;
}

interface ProjectLike {
  noSchedule?: boolean;
  startDate?: string | null;
  expectedEndDate?: string | null;
}

export function isProjectNoSchedule(project: ProjectLike): boolean {
  return project.noSchedule === true;
}

export function safeCalcPlannedProgressForProject(
  project: ProjectLike,
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
  today?: Date,
): number {
  if (isProjectNoSchedule(project)) return 0;
  return calcPlannedProgressForProject(activities, daysElapsed, totalDays, today);
}

export function safeCalcDelayDays(
  project: ProjectLike,
  plannedProgress: number,
  actualProgress: number,
  totalDays: number,
): number {
  if (isProjectNoSchedule(project)) return 0;
  return calcDelayDays(plannedProgress, actualProgress, totalDays);
}

export function calcActivityPlannedProgress(
  activity: { plannedStartDate: string; plannedEndDate: string },
  today: Date = new Date(),
): number {
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
