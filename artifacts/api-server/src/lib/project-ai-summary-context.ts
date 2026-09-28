export interface ProjectSummaryActivity {
  id: number;
  name: string;
  groupId: number | null;
  status: string | null;
  actualProgress: number;
  plannedProgress: number;
  weight: number;
  variance: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  delayed: boolean;
  linkedToSource: boolean;
  generatedByGroup: boolean;
}

export interface ProjectSummaryGroup {
  id: number;
  name: string;
}

export interface ProjectSummaryMetrics {
  roundPercent: (value: number) => number;
  calcSPI: (planned: number, actual: number) => number | null;
}

/** Compress stable activity detail only when there are more than 40 stable rows. */
export const PROJECT_AI_SUMMARY_DETAIL_THRESHOLD = 40;
/** When compressed, retain two stable examples per group and status. */
const STABLE_REPRESENTATIVES_PER_STATUS = 2;

function weightedProgress(
  activities: ProjectSummaryActivity[],
  field: "actualProgress" | "plannedProgress",
): number {
  if (activities.length === 0) return 0;
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const activity of activities) {
    const weight = Number.isFinite(activity.weight) && activity.weight > 0 ? activity.weight : 1;
    weightedTotal += (Number.isFinite(activity[field]) ? activity[field] : 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.min(100, Math.max(0, weightedTotal / totalWeight)) : 0;
}

function countStatuses(activities: ProjectSummaryActivity[]): Record<string, number> {
  const counts: Record<string, number> = {
    not_started: 0,
    in_progress: 0,
    delayed: 0,
    completed: 0,
  };
  for (const activity of activities) {
    const status = activity.status || "غير محددة";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Build a complete, group-oriented AI context. Activities must already contain
 * resolved live progress for linked source groups.
 */
export function buildProjectAiSummaryContext(
  groups: readonly ProjectSummaryGroup[],
  activities: readonly ProjectSummaryActivity[],
  metrics: ProjectSummaryMetrics,
) {
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const groupedActivities = new Map<number, ProjectSummaryActivity[]>();
  const ungrouped: ProjectSummaryActivity[] = [];

  for (const activity of activities) {
    if (activity.groupId == null || !groupsById.has(activity.groupId)) {
      ungrouped.push(activity);
      continue;
    }
    const groupActivities = groupedActivities.get(activity.groupId) ?? [];
    groupActivities.push(activity);
    groupedActivities.set(activity.groupId, groupActivities);
  }

  // Delayed and material-variance activities are always fully detailed. Only
  // stable activity rows are eligible for compression.
  const isImportant = (activity: ProjectSummaryActivity) =>
    activity.delayed || Math.abs(activity.variance) >= 5;
  const compressStableDetails = activities.filter(activity => !isImportant(activity)).length
    > PROJECT_AI_SUMMARY_DETAIL_THRESHOLD;

  const summarizeGroup = (name: string, groupActivities: ProjectSummaryActivity[]) => {
    const planned = weightedProgress(groupActivities, "plannedProgress");
    const actual = weightedProgress(groupActivities, "actualProgress");
    const stableRepresentatives = new Map<string, Set<ProjectSummaryActivity>>();
    const omittedStableActivityCounts: Record<string, number> = {};
    if (compressStableDetails) {
      for (const activity of groupActivities) {
        if (isImportant(activity)) continue;
        const status = activity.status || "غير محددة";
        const representatives = stableRepresentatives.get(status) ?? new Set<ProjectSummaryActivity>();
        if (representatives.size < STABLE_REPRESENTATIVES_PER_STATUS) {
          representatives.add(activity);
          stableRepresentatives.set(status, representatives);
        } else {
          omittedStableActivityCounts[status] = (omittedStableActivityCounts[status] ?? 0) + 1;
        }
      }
    }
    const detailedActivities = groupActivities.filter(activity =>
      !compressStableDetails || isImportant(activity)
      || stableRepresentatives.get(activity.status || "غير محددة")?.has(activity),
    );
    return {
      name,
      activityCount: groupActivities.length,
      planned: metrics.roundPercent(planned),
      actual: metrics.roundPercent(actual),
      spi: metrics.calcSPI(planned, actual),
      statusCounts: countStatuses(groupActivities),
      delayedCount: groupActivities.filter(activity => activity.delayed).length,
      omittedStableActivityCount: Object.values(omittedStableActivityCounts).reduce((sum, count) => sum + count, 0),
      omittedStableActivityCounts,
      // All delayed/high-variance rows remain detailed; stable rows are sampled
      // only above the threshold, with omitted counts reported by status.
      activities: detailedActivities.map(activity => ({
        id: activity.id,
        name: activity.name,
        status: activity.status || "غير محددة",
        linkedToSource: activity.linkedToSource,
        generatedByGroup: activity.generatedByGroup,
        actualProgress: metrics.roundPercent(activity.actualProgress),
        plannedProgress: metrics.roundPercent(activity.plannedProgress),
        variance: metrics.roundPercent(activity.variance),
        weight: activity.weight,
        plannedStartDate: activity.plannedStartDate,
        plannedEndDate: activity.plannedEndDate,
        actualEndDate: activity.actualEndDate,
        delayed: activity.delayed,
      })),
    };
  };

  const groupSummaries = groups.map(group => summarizeGroup(
    group.name,
    groupedActivities.get(group.id) ?? [],
  ));
  const ungroupedSummary = ungrouped.length > 0
    ? summarizeGroup("بنود بلا مجموعة أو بمجموعة غير متاحة", ungrouped)
    : null;
  const omittedStableActivityCount = groupSummaries.reduce(
    (sum, group) => sum + group.omittedStableActivityCount,
    ungroupedSummary ? ungroupedSummary.omittedStableActivityCount : 0,
  );

  return {
    activityCount: activities.length,
    statusCounts: countStatuses([...activities]),
    delayedActivityCount: activities.filter(activity => activity.delayed).length,
    detailsCompressed: compressStableDetails,
    stableDetailThreshold: PROJECT_AI_SUMMARY_DETAIL_THRESHOLD,
    omittedStableActivityCount,
    groups: groupSummaries,
    ungrouped: ungroupedSummary,
  };
}