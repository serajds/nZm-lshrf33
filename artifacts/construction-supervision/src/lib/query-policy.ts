// A permission rejection is final, not a transient connection problem.
// Queries only: mutation retries remain disabled.
export function retryRead(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if ((error as { name?: string } | null)?.name === "AbortError") return false;
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return failureCount < 1;
}
