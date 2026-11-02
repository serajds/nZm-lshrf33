/**
 * Pure helpers for the projects portfolio screen. No React, no network —
 * everything here works on the single unfiltered project list.
 */

export type PortfolioRelation = "main" | "child" | "independent";

export interface PortfolioProjectLike {
  id: number;
  name: string;
  location?: string | null;
  ownerEntity?: string | null;
  contractor?: string | null;
  supervisorEntity?: string | null;
  status: string;
  parentProjectId?: number | null;
  categoryId?: number | null;
  categoryName?: string | null;
  portfolioRelation?: PortfolioRelation | null;
  canManage?: boolean | null;
}

export interface PortfolioFilters {
  search: string;
  status: string; // "all" | status
  category: string; // "all" | "none" | id
  owner: string; // "all" | owner name
  relation: string; // "all" | PortfolioRelation
}

export const EMPTY_FILTERS: PortfolioFilters = { search: "", status: "all", category: "all", owner: "all", relation: "all" };

export function hasActiveFilters(f: PortfolioFilters) {
  return !!f.search.trim() || f.status !== "all" || f.category !== "all" || f.owner !== "all" || f.relation !== "all";
}

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/[\u064B-\u0652]/g, "")
  .trim();

export function childrenIndex<T extends PortfolioProjectLike>(projects: readonly T[]) {
  const map = new Map<number, T[]>();
  for (const p of projects) {
    if (p.parentProjectId != null) {
      const list = map.get(p.parentProjectId) ?? [];
      list.push(p);
      map.set(p.parentProjectId, list);
    }
  }
  return map;
}

export function relationOf(p: PortfolioProjectLike, children?: Map<number, unknown[]>): PortfolioRelation {
  if (p.portfolioRelation) return p.portfolioRelation;
  if (p.parentProjectId != null) return "child";
  if (children?.get(p.id)?.length) return "main";
  return "independent";
}

export function matchesFilters(p: PortfolioProjectLike, f: PortfolioFilters, children?: Map<number, unknown[]>) {
  if (f.status !== "all" && p.status !== f.status) return false;
  if (f.category === "none" && p.categoryId != null) return false;
  if (f.category !== "all" && f.category !== "none" && String(p.categoryId ?? "") !== f.category) return false;
  if (f.owner !== "all" && (p.ownerEntity ?? "") !== f.owner) return false;
  if (f.relation !== "all" && relationOf(p, children) !== f.relation) return false;
  const q = normalize(f.search);
  if (q) {
    const hay = normalize([p.name, p.location, p.ownerEntity, p.contractor, p.supervisorEntity, p.categoryName].filter(Boolean).join(" "));
    if (!q.split(/\s+/).every(token => hay.includes(token))) return false;
  }
  return true;
}

export interface PortfolioGroup<T> {
  parent: T;
  parentMatches: boolean; // false => shown only as context for matching children
  children: T[];
  totalChildren: number;
}

export interface PortfolioView<T> {
  groups: PortfolioGroup<T>[];
  standalone: T[];
  otherChildren: T[]; // children whose parent is not accessible
  matched: T[];
  matchedCount: number;
}

export function buildPortfolioView<T extends PortfolioProjectLike>(projects: readonly T[], f: PortfolioFilters): PortfolioView<T> {
  const children = childrenIndex(projects);
  const byId = new Map(projects.map(p => [p.id, p]));
  const isMatch = new Map(projects.map(p => [p.id, matchesFilters(p, f, children)]));
  const groups: PortfolioGroup<T>[] = [];
  const standalone: T[] = [];
  const otherChildren: T[] = [];

  for (const p of projects) {
    const rel = relationOf(p, children);
    if (rel === "child") {
      const parentVisible = p.parentProjectId != null && byId.has(p.parentProjectId);
      if (!parentVisible && isMatch.get(p.id)) otherChildren.push(p);
      continue;
    }
    const kids = children.get(p.id) ?? [];
    if (rel === "main" || kids.length) {
      const parentMatches = !!isMatch.get(p.id);
      const matchedKids = kids.filter(k => isMatch.get(k.id));
      if (!parentMatches && matchedKids.length === 0) continue;
      // When the parent itself matches with no narrowing filters on children,
      // show all kids; otherwise only matching kids.
      const visibleKids = parentMatches && !hasActiveFilters(f) ? kids : matchedKids;
      groups.push({ parent: p, parentMatches, children: visibleKids, totalChildren: kids.length });
    } else if (isMatch.get(p.id)) {
      standalone.push(p);
    }
  }
  const matched = projects.filter(p => isMatch.get(p.id));
  return { groups, standalone, otherChildren, matched, matchedCount: matched.length };
}

export interface PortfolioCounters {
  total: number;
  main: number;
  child: number;
  independent: number;
  byStatus: Record<string, number>;
}

export function portfolioCounters(projects: readonly PortfolioProjectLike[]): PortfolioCounters {
  const children = childrenIndex(projects);
  const c: PortfolioCounters = { total: projects.length, main: 0, child: 0, independent: 0, byStatus: {} };
  for (const p of projects) {
    c[relationOf(p, children)] += 1;
    c.byStatus[p.status] = (c.byStatus[p.status] ?? 0) + 1;
  }
  return c;
}

/** Projects eligible to be chosen as a parent for `selfId` (admin only). */
export function parentCandidates<T extends PortfolioProjectLike>(projects: readonly T[], selfId: number | null) {
  return projects.filter(p =>
    p.id !== selfId &&
    p.parentProjectId == null &&
    p.portfolioRelation !== "child",
  );
}

export function ownerOptions(projects: readonly PortfolioProjectLike[]) {
  return Array.from(new Set(projects.map(p => (p.ownerEntity ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
}

/** Prefer the Arabic `error` message from the API body over the HTTP prefix. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object") {
    const e = (data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message;
    if (typeof e === "string" && e.trim()) return e;
  }
  if (err instanceof Error && err.message && !/^HTTP \d+/.test(err.message)) return err.message;
  if (err instanceof Error) {
    const m = err.message.match(/^HTTP \d+[^:]*:\s*(.+)$/);
    if (m) return m[1];
  }
  return fallback;
}

/**
 * Build the create/update payload from form values. Non-admins NEVER send
 * parentProjectId (key omitted entirely). "none" maps to null.
 */
export function formValuesToPayload<T extends { parentProjectId: string; categoryId: string }>(
  values: T,
  opts: { isAdmin: boolean; canAssignCategory: boolean },
): Omit<T, "parentProjectId" | "categoryId"> & { parentProjectId?: number | null; categoryId?: number | null } {
  const { parentProjectId, categoryId, ...rest } = values;
  const payload: Omit<T, "parentProjectId" | "categoryId"> & { parentProjectId?: number | null; categoryId?: number | null } = { ...rest };
  if (opts.canAssignCategory) payload.categoryId = categoryId === "none" ? null : Number(categoryId);
  if (opts.isAdmin) payload.parentProjectId = parentProjectId === "none" ? null : Number(parentProjectId);
  return payload;
}
