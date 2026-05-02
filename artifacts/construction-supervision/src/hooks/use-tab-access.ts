import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetMyProjectPermissions } from "@workspace/api-client-react";

// إعدادات كاش موحّدة لاستعلام صلاحيات المشروع. يُستخدم في كل المواضع التي
// تستدعي `useGetMyProjectPermissions` مباشرة لكي يتشارك الجميع نفس الإعداد
// ولا تحدث إعادة جلب مفاجئة على بعض الصفحات دون غيرها.
const PERMISSIONS_QUERY_OPTIONS = {
  staleTime: 10 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnMount: false,
} as const;

export function useMyProjectPermissions(projectId: number) {
  return useGetMyProjectPermissions(projectId, {
    query: {
      enabled: !!projectId,
      ...PERMISSIONS_QUERY_OPTIONS,
    } as any,
  });
}

export type TabKey =
  | "overview"
  | "activities"
  | "extensions"
  | "suspensions"
  | "reports"
  | "forms"
  | "attendance"
  | "files"
  | "deviation";

export type TabAccess = "hidden" | "view" | "edit";

export interface UseTabAccessResult {
  access: TabAccess;
  canEdit: boolean;
  canView: boolean;
  isHidden: boolean;
  isLoading: boolean;
  projectRole?: string;
}

export function useTabAccess(
  projectId: number,
  tab: TabKey,
  options?: { redirectIfHidden?: boolean },
): UseTabAccessResult {
  const { data, isLoading } = useMyProjectPermissions(projectId);
  const [, setLocation] = useLocation();

  const explicit = data?.tabPermissions?.[tab] as TabAccess | undefined;

  let access: TabAccess;
  if (explicit === "hidden" || explicit === "view" || explicit === "edit") {
    access = explicit;
  } else {
    const isViewer = data?.isViewer === true;
    const canEditAll = data?.canEditAll ?? true;
    if (isViewer) access = "view";
    else if (canEditAll) access = "edit";
    else access = "view";
  }

  const isHidden = access === "hidden";
  const redirect = options?.redirectIfHidden === true;

  useEffect(() => {
    if (redirect && !isLoading && isHidden && projectId) {
      setLocation(`/projects/${projectId}`);
    }
  }, [redirect, isLoading, isHidden, projectId, setLocation]);

  return {
    access,
    canEdit: access === "edit",
    canView: !isHidden,
    isHidden,
    isLoading,
    projectRole: data?.projectRole,
  };
}
