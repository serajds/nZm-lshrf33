import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../lib/auth";
import { db } from "@workspace/db";
import { projectMembersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
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
    if (role !== "admin" && role !== "engineer" && role !== "project_manager" && role !== "contractor") {
      res.status(403).json({ error: "غير مصرح بهذه العملية" });
      return;
    }
    next();
  });
}

export function requireProjectAccess(paramName: string = "projectId") {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, async () => {
      const role = req.user?.role;

      if (role === "admin") {
        next();
        return;
      }

      if (role !== "engineer" && role !== "project_manager" && role !== "contractor") {
        res.status(403).json({ error: "غير مصرح بهذه العملية" });
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

      const [membership] = await db.select()
        .from(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.projectId, projectId),
            eq(projectMembersTable.userId, req.user!.userId)
          )
        );

      if (!membership) {
        res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا المشروع" });
        return;
      }

      req.projectRole = membership.role;
      next();
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

      req.projectRole = membership.role;
      next();
    });
  };
}
