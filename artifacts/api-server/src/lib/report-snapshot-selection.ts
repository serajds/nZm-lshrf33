/** Only activities already underway or completed belong in a new report's snapshot. */
export function selectReportSnapshotActivities<T extends { status: string }>(activities: readonly T[]): T[] {
  return activities.filter(activity =>
    activity.status === "in_progress" || activity.status === "completed"
  );
}