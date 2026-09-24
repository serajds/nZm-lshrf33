export interface SourceChild {
  actualProgress: number | null;
  weight: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export interface SourceGroupSummary {
  groupId: number;
  projectId: number;
  projectName: string;
  groupName: string;
  linkCode: string | null;
  actualProgress: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export function normalizeLinkCode(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return String(value).trim().toLowerCase();
}

export function groupMatchesSourceQuery(group: { name: string; linkCode: string | null }, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;
  return group.name.toLowerCase().includes(normalizedQuery)
    || Boolean(group.linkCode?.toLowerCase().startsWith(normalizedQuery));
}

export function resolveSourceSuggestions<T extends { linkCode: string | null }>(suggestions: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  const exact = suggestions.filter(group => group.linkCode?.toLowerCase() === normalizedQuery);
  if (exact.length) return [exact[0]];
  return [...suggestions].sort((left, right) => {
    const leftPrefix = left.linkCode?.toLowerCase().startsWith(normalizedQuery) ? 1 : 0;
    const rightPrefix = right.linkCode?.toLowerCase().startsWith(normalizedQuery) ? 1 : 0;
    return rightPrefix - leftPrefix;
  });
}

export function sourceIsAvailable(summary: SourceGroupSummary | null): boolean {
  return summary !== null;
}

export function linkedSourceIdAfterPatch(currentId: number | null, requestedId: number | null | undefined): number | null {
  return requestedId === undefined ? currentId : requestedId;
}

export function currentRoleCanReadProject(
  currentRole: string,
  isMember: boolean,
  contractorCompanyId: number | null,
  userCompanyIds: number[],
): boolean {
  if (currentRole === "admin" || isMember) return true;
  return currentRole !== "project_manager" && contractorCompanyId != null
    && userCompanyIds.includes(contractorCompanyId);
}

export function suspensionActivityDateShift(
  activity: {
    externalSourceGroupId: number | null;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
  },
  suspensionStart: string,
  calendarDays: number,
  direction: 1 | -1,
): { plannedStartDate: string; plannedEndDate: string } | null {
  if (activity.externalSourceGroupId != null || !activity.plannedStartDate || !activity.plannedEndDate) return null;
  const add = (date: string) => {
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + calendarDays * direction);
    return shifted.toISOString().slice(0, 10);
  };
  if (activity.plannedStartDate >= suspensionStart) {
    return {
      plannedStartDate: add(activity.plannedStartDate),
      plannedEndDate: add(activity.plannedEndDate),
    };
  }
  if (activity.plannedEndDate >= suspensionStart) {
    return {
      plannedStartDate: activity.plannedStartDate,
      plannedEndDate: add(activity.plannedEndDate),
    };
  }
  return null;
}

export function summarizeSourceChildren(
  children: SourceChild[],
  group: Omit<SourceGroupSummary, "actualProgress" | "plannedStartDate" | "plannedEndDate">,
): SourceGroupSummary {
  const weight = (child: SourceChild) =>
    child.weight != null && Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1;
  const totalWeight = children.reduce((sum, child) => sum + weight(child), 0);
  const actualProgress = totalWeight
    ? Math.round(children.reduce((sum, child) => sum + (child.actualProgress ?? 0) * weight(child), 0) / totalWeight * 10) / 10
    : 0;
  const starts = children.map(child => child.plannedStartDate).filter((date): date is string => Boolean(date)).sort();
  const ends = children.map(child => child.plannedEndDate).filter((date): date is string => Boolean(date)).sort();
  return {
    ...group,
    actualProgress,
    plannedStartDate: starts[0] ?? null,
    plannedEndDate: ends.at(-1) ?? null,
  };
}

/** Missing source data means preserve the target's last copied values. */
export function linkedActivityValues(summary: SourceGroupSummary | null, plannedProgress: number) {
  if (!summary) return null;
  return {
    actualProgress: summary.actualProgress,
    plannedStartDate: summary.plannedStartDate,
    plannedEndDate: summary.plannedEndDate,
    plannedProgress,
  };
}

/** Adding target -> source is cyclic when source can already reach target. */
export function wouldCreateDependencyCycle(
  targetProjectId: number,
  sourceProjectId: number,
  edges: Map<number, number[]>,
): boolean {
  if (targetProjectId === sourceProjectId) return true;
  const pending = [sourceProjectId];
  const visited = new Set<number>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === targetProjectId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(edges.get(current) ?? []));
  }
  return false;
}

/** Return impacted groups in source-before-target order, including converging paths exactly once. */
export function topologicalSourceGroupOrder(
  starts: number[],
  edges: Map<number, number[]>,
): number[] {
  const reachable = new Set<number>();
  const pending = [...new Set(starts)].sort((a, b) => a - b);
  while (pending.length) {
    const source = pending.shift()!;
    if (reachable.has(source)) continue;
    reachable.add(source);
    pending.push(...(edges.get(source) ?? []).filter(id => !reachable.has(id)));
  }

  const indegree = new Map([...reachable].map(id => [id, 0]));
  for (const source of reachable) {
    for (const target of edges.get(source) ?? []) {
      if (reachable.has(target)) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort((a, b) => a - b);
  const order: number[] = [];
  while (ready.length) {
    const source = ready.shift()!;
    order.push(source);
    for (const target of edges.get(source) ?? []) {
      if (!indegree.has(target)) continue;
      const nextDegree = indegree.get(target)! - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        ready.push(target);
        ready.sort((a, b) => a - b);
      }
    }
  }
  if (order.length !== reachable.size) {
    throw new Error("Cycle detected in activity source propagation graph");
  }
  return order;
}