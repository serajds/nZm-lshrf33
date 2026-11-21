import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

const configuredJwtSecret = process.env.JWT_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
export const JWT_SECRET = configuredJwtSecret
  || (process.env.NODE_ENV === "production"
    ? (() => { throw new Error("JWT_SECRET or SESSION_SECRET environment variable is required in production"); })()
    : "engineering-supervision-dev-secret-key");

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

export type TokenRejectionReason = "expired" | "invalid";
export type TokenDiagnostic = {
  tokenId: string;
  reason: TokenRejectionReason;
  issuedAt?: number;
  expiresAt?: number;
  ageSeconds?: number;
  expiredBySeconds?: number;
};

/**
 * A short, irreversible identifier used only to correlate token issuance,
 * renewal and rejection in logs. The bearer credential itself is never logged.
 */
export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function diagnoseRejectedToken(token: string, nowSec = Math.floor(Date.now() / 1000)): TokenDiagnostic {
  const tokenId = fingerprintToken(token);
  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === "string") return { tokenId, reason: "invalid" };
    const issuedAt = typeof decoded.iat === "number" ? decoded.iat : undefined;
    const expiresAt = typeof decoded.exp === "number" ? decoded.exp : undefined;
    return {
      tokenId,
      reason: expiresAt !== undefined && expiresAt <= nowSec ? "expired" : "invalid",
      issuedAt,
      expiresAt,
      ageSeconds: issuedAt === undefined ? undefined : Math.max(0, nowSec - issuedAt),
      expiredBySeconds:
        expiresAt !== undefined && expiresAt <= nowSec ? nowSec - expiresAt : undefined,
    };
  } catch {
    return { tokenId, reason: "invalid" };
  }
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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
