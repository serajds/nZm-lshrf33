import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyToken } from "./lib/auth";
import { streamFromCloud, migrateExistingUploads } from "./lib/fileStorage";
import { db } from "@workspace/db";
import { usersTable, userCompaniesTable, projectMembersTable, projectsTable } from "@workspace/db";
import { eq, count, inArray } from "drizzle-orm";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Gzip-compress JSON & text responses. Cuts list payloads (activities,
// members, files, reports) by 5-10x, which is the single biggest perceived
// win on slow connections.
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const uploadsDir = path.join(process.cwd(), "uploads");

app.use("/api/uploads", (req: Request, res: Response, next: NextFunction) => {
  const reqPath = decodeURIComponent(req.path).replace(/^\//, "");
  if (reqPath.startsWith("logo-")) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const tokenParam = typeof req.query.token === "string" ? req.query.token : null;
    if (tokenParam) {
      if (verifyToken(tokenParam)) return next();
      try {
        const ownerSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-owner-secret-key-change-in-prod";
        const decoded = jwt.verify(tokenParam, ownerSecret) as any;
        if (decoded.ownerToken && decoded.projectId) return next();
      } catch {}
    }
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const token = authHeader.slice(7);
  if (verifyToken(token)) return next();
  try {
    const ownerSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-owner-secret-key-change-in-prod";
    const decoded = jwt.verify(token, ownerSecret) as any;
    if (decoded.ownerToken && decoded.projectId) return next();
  } catch {}
  res.status(401).json({ error: "رمز الدخول غير صالح" });
}, (req: Request, res: Response, next: NextFunction) => {
  const filename = decodeURIComponent(req.path).replace(/^\//, "");
  const localPath = path.join(uploadsDir, filename);

  if (fs.existsSync(localPath)) {
    return express.static(uploadsDir)(req, res, next);
  }

  streamFromCloud(filename).then((result) => {
    if (!result) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }
    if (result.contentType) {
      res.setHeader("Content-Type", result.contentType);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    const readable = result.stream as NodeJS.ReadableStream;
    readable.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "خطأ في قراءة الملف" });
      } else {
        res.end();
      }
    });
    readable.pipe(res);
  }).catch(() => {
    if (!res.headersSent) {
      res.status(500).json({ error: "خطأ في قراءة الملف" });
    }
  });
});

// Block users with an incomplete profile (no company OR no project assignment)
// from any privileged endpoint. They can still call auth endpoints (so the UI
// can show a "pending assignment" screen and they can refresh / log out), and
// truly public endpoints (health, owner-token portal, public form submissions).
// Admins always bypass this gate.
const PENDING_PROFILE_ALLOWLIST = new Set([
  "/auth/me",
  "/auth/login",
  "/auth/register",
  "/auth/logout",
  "/healthz",
]);

app.use("/api", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const reqPath = req.path;

  if (
    PENDING_PROFILE_ALLOWLIST.has(reqPath) ||
    reqPath.startsWith("/owner/") ||
    reqPath.startsWith("/public-forms/") ||
    reqPath.startsWith("/setup/") ||
    reqPath === "/setup"
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    return next();
  }

  if (payload.role === "admin") {
    return next();
  }

  try {
    const [dbUser] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));

    if (dbUser?.role === "admin") {
      return next();
    }

    const companyLinks = await db
      .select({ companyId: userCompaniesTable.companyId })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, payload.userId));

    const [membershipCount] = await db
      .select({ value: count() })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, payload.userId));

    const memberships = Number(membershipCount?.value ?? 0);
    let hasContractorCompanyProject = false;
    if (memberships === 0 && companyLinks.length > 0) {
      const [hasProject] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(inArray(projectsTable.contractorCompanyId, companyLinks.map(c => c.companyId)))
        .limit(1);
      if (hasProject) hasContractorCompanyProject = true;
    }

    const isIncomplete =
      companyLinks.length === 0 ||
      (memberships === 0 && !hasContractorCompanyProject);

    if (isIncomplete) {
      res.status(403).json({
        error: "حسابك بانتظار التعيين من قبل المسؤول",
        incompleteProfile: true,
      });
      return;
    }

    next();
  } catch (err) {
    logger.error({ err }, "Pending-profile gate failed");
    res.status(500).json({ error: "خطأ في التحقق من حالة الحساب" });
    return;
  }
});

app.use("/api", router);

export default app;
