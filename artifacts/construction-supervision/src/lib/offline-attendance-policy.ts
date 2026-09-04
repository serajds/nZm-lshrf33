export function isAttendanceSessionCurrent(
  flushToken: string,
  currentToken: string | null,
  ownerUserId: number,
  currentUserId: number | undefined,
): boolean {
  return currentToken === flushToken && currentUserId === ownerUserId;
}

export function shouldRetainAttendanceResponse(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}