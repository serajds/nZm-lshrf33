import { Request, Response, NextFunction } from "express";
import {
  verifyToken,
  verifyTokenWithClaims,
  signToken,
  classifyTokenFailure,
  JWT_RENEWAL_THRESHOLD_SECONDS,
  JwtPayload,
} from "../lib/auth";
import { logger } from "../lib/logger";

// Diagnostic logging for every 401 issued by requireAuth. Production showed
// write requests (PATCH/PUT/POST) being rejected with 401 while GETs from the
// same client passed seconds apart; this tells us exactly WHAT arrived so we
// can distinguish "header never arrived" from "stale/expired token was sent".
// Logs only safe metadata — never the token itself.
function logAuthRejection(
  req: Request,
  reason: "missing-header" | "bad-scheme" | "invalid-token",
  token?: string,
): void {
  try {
    const diag: Record<string, unknown> = {
      reason,
      method: req.method,
      url: (req.originalUrl || req.url || "").split("?")[0],
      origin: req.headers.origin ?? null,
      referer: req.headers.referer ? true : false,
      contentType: req.headers["content-type"] ?? null,
      secFetchSite: req.headers["sec-fetch-site"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      authHeaderLen: req.headers.authorization ? req.headers.authorization.length : 0,
    };
    if (reason === "invalid-token" && token) {
      const detail = classifyTokenFailure(token);
      diag.jwtError = detail.errorName;
      diag.jwtErrorMessage = detail.errorMessage;
      diag.tokenIat = detail.iat;
      diag.tokenExp = detail.exp;
      diag.nowSec = Math.floor(Date.now() / 1000);
    }
    logger.warn({ authDiag: diag }, "auth 401");
  } catch {
    // Diagnostics must never break the request path.
  }
}
import { db } from "@workspace/db";
import { projectMembersTable, userCompaniesTable, projectsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// Issue a fresh token when the presented one has less than half its lifetime
// remaining, and return it in the X-Renewed-Token response header so the
// client can transparently replace its stored token. This gives active users
// a rolling session without ever forcing them through a hard re-login.
function maybeRenewToken(token: string, res: Response): JwtPayload | null {
  const claims = verifyTokenWithClaims(token);
  if (!claims) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = claims.exp - nowSec;
  if (remaining > 0 && remaining < JWT_RENEWAL_THRESHOLD_SECONDS) {
    try {
      const fresh = signToken({ userId: claims.userId, phone: claims.phone, role: claims.role });
      if (!res.headersSent) {
        res.setHeader("X-Renewed-Token", fresh);
      }
    } catch {
      // Renewal is best-effort — never let a signing failure break the request.
    }
  }
  return { userId: claims.userId, phone: claims.phone, role: claims.role };
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      projectRole?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logAuthRejection(req, authHeader ? "bad-scheme" : "missing-header");
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = maybeRenewToken(token, res);
  if (!payload) {
    logAuthRejection(req, "invalid-token", token);
    res.status(401).json({ error: "رمز الدخول غير صالح أو منتهي الصلاحية" });
    return;
  }

  req.user = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "يجب أن تكون مديراً للقيام بهذا الإجراء" });
      return;
    }
    next();
  });
}

export function requireAdminOrPM(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const role = req.user?.role;
    if (role !== "admin" && role !== "project_manager") {
      res.status(403).json({ error: "غير مصرح بهذه العملية" });
      return;
    }
    next();
  });
}

export function requireEngineerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const role = req.user?.role;
    if (role !== "admin" && role !== "engineer" && role !== "project_manager") {
      res.status(403).json({ error: "غير مصرح بهذه العملية" });
      return;
    }
    next();
  });
}

export function requireStaffOrContractor(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const role = req.user?.role;
    if (role !== "admin" && role !== "engineer" && role !== "project_manager" && role !== "contractor") {
      res.status(403).json({ error: "غير مصرح بهذه العملية" });
      return;
    }
    next();
  });
}

export function rejectContractor(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === "contractor" || req.projectRole === "contractor") {
    res.status(403).json({ error: "المقاول غير مصرح له بهذا الإجراء" });
    return;
  }
  next();
}

export function rejectViewer(req: Request, res: Response, next: NextFunction): void {
  if (req.projectRole === "viewer") {
    res.status(403).json({ error: "صلاحيتك للقراءة فقط، لا يمكنك تعديل هذا المشروع" });
    return;
  }
  next();
}

export function requireProjectAccess(paramName: string = "projectId") {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, async () => {
      const role = req.user?.role;

      if (role === "admin") {
        next();
        return;
      }

      const rawId = req.params[paramName] || req.params.id;
      if (!rawId) {
        res.status(400).json({ error: "معرف المشروع مطلوب" });
        return;
      }

      const projectId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
      if (isNaN(projectId)) {
        res.status(400).json({ error: "معرف المشروع غير صالح" });
        return;
      }

      const { usersTable } = await import("@workspace/db");
      const [dbUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.user!.userId));
      const actualRole = dbUser?.role || role;

      const companyLinks = await db.select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(eq(userCompaniesTable.userId, req.user!.userId));

      const companyIds = companyLinks.map(c => c.companyId);

      if (companyIds.length > 0) {
        const [project] = await db.select({ contractorCompanyId: projectsTable.contractorCompanyId })
          .from(projectsTable)
          .where(eq(projectsTable.id, projectId));

        if (project?.contractorCompanyId && companyIds.includes(project.contractorCompanyId)) {
          if (actualRole !== "admin" && actualRole !== "project_manager") {
            req.projectRole = "contractor";
            next();
            return;
          }
        }
      }

      const [membership] = await db.select()
        .from(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.projectId, projectId),
            eq(projectMembersTable.userId, req.user!.userId)
          )
        );

      if (membership) {
        // Global contractors are always locked to projectRole "contractor",
        // regardless of what their project_members row says, but they still
        // need a valid membership (or contractor-company link) to access the
        // project at all — never trust role alone for project access.
        req.projectRole = actualRole === "contractor" ? "contractor" : membership.role;
        next();
        return;
      }

      res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا المشروع" });
      return;
    });
  };
}

export function requireProjectManager(paramName: string = "projectId") {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, async () => {
      const role = req.user?.role;

      if (role === "admin") {
        next();
        return;
      }

      const rawId = req.params[paramName] || req.params.id;
      if (!rawId) {
        res.status(400).json({ error: "معرف المشروع مطلوب" });
        return;
      }

      const projectId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);

      // Global contractors can never be project managers, even if a stale
      // project_members row says otherwise.
      if (role === "contractor") {
        res.status(403).json({ error: "يجب أن تكون مدير المشروع للقيام بهذا الإجراء" });
        return;
      }

      const [membership] = await db.select()
        .from(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.projectId, projectId),
            eq(projectMembersTable.userId, req.user!.userId)
          )
        );

      if (!membership || membership.role !== "project_manager") {
        res.status(403).json({ error: "يجب أن تكون مدير المشروع للقيام بهذا الإجراء" });
        return;
      }

      // Contractor-company users can never act as project managers either,
      // unless their global role is admin or project_manager (PM exemption
      // mirrors requireProjectAccess). Anyone else linked to the project's
      // contractor company is a contractor, period.
      const companyLinks = await db.select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(eq(userCompaniesTable.userId, req.user!.userId));
      if (companyLinks.length > 0 && role !== "project_manager") {
        const [project] = await db.select({ contractorCompanyId: projectsTable.contractorCompanyId })
          .from(projectsTable).where(eq(projectsTable.id, projectId));
        if (project?.contractorCompanyId
          && companyLinks.some(c => c.companyId === project.contractorCompanyId)) {
          res.status(403).json({ error: "يجب أن تكون مدير المشروع للقيام بهذا الإجراء" });
          return;
        }
      }

      req.projectRole = membership.role;
      next();
    });
  };
}
