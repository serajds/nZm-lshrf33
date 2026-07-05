import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("JWT_SECRET environment variable is required in production"); })()
    : "engineering-supervision-dev-secret-key"
);

export interface JwtPayload {
  userId: number;
  phone: string;
  role: string;
}

// Full token lifetime in seconds (7 days). When the remaining lifetime of a
// presented token falls below half of this value, requireAuth will mint a
// fresh token and return it to the client via the X-Renewed-Token response
// header, giving us a rolling session for active users.
export const JWT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const JWT_RENEWAL_THRESHOLD_SECONDS = Math.floor(JWT_LIFETIME_SECONDS / 2);

export function signToken(payload: JwtPayload): string {
  // Strip any standard JWT claims the caller may have copied over from a
  // verified token; otherwise jsonwebtoken throws "Bad options.expiresIn".
  const { userId, phone, role } = payload;
  return jwt.sign({ userId, phone, role }, JWT_SECRET, { expiresIn: JWT_LIFETIME_SECONDS });
}

export interface VerifiedToken extends JwtPayload {
  iat: number;
  exp: number;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function verifyTokenWithClaims(token: string): VerifiedToken | null {
  try {
    return jwt.verify(token, JWT_SECRET) as VerifiedToken;
  } catch {
    return null;
  }
}

/**
 * Classify WHY a token failed verification, for diagnostic logging only.
 * Returns the jsonwebtoken error name (e.g. "TokenExpiredError",
 * "JsonWebTokenError") plus decoded iat/exp when the payload is readable,
 * without ever trusting or returning the claims for authorization.
 */
export function classifyTokenFailure(token: string): {
  errorName: string;
  errorMessage: string;
  iat: number | null;
  exp: number | null;
} {
  let errorName = "UnknownError";
  let errorMessage = "";
  try {
    jwt.verify(token, JWT_SECRET);
    errorName = "VerifiedOk"; // should never happen on the failure path
  } catch (err) {
    errorName = (err as Error)?.name ?? "UnknownError";
    errorMessage = (err as Error)?.message ?? "";
  }
  let iat: number | null = null;
  let exp: number | null = null;
  try {
    const decoded = jwt.decode(token) as { iat?: number; exp?: number } | null;
    iat = decoded?.iat ?? null;
    exp = decoded?.exp ?? null;
  } catch {
    // undecodable token — leave nulls
  }
  return { errorName, errorMessage, iat, exp };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
