import type { Activity, OwnerActivityGroup } from "@workspace/api-client-react";

export interface OwnerActivitySection {
  id: string;
  name: string;
  color: string;
  groupId: number | null;
  activities: Activity[];
}

export interface OwnerGroupProgressItem {
  id: string;
  name: string;
  color: string;
  activityCount: number;
  planned: number;
  actual: number;
}

export function buildOwnerActivitySections(
  groups: OwnerActivityGroup[],
  activities: Activity[],
): OwnerActivitySection[] {
  const groupedActivities = new Map<number, Activity[]>();
  const groupIds = new Set(groups.map((group) => group.id));
  const ungrouped: Activity[] = [];

  for (const activity of activities) {
    const groupId = activity.groupId;
    if (groupId != null && groupIds.has(groupId)) {
      const groupActivities = groupedActivities.get(groupId) ?? [];
      groupActivities.push(activity);
      groupedActivities.set(groupId, groupActivities);
    } else {
      ungrouped.push(activity);
    }
  }

  const orderedGroups = [...groups].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  );
  const sections: OwnerActivitySection[] = orderedGroups.map((group) => ({
    id: `group-${group.id}`,
    name: group.name,
    color: group.color,
    groupId: group.id,
    activities: groupedActivities.get(group.id) ?? [],
  }));

  if (ungrouped.length > 0) {
    sections.push({
      id: "ungrouped",
      name: "بدون مجموعة",
      color: "#6b7280",
      groupId: null,
      activities: ungrouped,
    });
  }

  return sections;
}

export function buildOwnerGroupProgressData(
  sections: OwnerActivitySection[],
): OwnerGroupProgressItem[] {
  return sections.map((section) => {
    const totalWeight = section.activities.reduce((sum, activity) => {
      const weight = Number.isFinite(activity.weight) && activity.weight > 0
        ? activity.weight
        : 1;
      return sum + weight;
    }, 0);

    const weightedProgress = (key: "plannedProgress" | "actualProgress") => (
      totalWeight > 0
        ? section.activities.reduce((sum, activity) => {
            const weight = Number.isFinite(activity.weight) && activity.weight > 0
              ? activity.weight
              : 1;
            return sum + activity[key] * weight;
          }, 0) / totalWeight
        : 0
    );

    return {
      id: section.id,
      name: section.name,
      color: section.color,
      activityCount: section.activities.length,
      planned: weightedProgress("plannedProgress"),
      actual: weightedProgress("actualProgress"),
    };
  });
}
