import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListProjectsQueryKey } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export interface ProjectCategory {
  id: number;
  name: string;
}

export const projectCategoriesKey = ["project-categories"] as const;

export function useProjectCategories(enabled = true) {
  return useQuery<ProjectCategory[]>({
    queryKey: projectCategoriesKey,
    queryFn: ({ signal }) => customFetch<ProjectCategory[]>(`${API_BASE}/project-categories`, { responseType: "json", signal }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: projectCategoriesKey });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
  };
}

const jsonInit = (method: string, body?: unknown): RequestInit & { responseType: "json" } => ({
  method,
  responseType: "json",
  headers: body ? { "Content-Type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export function useCreateProjectCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => customFetch<ProjectCategory>(`${API_BASE}/project-categories`, jsonInit("POST", { name })),
    onSuccess: invalidate,
  });
}

export function useRenameProjectCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => customFetch<ProjectCategory>(`${API_BASE}/project-categories/${id}`, jsonInit("PATCH", { name })),
    onSuccess: invalidate,
  });
}

export function useDeleteProjectCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`${API_BASE}/project-categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
