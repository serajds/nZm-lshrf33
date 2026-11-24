import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import router from "./routes";
import reportImageUploadsRouter from "./routes/report-image-uploads";
import fileImageUploadsRouter from "./routes/file-image-uploads";
import reportShareImageUploadsRouter from "./routes/report-share-image-uploads";
import { logger } from "./lib/logger";
import { JWT_SECRET, verifyToken, diagnoseRejectedToken } from "./lib/auth";
import { canViewAttendancePhoto, verifyAndMaybeRenewToken } from "./middlewares/auth";
import { requireProjectAccess } from "./middlewares/auth";
import { requireTabEdit } from "./middlewares/tab-access";
import { streamFromCloud, UPLOADS_PREFIX } from "./lib/fileStorage";
import { findStoredReportImageVariant } from "./lib/reportImageVariantStorage";
import { resolveTabPermissions } from "./lib/tab-permissions";
import { getSystemImageContentType } from "./lib/system-image-content-types";
import { isLifecycleImageFilename, resolveStoredImageForRead } from "./lib/image-read-reference";
import { streamStoredImage } from "./lib/image-object-stream";
import { createImageUploadRequestMiddleware } from "./lib/image-upload-request";
import { IMAGE_PACKET_TEXT_LIMIT_BYTES } from "@workspace/api-zod";
import { db, requestMetrics, newRequestMetrics } from "@workspace/db";
import { usersTable, userCompaniesTable, projectMembersTable, projectsTable, projectFilesTable, attendanceRecordsTable, imageAssetsTable, reportsTable, companiesTable } from "@workspace/db";
import { eq, count, inArray, and, or, sql } from "drizzle-orm";

const app: Express = express();
const uploadsDir = path.join(process.cwd(), "uploads");
app.use((req, res, next) => {
  const metrics = newRequestMetrics();
  const start = performance.now();
  const json = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("Server-Timing", [
      `db;dur=${metrics.queryMs.toFixed(1)};desc="${metrics.queries} queries"`,
      `pool;dur=${metrics.poolWaitMs.toFixed(1)}`,
      ...Object.entries(metrics.phases).map(([key, value]) => `${key};dur=${value.toFixed(1)}`),
    ].join(", "));
    return json(body);
  };
  res.on("finish", () => {
    if (performance.now() - start >= 1000) logger.info({
      method: req.method, route: req.route?.path ?? "unmatched",
      status: res.statusCode, metrics,
    }, "slow request phases");
  });
  requestMetrics.run(metrics, next);
});

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
// Authentication and business data are cached by the clients at the query
// layer, never by browsers, proxies or service workers. This prevents an old
// 401/304 response from becoming session state after a login or deployment.
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
// Expose the X-Renewed-Token response header so the browser's fetch wrapper
// can read it and silently roll the user's session forward.
app.use(cors({ exposedHeaders: ["X-Renewed-Token"] }));
// Gzip-compress JSON & text responses. Cuts list payloads (activities,
// members, files, reports) by 5-10x, which is the single biggest perceived
// win on slow connections.
app.use(compression({ threshold: 1024 }));
// Auth + distributed admission precede parsing only on image upload endpoints.
app.use("/api", reportImageUploadsRouter);
app.use("/api", fileImageUploadsRouter);
app.use("/api", reportShareImageUploadsRouter);
const attendanceImageIngress = createImageUploadRequestMiddleware({ temporaryRoot: uploadsDir });
const attendanceTextBody = express.text({ type: "text/plain", limit: IMAGE_PACKET_TEXT_LIMIT_BYTES });
const parseAttendanceTextBody: RequestHandler = (req, res, next) => {
  if (typeof req.body !== "string") { next(); return; }
  try { req.body = JSON.parse(req.body); next(); }
  catch { res.status(400).json({ error: "بيانات الحضور غير صالحة" }); }
};
for (const action of ["check-in", "check-out"]) {
  app.use(
    `/api/attendance/projects/:projectId/${action}`,
    requireProjectAccess("projectId"),
    requireTabEdit("attendance"),
    attendanceImageIngress,
    attendanceTextBody,
    parseAttendanceTextBody,
  );
}
// Keep base64 share-photo bodies from accumulating in memory when clients send
// several concurrent uploads. A database advisory lock in the upload route
// provides the corresponding cross-instance limit.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// Mobile clients use text/plain JSON to avoid edge rejection of header-stripped
// application/json requests. Attendance has a route-specific parser above:
// its image-size limit is held behind authorization and shared upload admission.
// Keep this smaller fallback for unrelated text/plain endpoints.
app.use(express.text({ type: "text/plain", limit: "22mb" }));
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (
    typeof req.body === "string" &&
    req.body.length > 0 &&
    (req.headers["content-type"] || "").toLowerCase().startsWith("text/plain")
  ) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // leave as string; route handlers will reject if they need JSON
    }
  }
  next();
});

async function canAccessPrivateUpload(filename: string, token: string, res: Response): Promise<boolean> {
  const [projectFiles, attendanceRecords] = await Promise.all([
    db.select({ id: projectFilesTable.id, projectId: projectFilesTable.projectId, category: projectFilesTable.category, fileUrl: projectFilesTable.fileUrl })
      .from(projectFilesTable)
      .where(eq(projectFilesTable.filename, filename)),
    db.select({
      id: attendanceRecordsTable.id,
      projectId: attendanceRecordsTable.projectId,
      userId: attendanceRecordsTable.userId,
    })
      .from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.selfieFilename, filename)),
  ]);
  // A filename that belongs to multiple records or projects has no reliable
  // owner at this delivery layer. Fail closed instead of picking the first row.
  if (projectFiles.length + attendanceRecords.length !== 1) return false;

  const unverifiedClaims = jwt.decode(token);
  const user = unverifiedClaims && typeof unverifiedClaims !== "string"
    && typeof unverifiedClaims.userId === "number"
    ? await verifyAndMaybeRenewToken(token, res)
    : null;

  if (attendanceRecords.length === 1) {
    const record = attendanceRecords[0];
    if (!user) return false;
    return canViewAttendancePhoto(user.userId, user.role, record.userId, record.projectId);
  }

  const file = projectFiles[0];
  if (user) {
    if (user.role === "admin") return true;
    if (user.role === "contractor") return false;

    const [memberships, projects] = await Promise.all([
      db.select({
        id: projectMembersTable.id,
        role: projectMembersTable.role,
        tabPermissions: projectMembersTable.tabPermissions,
      })
        .from(projectMembersTable)
        .where(and(
          eq(projectMembersTable.projectId, file.projectId),
          eq(projectMembersTable.userId, user.userId),
        ))
        .limit(1),
      db.select({ contractorCompanyId: projectsTable.contractorCompanyId })
        .from(projectsTable)
        .where(eq(projectsTable.id, file.projectId))
        .limit(1),
    ]);

    const contractorCompanyId = projects[0]?.contractorCompanyId;
    if (user.role !== "project_manager" && contractorCompanyId != null) {
      const companyLink = await db.select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(and(
          eq(userCompaniesTable.userId, user.userId),
          eq(userCompaniesTable.companyId, contractorCompanyId),
        ))
        .limit(1);
      if (companyLink.length > 0) return false;
    }
    if (memberships.length === 0 || memberships[0].role === "contractor") return false;
    const permissions = resolveTabPermissions(
      memberships[0].role as any,
      memberships[0].tabPermissions ?? null,
    );
    if (permissions.files !== "hidden") return true;
    // Reports permission is not permission to browse the project's files.
    // Limit this exception to the member's own report upload or an image
    // actually referenced by a report in the same authorized project.
    if (file.category !== "image" || permissions.reports === "hidden") return false;
    if (isLifecycleImageFilename(filename)) {
      const [ownUpload] = await db.select({ id: imageAssetsTable.id }).from(imageAssetsTable).where(and(
        eq(imageAssetsTable.storageKey, UPLOADS_PREFIX + filename), eq(imageAssetsTable.projectId, file.projectId),
        eq(imageAssetsTable.projectFileId, file.id), eq(imageAssetsTable.userId, user.userId),
        eq(imageAssetsTable.profile, "report"), eq(imageAssetsTable.state, "ready"),
      )).limit(1);
      if (ownUpload) return true;
    }
    const [referenced] = await db.select({ id: reportsTable.id }).from(reportsTable).where(and(
      eq(reportsTable.projectId, file.projectId), or(
        sql`${file.fileUrl} = ANY(${reportsTable.imageUrls})`,
        sql`${reportsTable.imageGroups} @> ${JSON.stringify([{ urls: [file.fileUrl] }])}::jsonb`,
      ),
    )).limit(1);
    return Boolean(referenced);
  }

  try {
    const owner = jwt.verify(
      token,
      JWT_SECRET,
    ) as { ownerToken?: string; projectId?: number };
    if (typeof owner.ownerToken !== "string" || typeof owner.projectId !== "number"
      || owner.projectId !== file.projectId) return false;

    const [project] = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(
        eq(projectsTable.id, file.projectId),
        eq(projectsTable.ownerAccessToken, owner.ownerToken),
      ))
      .limit(1);
    return Boolean(project);
  } catch {
    return false;
  }
}

app.use("/api/uploads", async (req: Request, res: Response, next: NextFunction) => {
  const reqPath = decodeURIComponent(req.path).replace(/^\//, "");
  if (reqPath.startsWith("logo-")) {
    return next();
  }
  if (isLifecycleImageFilename(reqPath)) {
    const [asset] = await db.select({ id: imageAssetsTable.id }).from(imageAssetsTable).where(and(
      eq(imageAssetsTable.storageKey, UPLOADS_PREFIX + reqPath),
      eq(imageAssetsTable.profile, "logo"),
      eq(imageAssetsTable.state, "ready"),
    )).limit(1);
    if (asset) {
      const [logo] = await db.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.logoUrl, `/api/uploads/${reqPath}`)).limit(1);
      if (logo) return next();
    }
  }
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    logger.warn({
      method: req.method,
      path: req.path,
      authRejection: authHeader ? "malformed_header" : "missing_header",
    }, "Upload authentication rejected");
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  try {
    if (await canAccessPrivateUpload(reqPath, token, res)) return next();
  } catch (error) {
    next(error);
    return;
  }
  logger.warn({
    method: req.method,
    path: req.path,
    authRejection: diagnoseRejectedToken(token),
  }, "Upload authentication rejected");
  res.status(401).json({ error: "رمز الدخول غير صالح" });
}, (req: Request, res: Response, next: NextFunction) => {
  const filename = decodeURIComponent(req.path).replace(/^\//, "");
  if (path.basename(filename) !== filename) {
    res.status(404).json({ error: "الملف غير موجود" });
    return;
  }
  const localPath = path.join(uploadsDir, filename);
  if (isLifecycleImageFilename(filename)) {
    const controller = new AbortController();
    res.once("close", () => controller.abort());
    void (async () => {
      const use = req.query.variant === "report-thumbnail" ? "thumbnail"
        : req.query.variant === "report-photo" ? "report" : "primary";
      const reference = await resolveStoredImageForRead(filename, use);
      if (res.destroyed) return;
      if (reference.kind !== "ready") {
        res.status(reference.kind === "missing" ? 404 : 503).json({ error: "نسخة الصورة غير متاحة حاليًا", code: "image_variant_unavailable" });
        return;
      }
      const result = await streamStoredImage(reference.filename, reference.bucketId, controller.signal);
      if (res.destroyed) { result.stream.destroy(); return; }
      res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
      res.setHeader("Content-Type", reference.mimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (result.contentLength) res.setHeader("Content-Length", result.contentLength);
      result.stream.on("error", () => res.destroy()).pipe(res);
    })().catch(() => {
      if (!res.destroyed && !res.headersSent) res.status(503).json({ error: "تعذّر تحميل الصورة", code: "image_read_failed" });
      else if (!res.destroyed) res.destroy();
    });
    return;
  }

  // Deliberately after the unchanged upload authorization middleware.
  if (req.query.variant === "report-photo"
    || req.query.variant === "report-thumbnail"
    || req.query.variant === "report-logo") {
    const variant = req.query.variant;
    void (async () => {
      const savedVariant = await findStoredReportImageVariant(filename, variant, uploadsDir);
      if (savedVariant) {
        res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.type(savedVariant.contentType);
        savedVariant.stream.on("error", () => {
          if (!res.headersSent) res.status(500).json({ error: "تعذّر تحميل صورة التقرير" });
          else res.end();
        });
        savedVariant.stream.pipe(res);
        return;
      }
      const contentTypeOverride = getSystemImageContentType(filename);
      const localStream = fs.existsSync(localPath) ? fs.createReadStream(localPath) : null;
      const cloudResult = localStream ? null : await streamFromCloud(filename);
      const stream = localStream ?? cloudResult?.stream;
      if (!stream) {
        res.status(404).json({ error: "نسخة الصورة غير موجودة بعد", code: "image_variant_missing" });
        return;
      }
      res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type(contentTypeOverride ?? cloudResult?.contentType ?? path.extname(filename));
      const readable = stream as NodeJS.ReadableStream;
      readable.on("error", () => {
        if (!res.headersSent) res.status(500).json({ error: "تعذّر تحميل صورة التقرير" });
        else res.destroy();
      });
      readable.pipe(res);
    })().catch((error) => {
      logger.warn({ filename, variant }, "Report image read failed");
      if (!res.headersSent) res.status(500).json({ error: "تعذّر تجهيز صورة التقرير" });
    });
    return;
  }

  if (fs.existsSync(localPath)) {
    const isPublicLogo = filename.startsWith("logo-");
    const contentTypeOverride = getSystemImageContentType(filename);
    const extension = path.extname(filename).toLowerCase();
    const forceCloudRead = process.env.NODE_ENV === "production"
      && (extension === ".heic" || extension === ".heif");
    if (contentTypeOverride || forceCloudRead) {
      const cacheControl = isPublicLogo
        ? "public, max-age=2592000, immutable"
        : "private, no-store, no-cache, must-revalidate";
      if (process.env.NODE_ENV === "production") {
        void streamFromCloud(filename).then((result) => {
          if (!result) {
            res.status(404).json({ error: "الملف غير موجود" });
            return;
          }
          res.setHeader("Cache-Control", cacheControl);
          res.setHeader("Content-Type", contentTypeOverride ?? result.contentType ?? "application/octet-stream");
          (result.stream as NodeJS.ReadableStream).pipe(res);
        }).catch((error) => {
          logger.warn({ err: error, filename }, "Compressed upload could not be read from object storage");
          if (!res.headersSent) res.status(500).json({ error: "تعذّر تحميل الصورة" });
        });
      } else {
        res.setHeader("Cache-Control", cacheControl);
        res.setHeader("Content-Type", contentTypeOverride ?? "application/octet-stream");
        fs.createReadStream(localPath).on("error", () => {
          if (!res.headersSent) res.status(500).json({ error: "تعذّر تحميل الصورة" });
          else res.end();
        }).pipe(res);
      }
      return;
    }
    return express.static(uploadsDir, {
      setHeaders: (res) => {
        res.setHeader(
          "Cache-Control",
          isPublicLogo
            ? "public, max-age=2592000, immutable"
            : "private, no-store, no-cache, must-revalidate",
        );
      },
    })(req, res, next);
  }

  streamFromCloud(filename).then((result) => {
    if (!result) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }
    if (result.contentType) {
      res.setHeader("Content-Type", result.contentType);
    }
    res.setHeader(
      "Cache-Control",
      filename.startsWith("logo-")
        ? "public, max-age=86400"
        : "private, no-store, no-cache, must-revalidate",
    );
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

// In-memory cache for the pending-profile gate.
// Was previously running 3-4 DB queries on EVERY /api request, adding
// 30-100ms of fixed latency to the entire app. Now we cache the
// "is this user complete?" decision per userId for 60s. The cache is
// invalidated automatically when the TTL expires; explicit invalidation
// happens in users.ts/companies.ts/project-members.ts when assignments
// change (see invalidateProfileCache below).
type ProfileStatus = { isAdmin: boolean; isIncomplete: boolean; expiresAt: number };
const profileCache = new Map<number, ProfileStatus>();
const PROFILE_CACHE_TTL_MS = 60_000;

export function invalidateProfileCache(userId?: number) {
  if (userId === undefined) profileCache.clear();
  else profileCache.delete(userId);
}

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

  const now = Date.now();
  const cached = profileCache.get(payload.userId);
  if (cached && cached.expiresAt > now) {
    if (cached.isAdmin) return next();
    if (cached.isIncomplete) {
      res.status(403).json({
        error: "حسابك بانتظار التعيين من قبل المسؤول",
        incompleteProfile: true,
      });
      return;
    }
    return next();
  }

  try {
    // Run all 3 independent lookups in parallel. Previously serial → ~3x
    // wall-clock latency on a cache miss.
    const [userRows, companyLinks, membershipRows] = await Promise.all([
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, payload.userId)),
      db.select({ companyId: userCompaniesTable.companyId }).from(userCompaniesTable).where(eq(userCompaniesTable.userId, payload.userId)),
      db.select({ value: count() }).from(projectMembersTable).where(eq(projectMembersTable.userId, payload.userId)),
    ]);

    const dbUser = userRows[0];
    if (dbUser?.role === "admin") {
      profileCache.set(payload.userId, { isAdmin: true, isIncomplete: false, expiresAt: now + PROFILE_CACHE_TTL_MS });
      return next();
    }

    const memberships = Number(membershipRows[0]?.value ?? 0);
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

    profileCache.set(payload.userId, { isAdmin: false, isIncomplete, expiresAt: now + PROFILE_CACHE_TTL_MS });

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
