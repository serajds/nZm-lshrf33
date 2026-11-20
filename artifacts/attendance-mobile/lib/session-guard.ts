/**
 * A response may update auth state only while it belongs to the current
 * bearer token. In particular, login requests have no bearer token and must
 * never sign out an existing session when the credentials are rejected.
 */
export function responseBelongsToCurrentSession(
  sentToken: string | null,
  currentToken: string | null,
): boolean {
  return sentToken !== null && sentToken.length > 0 && sentToken === currentToken;
}

export function shouldExpireSession(
  status: number,
  sentToken: string | null,
  currentToken: string | null,
): boolean {
  return status === 401 && responseBelongsToCurrentSession(sentToken, currentToken);
}
