import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { attendanceRecordsTable, projectsTable, usersTable, projectMembersTable, userCompaniesTable } from "@workspace/db";
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { requireAuth, requireProjectAccess } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { haversineDistanceMeters } from "../lib/geo";
import { logAudit } from "../lib/audit";
import { pairAttendanceSessions, type AttendanceSession } from "../lib/attendance-sessions";
import { uploadToCloud, streamFromCloud } from "../lib/fileStorage";
import { sendPushToUsers, getProjectSupervisorIds } from "../lib/push";
import { verifyToken } from "../lib/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

// Africa/Tripoli is GMT+2 with no DST. Convert a YYYY-MM-DD Libya-local date
// into the corresponding UTC instants for inclusive day-range queries.
function libyaDayStartUtc(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00+02:00");
}
function libyaDayEndUtc(dateStr: string): Date {
  return new Date(dateStr + "T23:59:59.999+02:00");
}

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "att-" + uniqueSuffix + path.extname(file.originalname || ".jpg"));
  },
});
const ALLOWED_SELFIE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_SELFIE_MIME.has(file.mimetype.toLowerCase())) {
      cb(new Error("INVALID_MIME"));
      return;
    }
    cb(null, true);
  },
});

async function compressSelfie(filePath: string): Promise<{ size: number; filename: string }> {
  const baseName = path.basename(filePath, path.extname(filePath));
  const dir = path.dirname(filePath);
  const finalName = baseName + ".jpg";
  const finalPath = path.join(dir, finalName);
  // Always write to a distinct temp path so sharp never reads/writes the same file.
  const tempPath = path.join(dir, baseName + ".compressing.jpg");

  // Verify content is actually a decodable image (defense-in-depth: MIME header
  // can be spoofed). Sharp will throw on non-image input.
  const meta = await sharp(filePath).metadata();
  if (!meta.format) throw new Error("INVALID_IMAGE_CONTENT");

  await sharp(filePath)
    .rotate()
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(tempPath);

  // Replace original (or sibling) with the compressed version.
  if (fs.existsSync(finalPath) && finalPath !== filePath) fs.unlinkSync(finalPath);
  if (filePath !== finalPath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  fs.renameSync(tempPath, finalPath);

  const stats = fs.statSync(finalPath);
  return { size: stats.size, filename: finalName };
}

// Accept the selfie either as a multipart "selfie" file OR as a base64 string
// inside a JSON body sent with Content-Type: text/plain. The base64/text-plain
// path exists because Replit's Autoscale edge CSRF check can reject a bare
// multipart POST whose Origin/Referer were stripped (e.g. a PWA service worker
// replaying an offline-queued upload), returning its own HTML 403 that never
// reaches Express. text/plain is a CORS-safe content type the edge always
// lets through; app.ts parses such bodies as JSON before this runs.
async function decodeBase64Selfie(req: Request, res: Response, next: NextFunction): Promise<void> {
  const b64raw = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>).selfieBase64 : undefined;
  if (typeof b64raw !== "string" || b64raw.length === 0) {
    // No image in the payload — defer to recordAttendance so an idempotent
    // duplicate flush can short-circuit, and a genuinely missing selfie still
    // yields the standard "صورة من الموقع مطلوبة" 400.
    next();
    return;
  }
  const commaIdx = b64raw.indexOf(",");
  const payload = b64raw.startsWith("data:") && commaIdx !== -1 ? b64raw.slice(commaIdx + 1) : b64raw;
  let buf: Buffer;
  try {
    buf = Buffer.from(payload, "base64");
  } catch {
    res.status(400).json({ error: "صورة غير صالحة" });
    return;
  }
  if (buf.length === 0 || buf.length > 15 * 1024 * 1024) {
    res.status(400).json({ error: "صورة غير صالحة" });
    return;
  }
  // Defense-in-depth: confirm the bytes are a decodable image (mirrors the
  // multipart fileFilter MIME gate).
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.format) throw new Error("not-image");
  } catch {
    res.status(400).json({ error: "نوع الصورة غير مدعوم" });
    return;
  }
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const filename = "att-" + uniqueSuffix + ".jpg";
  const filePath = path.join(uploadsDir, filename);
  try {
    await fs.promises.writeFile(filePath, buf);
  } catch {
    res.status(500).json({ error: "تعذّر حفظ الصورة" });
    return;
  }
  req.file = { path: filePath, filename, mimetype: "image/jpeg" } as unknown as Express.Multer.File;
  next();
}

// Route the request to multer (multipart) or the base64 decoder (text/plain
// JSON), and always surface a JSON error instead of multer's default HTML.
function selfieUpload(req: Request, res: Response, next: NextFunction): void {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    upload.single("selfie")(req, res, (err: unknown) => {
      if (err) {
        const tooBig = err instanceof Error && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE";
        const msg = err instanceof Error && err.message === "INVALID_MIME"
          ? "نوع الصورة غير مدعوم"
          : tooBig ? "حجم الصورة كبير جداً" : "تعذّر رفع الصورة";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
    return;
  }
  void decodeBase64Selfie(req, res, next);
}

const router: IRouter = Router();

export async function userBelongsToProject(userId: number, projectId: number): Promise<boolean> {
  // Direct project membership
  const [direct] = await db.select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.userId, userId), eq(projectMembersTable.projectId, projectId)))
    .limit(1);
  if (direct) return true;

  // Via company membership (user is employee of project's owner / contractor / supervisor company)
  const [project] = await db.select({
    ownerCompanyId: projectsTable.ownerCompanyId,
    contractorCompanyId: projectsTable.contractorCompanyId,
    supervisorCompanyId: projectsTable.supervisorCompanyId,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return false;

  const projectCompanyIds = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId]
    .filter((id): id is number => typeof id === "number");
  if (projectCompanyIds.length === 0) return false;

  const [viaCompany] = await db.select({ id: userCompaniesTable.id })
    .from(userCompaniesTable)
    .where(and(
      eq(userCompaniesTable.userId, userId),
      inArray(userCompaniesTable.companyId, projectCompanyIds),
    ))
    .limit(1);
  return !!viaCompany;
}

async function getProjectIdsForUser(userId: number, role: string): Promise<number[]> {
  if (role === "admin") {
    const all = await db.select({ id: projectsTable.id }).from(projectsTable);
    return all.map(p => p.id);
  }
  const ids = new Set<number>();
  const memberships = await db.select({ projectId: projectMembersTable.projectId })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, userId));
  memberships.forEach(m => ids.add(m.projectId));

  const companies = await db.select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId));
  if (companies.length > 0) {
    const cIds = companies.map(c => c.companyId);
    const projects = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(inArray(projectsTable.contractorCompanyId, cIds));
    projects.forEach(p => ids.add(p.id));
  }
  return Array.from(ids);
}

// Get current user's status across all their projects
router.get("/attendance/my-status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  // Owners do not check in; they only see aggregate counts elsewhere.
  if (role === "owner") {
    res.json([]);
    return;
  }

  const projectIds = await getProjectIdsForUser(userId, role);
  if (projectIds.length === 0) { res.json([]); return; }

  // All records for this user across their projects, oldest first so the
  // session pairing logic can scan in chronological order.
  const records = await db.select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, userId),
      inArray(attendanceRecordsTable.projectId, projectIds),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  const projects = await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds));

  // Bucket records by project, then run session pairing per project so a
  // forgotten old check-in (older than the project's auto-close window) is
  // treated as auto-closed and does NOT keep the user blocked from a fresh
  // check-in.
  const recordsByProject = new Map<number, typeof records>();
  for (const r of records) {
    const arr = recordsByProject.get(r.projectId) ?? [];
    arr.push(r);
    recordsByProject.set(r.projectId, arr);
  }

  const out = projects.map((p) => {
    const projRecords = recordsByProject.get(p.id) ?? [];
    const sessions = pairAttendanceSessions(projRecords, p.attendanceAutoCloseHours ?? 12);
    const openSession = sessions.find((s) => s.status === "open") ?? null;
    const last = projRecords.length > 0 ? projRecords[projRecords.length - 1] : null;
    return {
      projectId: p.id,
      projectName: p.name,
      hasSiteLocation: p.siteLatitude != null && p.siteLongitude != null,
      siteLatitude: p.siteLatitude,
      siteLongitude: p.siteLongitude,
      siteRadiusMeters: p.siteRadiusMeters,
      // "Currently checked in" = there is a still-open session per the
      // session model, NOT just "the latest record happened to be a check_in".
      // This ensures a forgotten 3-day-old check-in (auto-closed) does not
      // keep the user stuck on the disabled state.
      currentlyCheckedIn: openSession !== null,
      lastRecord: last,
    };
  });

  res.json(out);
});

// Get my own attendance history
router.get("/attendance/my-history", requireAuth, async (req, res): Promise<void> => {
  // Owners do not check in; they only see aggregate counts elsewhere.
  if (req.user?.role === "owner") {
    res.status(403).json({ error: "غير متاح لصاحب المشروع" });
    return;
  }
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const projectIdQ = req.query.projectId !== undefined ? parseInt(String(req.query.projectId), 10) : NaN;

  const conds = [eq(attendanceRecordsTable.userId, userId)];
  if (!Number.isNaN(projectIdQ)) {
    conds.push(eq(attendanceRecordsTable.projectId, projectIdQ));
  }

  const records = await db.select({
    id: attendanceRecordsTable.id,
    projectId: attendanceRecordsTable.projectId,
    projectName: projectsTable.name,
    userId: attendanceRecordsTable.userId,
    type: attendanceRecordsTable.type,
    recordedAt: attendanceRecordsTable.recordedAt,
    latitude: attendanceRecordsTable.latitude,
    longitude: attendanceRecordsTable.longitude,
    accuracyMeters: attendanceRecordsTable.accuracyMeters,
    distanceMeters: attendanceRecordsTable.distanceMeters,
    outOfRange: attendanceRecordsTable.outOfRange,
    selfieUrl: attendanceRecordsTable.selfieUrl,
    notes: attendanceRecordsTable.notes,
  })
    .from(attendanceRecordsTable)
    .leftJoin(projectsTable, eq(attendanceRecordsTable.projectId, projectsTable.id))
    .where(and(...conds))
    .orderBy(desc(attendanceRecordsTable.recordedAt))
    .limit(limit);

  res.json(records);
});

// Check-in
router.post(
  "/attendance/projects/:projectId/check-in",
  requireProjectAccess("projectId"),
  requireTabEdit("attendance"),
  selfieUpload,
  async (req: Request, res: Response): Promise<void> => {
    await recordAttendance(req, res, "check_in");
  },
);

// Check-out
router.post(
  "/attendance/projects/:projectId/check-out",
  requireProjectAccess("projectId"),
  requireTabEdit("attendance"),
  selfieUpload,
  async (req: Request, res: Response): Promise<void> => {
    await recordAttendance(req, res, "check_out");
  },
);

// UUID v4 (any case) — strict to prevent abuse of the idempotency cache.
const CLIENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function recordAttendance(req: Request, res: Response, type: "check_in" | "check_out"): Promise<void> {
  // Owner is a stakeholder, not on-site staff. They cannot check in/out.
  if (req.user?.role === "owner") {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(403).json({ error: "صاحب المشروع لا يسجّل حضور" });
    return;
  }
  // Contractor staff (whether the global "contractor" role or any user
  // belonging to the project's contractor company) do not register
  // attendance in this system — attendance tracks the supervising side
  // (owner-side engineers / project managers) on-site.
  if (req.user?.role === "contractor" || req.projectRole === "contractor") {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(403).json({ error: "موظفو المقاول لا يسجّلون الحضور في هذا النظام" });
    return;
  }

  const userId = req.user!.userId;
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  // Idempotency: if the client sent a clientId and we already have a record
  // with that (userId, clientId), short-circuit and return the existing one.
  // This makes offline retries safe — the device may flush the same queued
  // request many times after re-connect without creating duplicates.
  const rawClientId = req.body.clientId !== undefined ? String(req.body.clientId).trim() : "";
  const clientId = rawClientId && CLIENT_ID_REGEX.test(rawClientId) ? rawClientId : null;
  if (clientId) {
    const [existing] = await db.select()
      .from(attendanceRecordsTable)
      .where(and(
        eq(attendanceRecordsTable.userId, userId),
        eq(attendanceRecordsTable.clientId, clientId),
      ))
      .limit(1);
    if (existing) {
      // Same logical request — drop the (likely re-uploaded) selfie file
      // and return the existing record so the client can clear its queue.
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(200).json(existing);
      return;
    }
  }

  if (!req.file) { res.status(400).json({ error: "صورة من الموقع مطلوبة" }); return; }

  const lat = req.body.latitude !== undefined ? parseFloat(String(req.body.latitude)) : NaN;
  const lng = req.body.longitude !== undefined ? parseFloat(String(req.body.longitude)) : NaN;
  const acc = req.body.accuracy !== undefined ? parseFloat(String(req.body.accuracy)) : NaN;
  const notes = (req.body.notes ? String(req.body.notes) : "").trim() || null;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: "الموقع الجغرافي مطلوب" });
    return;
  }

  // Validate coordinate ranges. Common bug: swapped lat/lng or "0,0" sentinel values.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: "إحداثيات الموقع غير صالحة" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    fs.unlink(req.file.path, () => {});
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  // Server-side state validation using session pairing logic, so we don't
  // get permanently stuck because of a forgotten check_out from days ago.
  const autoCloseHours = project.attendanceAutoCloseHours ?? 12;
  const recentRecords = await db.select({
    id: attendanceRecordsTable.id,
    type: attendanceRecordsTable.type,
    recordedAt: attendanceRecordsTable.recordedAt,
  })
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, userId),
      eq(attendanceRecordsTable.projectId, projectId),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  const sessions = pairAttendanceSessions(recentRecords, autoCloseHours);
  const lastSession = sessions[sessions.length - 1] ?? null;
  const hasOpenSession = lastSession?.status === "open";

  if (type === "check_in" && hasOpenSession) {
    fs.unlink(req.file.path, () => {});
    res.status(409).json({ error: "أنت مسجل حضور بالفعل في هذا المشروع. سجّل انصراف أولاً." });
    return;
  }
  if (type === "check_out" && !hasOpenSession) {
    fs.unlink(req.file.path, () => {});
    res.status(409).json({ error: "لا يمكن تسجيل انصراف بدون حضور سابق." });
    return;
  }

  let distance: number | null = null;
  let outOfRange = false;
  if (project.siteLatitude != null && project.siteLongitude != null) {
    distance = haversineDistanceMeters(lat, lng, project.siteLatitude, project.siteLongitude);
    const radius = project.siteRadiusMeters ?? 200;
    outOfRange = distance > radius;

    // Reject any attempt to register attendance from outside the configured
    // project geofence — site supervisors must be physically on-site.
    if (outOfRange) {
      fs.unlink(req.file.path, () => {});
      const distanceText = distance >= 1000
        ? `${(distance / 1000).toFixed(2)} كم`
        : `${Math.round(distance)} م`;
      const action = type === "check_in" ? "تسجيل الحضور" : "تسجيل الانصراف";
      res.status(403).json({
        error: `لا يمكن ${action} من خارج موقع المشروع. أنت تبعد ${distanceText} عن الموقع.`,
        outOfRange: true,
        distanceMeters: distance,
        allowedRadiusMeters: radius,
      });
      return;
    }
  }

  let selfieFilename: string;
  try {
    const compressed = await compressSelfie(req.file.path);
    selfieFilename = compressed.filename;
    try {
      await uploadToCloud(path.join(uploadsDir, selfieFilename), selfieFilename);
    } catch (err) {
      console.warn("Selfie cloud upload failed, kept locally:", err);
    }
  } catch (err) {
    console.warn("Selfie compression failed, using original:", err);
    selfieFilename = req.file.filename;
  }

  const [record] = await db.insert(attendanceRecordsTable).values({
    projectId,
    userId,
    type,
    latitude: lat,
    longitude: lng,
    accuracyMeters: Number.isNaN(acc) ? null : acc,
    distanceMeters: distance,
    outOfRange,
    selfieFilename,
    selfieUrl: `/api/attendance/records/__ID__/photo`, // placeholder; real URL is built per-request
    notes,
    clientId,
  }).returning();

  // Patch in correct id-based URL
  if (record) {
    const realUrl = `/api/attendance/records/${record.id}/photo`;
    await db.update(attendanceRecordsTable)
      .set({ selfieUrl: realUrl })
      .where(eq(attendanceRecordsTable.id, record.id));
    record.selfieUrl = realUrl;
  }

  logAudit({
    userId,
    userName: req.user?.phone,
    action: "create",
    entityType: "attendance",
    entityId: record.id,
    entityName: type === "check_in" ? "حضور" : "انصراف",
    projectId,
    projectName: project.name,
    details: { type, outOfRange, distanceMeters: distance },
  });

  // Fire-and-forget push notification to project supervisors. We never
  // await this — a slow push provider must not delay the user's response.
  (async () => {
    try {
      const recipients = await getProjectSupervisorIds(projectId, userId);
      if (recipients.length === 0) return;
      const [actor] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, userId));
      const who = actor?.fullName || "موظف";
      const action = type === "check_in" ? "سجّل حضور" : "سجّل انصراف";
      const oor = outOfRange ? " (خارج النطاق)" : "";
      await sendPushToUsers(recipients, {
        title: `${action} • ${project.name}`,
        body: `${who}${oor}`,
        url: `/projects/${projectId}/attendance`,
        tag: `attendance-${projectId}`,
        data: { kind: "attendance", projectId, recordId: record.id, type },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[push] attendance dispatch failed:", err);
    }
  })();

  res.status(201).json(record);
}

// Active (currently checked-in) for a project
router.get(
  "/attendance/projects/:projectId/active",
  requireProjectAccess("projectId"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(raw, 10);

    const isManager = req.user?.role === "admin" || req.projectRole === "project_manager";

    // Only system admins and project managers may view the active attendees list
    if (!isManager) {
      res.status(403).json({ message: "غير مسموح بعرض قائمة الحاضرين" });
      return;
    }

    // Determine the active window by the project's auto-close hours.
    const [project] = await db.select({
      attendanceAutoCloseHours: projectsTable.attendanceAutoCloseHours,
    }).from(projectsTable).where(eq(projectsTable.id, projectId));
    const autoCloseHours = project?.attendanceAutoCloseHours ?? 12;

    // Pull all records within the auto-close window (with margin), then pair
    // them per-user using session logic so we never report a user as "active"
    // when their session is past auto-close.
    const sinceMs = Date.now() - autoCloseHours * 60 * 60 * 1000 * 2;
    const since = new Date(sinceMs);

    const records = await db.select({
      id: attendanceRecordsTable.id,
      userId: attendanceRecordsTable.userId,
      type: attendanceRecordsTable.type,
      recordedAt: attendanceRecordsTable.recordedAt,
      latitude: attendanceRecordsTable.latitude,
      longitude: attendanceRecordsTable.longitude,
      accuracyMeters: attendanceRecordsTable.accuracyMeters,
      distanceMeters: attendanceRecordsTable.distanceMeters,
      outOfRange: attendanceRecordsTable.outOfRange,
      selfieUrl: attendanceRecordsTable.selfieUrl,
      notes: attendanceRecordsTable.notes,
      fullName: usersTable.fullName,
      phone: usersTable.phone,
      userRole: usersTable.role,
    })
      .from(attendanceRecordsTable)
      .innerJoin(usersTable, eq(attendanceRecordsTable.userId, usersTable.id))
      .where(and(
        eq(attendanceRecordsTable.projectId, projectId),
        gte(attendanceRecordsTable.recordedAt, since),
      ))
      .orderBy(attendanceRecordsTable.recordedAt);

    type Row = typeof records[number];
    const byUser = new Map<number, Row[]>();
    for (const r of records) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    const members: Array<{
      recordId: number;
      userId: number;
      fullName: string;
      phone: string | null;
      userRole: string;
      checkedInAt: Date;
      latitude: number | null;
      longitude: number | null;
      accuracyMeters: number | null;
      distanceMeters: number | null;
      outOfRange: boolean;
      selfieUrl: string | null;
      notes: string | null;
    }> = [];

    for (const [, userRecords] of byUser) {
      const userSessions = pairAttendanceSessions(userRecords, autoCloseHours);
      const last = userSessions[userSessions.length - 1];
      if (!last || last.status !== "open") continue;
      const ci = userRecords.find((r) => r.id === last.checkInRecord.id);
      if (!ci) continue;
      members.push({
        recordId: ci.id,
        userId: ci.userId,
        fullName: ci.fullName,
        phone: ci.phone,
        userRole: ci.userRole,
        checkedInAt: ci.recordedAt,
        latitude: ci.latitude,
        longitude: ci.longitude,
        accuracyMeters: ci.accuracyMeters,
        distanceMeters: ci.distanceMeters,
        outOfRange: ci.outOfRange,
        selfieUrl: ci.selfieUrl,
        notes: ci.notes,
      });
    }

    members.sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime());
    res.json({ activeCount: members.length, members });
  },
);

// History list with filters
router.get(
  "/attendance/projects/:projectId/records",
  requireProjectAccess("projectId"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(raw, 10);

    // Manager-only endpoint (admin or project_manager). Other roles must use /my-history.
    const isManager = req.user?.role === "admin" || req.projectRole === "project_manager";
    if (!isManager) {
      res.status(403).json({ error: "غير مصرح" });
      return;
    }

    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const userIdQ = req.query.userId ? parseInt(String(req.query.userId), 10) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 1000);

    const conditions = [eq(attendanceRecordsTable.projectId, projectId)];
    if (userIdQ && !Number.isNaN(userIdQ)) conditions.push(eq(attendanceRecordsTable.userId, userIdQ));
    if (dateFrom) conditions.push(gte(attendanceRecordsTable.recordedAt, libyaDayStartUtc(dateFrom)));
    if (dateTo) conditions.push(lte(attendanceRecordsTable.recordedAt, libyaDayEndUtc(dateTo)));

    const records = await db.select({
      id: attendanceRecordsTable.id,
      userId: attendanceRecordsTable.userId,
      fullName: usersTable.fullName,
      phone: usersTable.phone,
      type: attendanceRecordsTable.type,
      recordedAt: attendanceRecordsTable.recordedAt,
      latitude: attendanceRecordsTable.latitude,
      longitude: attendanceRecordsTable.longitude,
      accuracyMeters: attendanceRecordsTable.accuracyMeters,
      distanceMeters: attendanceRecordsTable.distanceMeters,
      outOfRange: attendanceRecordsTable.outOfRange,
      selfieUrl: attendanceRecordsTable.selfieUrl,
      notes: attendanceRecordsTable.notes,
      editedAt: attendanceRecordsTable.editedAt,
      editedByUserId: attendanceRecordsTable.editedByUserId,
      editReason: attendanceRecordsTable.editReason,
    })
      .from(attendanceRecordsTable)
      .innerJoin(usersTable, eq(attendanceRecordsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(attendanceRecordsTable.recordedAt))
      .limit(limit);

    res.json(records);
  },
);

// Per-employee daily report (date, check-in, check-out only)
router.get(
  "/attendance/projects/:projectId/users/:userId/report",
  requireProjectAccess("projectId"),
  async (req, res): Promise<void> => {
    const projectId = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
    const targetUserId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);

    if (req.user?.role === "owner") { res.status(403).json({ error: "غير مصرح" }); return; }

    // Employees can only see their own report
    if (req.user!.userId !== targetUserId && req.user?.role !== "admin" && req.projectRole !== "project_manager") {
      res.status(403).json({ error: "ليس لديك صلاحية لعرض تقرير هذا الموظف" });
      return;
    }

    // Target user must actually belong to this project (prevents PMs from
    // enumerating arbitrary users' personal info via report endpoint).
    if (req.user!.userId !== targetUserId) {
      const belongs = await userBelongsToProject(targetUserId, projectId);
      if (!belongs) { res.status(404).json({ error: "الموظف غير موجود في هذا المشروع" }); return; }
    }

    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : null;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : null;

    const conditions = [
      eq(attendanceRecordsTable.projectId, projectId),
      eq(attendanceRecordsTable.userId, targetUserId),
    ];
    
    // Widen DB query by 48h to prevent breaking sessions that cross date boundaries
    if (dateFrom) {
      const d = libyaDayStartUtc(dateFrom);
      d.setHours(d.getHours() - 48);
      conditions.push(gte(attendanceRecordsTable.recordedAt, d));
    }
    if (dateTo) {
      const d = libyaDayEndUtc(dateTo);
      d.setHours(d.getHours() + 48);
      conditions.push(lte(attendanceRecordsTable.recordedAt, d));
    }

    const records = await db.select({
      id: attendanceRecordsTable.id,
      type: attendanceRecordsTable.type,
      recordedAt: attendanceRecordsTable.recordedAt,
      outOfRange: attendanceRecordsTable.outOfRange,
      editedAt: attendanceRecordsTable.editedAt,
      editReason: attendanceRecordsTable.editReason,
    })
      .from(attendanceRecordsTable)
      .where(and(...conditions))
      .orderBy(attendanceRecordsTable.recordedAt);

    const [employee] = await db.select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));

    const [project] = await db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      attendanceAutoCloseHours: projectsTable.attendanceAutoCloseHours,
      attendanceLongDayHours: projectsTable.attendanceLongDayHours,
    })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    const autoCloseHours = project?.attendanceAutoCloseHours ?? 12;
    const longDayHours = project?.attendanceLongDayHours ?? 10;

    const allSessions = pairAttendanceSessions(records, autoCloseHours);

    // Filter sessions down to the exact requested date range based on start time
    const startMs = dateFrom ? libyaDayStartUtc(dateFrom).getTime() : -Infinity;
    const endMs = dateTo ? libyaDayEndUtc(dateTo).getTime() : Infinity;
    const sessions = allSessions.filter(s => {
      const sMs = s.startAt.getTime();
      return sMs >= startMs && sMs <= endMs;
    });

    // Group sessions by the Libya-local date of their check-in. Night-shift
    // sessions that cross midnight are counted entirely on their start date.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric", month: "2-digit", day: "2-digit",
    });

    type ReportSession = {
      checkInRecordId: number;
      checkOutRecordId: number | null;
      checkInAt: string;
      checkOutAt: string | null;
      durationMinutes: number | null;
      status: AttendanceSession["status"];
    };
    type DayBucket = {
      date: string;
      sessions: ReportSession[];
      totalMinutes: number;
      flags: { incomplete: boolean; longDay: boolean };
    };

    const byDay = new Map<string, DayBucket>();
    for (const s of sessions) {
      const day = fmt.format(s.startAt);
      let bucket = byDay.get(day);
      if (!bucket) {
        bucket = { date: day, sessions: [], totalMinutes: 0, flags: { incomplete: false, longDay: false } };
        byDay.set(day, bucket);
      }
      const session: ReportSession = {
        checkInRecordId: s.checkInRecord.id,
        checkOutRecordId: s.checkOutRecord ? s.checkOutRecord.id : null,
        checkInAt: s.startAt.toISOString(),
        checkOutAt: s.endAt ? s.endAt.toISOString() : null,
        durationMinutes: s.durationMinutes,
        status: s.status,
      };
      bucket.sessions.push(session);
      if (s.durationMinutes != null) bucket.totalMinutes += s.durationMinutes;
      if (s.status === "auto_closed" || s.status === "open") bucket.flags.incomplete = true;
    }

    const longDayMinutes = longDayHours * 60;
    for (const bucket of byDay.values()) {
      if (bucket.totalMinutes > longDayMinutes) bucket.flags.longDay = true;
    }

    const days: DayBucket[] = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

    let totalMinutes = 0;
    let workDays = 0;
    let incompleteDays = 0;
    let longDays = 0;
    for (const d of days) {
      totalMinutes += d.totalMinutes;
      if (d.totalMinutes > 0) workDays += 1;
      if (d.flags.incomplete) incompleteDays += 1;
      if (d.flags.longDay) longDays += 1;
    }
    const summary = {
      totalMinutes,
      workDays,
      averageDailyMinutes: workDays > 0 ? Math.round(totalMinutes / workDays) : 0,
      incompleteDays,
      longDays,
    };

    res.json({
      project,
      employee,
      dateFrom,
      dateTo,
      autoCloseHours,
      longDayHours,
      days,
      summary,
    });
  },
);

// Manager edit / delete of an individual record.
async function loadRecordWithProject(recordId: number) {
  const [row] = await db.select({
    id: attendanceRecordsTable.id,
    projectId: attendanceRecordsTable.projectId,
    userId: attendanceRecordsTable.userId,
    type: attendanceRecordsTable.type,
    recordedAt: attendanceRecordsTable.recordedAt,
    selfieFilename: attendanceRecordsTable.selfieFilename,
    notes: attendanceRecordsTable.notes,
    projectName: projectsTable.name,
  })
    .from(attendanceRecordsTable)
    .innerJoin(projectsTable, eq(attendanceRecordsTable.projectId, projectsTable.id))
    .where(eq(attendanceRecordsTable.id, recordId));
  return row || null;
}

// Validates that a proposed/projected sequence of attendance records is still
// reconcilable under the session model. The session-pairing logic auto-closes
// stale open check-ins, so two consecutive `check_in` records ARE legitimate
// (the earlier one is treated as auto_closed). The only truly impossible
// timeline is one that contains a `check_out` without any preceding
// `check_in` to pair against (i.e. a leading or orphan check_out at the very
// start of the user's history).
//
// Returns true if the sequence is invalid.
function isInvalidSequence(records: Array<{ type: "check_in" | "check_out" }>) {
  let seenCheckIn = false;
  for (const r of records) {
    if (r.type === "check_in") {
      seenCheckIn = true;
    } else if (!seenCheckIn) {
      // A check_out before any check_in has ever occurred — impossible.
      return true;
    }
  }
  return false;
}

async function ensureManagerCanEdit(req: Request, res: Response, projectId: number): Promise<boolean> {
  if (req.user?.role === "admin") return true;
  if (req.user?.role !== "project_manager") {
    res.status(403).json({ error: "غير مصرح بهذه العملية" });
    return false;
  }
  const [member] = await db.select({ role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.userId, req.user!.userId),
    ));
  if (member?.role !== "project_manager") {
    res.status(403).json({ error: "غير مصرح بهذه العملية" });
    return false;
  }
  return true;
}

router.patch("/attendance/records/:recordId", requireAuth, async (req, res): Promise<void> => {
  const recordId = parseInt(Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId, 10);
  if (Number.isNaN(recordId)) { res.status(400).json({ error: "معرّف السجل غير صالح" }); return; }

  const existing = await loadRecordWithProject(recordId);
  if (!existing) { res.status(404).json({ error: "السجل غير موجود" }); return; }
  if (!(await ensureManagerCanEdit(req, res, existing.projectId))) return;

  const body = req.body ?? {};
  const reason = (body.reason ? String(body.reason) : "").trim();
  if (!reason) { res.status(400).json({ error: "سبب التعديل مطلوب" }); return; }

  const updates: Record<string, unknown> = {};
  let newRecordedAt: Date | undefined;
  if (body.recordedAt !== undefined) {
    const dt = new Date(String(body.recordedAt));
    if (Number.isNaN(dt.getTime())) { res.status(400).json({ error: "وقت غير صالح" }); return; }
    newRecordedAt = dt;
    updates.recordedAt = dt;
  }
  let newType: "check_in" | "check_out" | undefined;
  if (body.type !== undefined) {
    if (body.type !== "check_in" && body.type !== "check_out") {
      res.status(400).json({ error: "نوع غير صالح" }); return;
    }
    newType = body.type;
    updates.type = body.type;
  }
  if (body.notes !== undefined) {
    const t = String(body.notes).trim();
    updates.notes = t.length === 0 ? null : t;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "لا توجد تغييرات" });
    return;
  }

  // Capture old values *before* mutating, so the audit trail records the full
  // before/after diff (per task requirement to log old vs new values).
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (newType !== undefined && newType !== existing.type) {
    oldValues.type = existing.type;
    newValues.type = newType;
  }
  if (newRecordedAt !== undefined && newRecordedAt.getTime() !== new Date(existing.recordedAt).getTime()) {
    oldValues.recordedAt = existing.recordedAt;
    newValues.recordedAt = newRecordedAt;
  }
  if ("notes" in updates && updates.notes !== existing.notes) {
    oldValues.notes = existing.notes;
    newValues.notes = updates.notes;
  }

  // Re-validate: the resulting timeline must still produce valid sessions
  // (no two consecutive check_ins, no check_out before any check_in, etc).
  // We re-run the pairing logic with the proposed change applied.
  const allRecords = await db.select({
    id: attendanceRecordsTable.id,
    type: attendanceRecordsTable.type,
    recordedAt: attendanceRecordsTable.recordedAt,
  })
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, existing.userId),
      eq(attendanceRecordsTable.projectId, existing.projectId),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  const projected = allRecords
    .map((r) => r.id === recordId
      ? { id: r.id, type: newType ?? r.type, recordedAt: newRecordedAt ?? r.recordedAt }
      : r,
    )
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (isInvalidSequence(projected)) {
    res.status(409).json({ error: "التعديل سيُنتج تسلسل حضور/انصراف غير صالح" });
    return;
  }

  updates.editedAt = new Date();
  updates.editedByUserId = req.user!.userId;
  updates.editReason = reason;

  const [updated] = await db.update(attendanceRecordsTable)
    .set(updates)
    .where(eq(attendanceRecordsTable.id, recordId))
    .returning();

  logAudit({
    userId: req.user!.userId,
    userName: req.user?.phone,
    action: "update",
    entityType: "attendance",
    entityId: recordId,
    entityName: existing.type === "check_in" ? "حضور" : "انصراف",
    projectId: existing.projectId,
    projectName: existing.projectName,
    details: { old: oldValues, new: newValues, reason },
  });

  res.json(updated);
});

router.delete("/attendance/records/:recordId", requireAuth, async (req, res): Promise<void> => {
  const recordId = parseInt(Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId, 10);
  if (Number.isNaN(recordId)) { res.status(400).json({ error: "معرّف السجل غير صالح" }); return; }

  const existing = await loadRecordWithProject(recordId);
  if (!existing) { res.status(404).json({ error: "السجل غير موجود" }); return; }
  if (!(await ensureManagerCanEdit(req, res, existing.projectId))) return;

  const reason = (req.body && req.body.reason ? String(req.body.reason) : "").trim()
    || (typeof req.query.reason === "string" ? req.query.reason.trim() : "");
  if (!reason) { res.status(400).json({ error: "سبب الحذف مطلوب" }); return; }

  // Re-validate: removing this record must not produce an invalid timeline
  // (e.g. deleting a check_in that has a matching check_out would leave an
  // orphan check_out, breaking the sequence).
  const allRecords = await db.select({
    id: attendanceRecordsTable.id,
    type: attendanceRecordsTable.type,
    recordedAt: attendanceRecordsTable.recordedAt,
  })
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, existing.userId),
      eq(attendanceRecordsTable.projectId, existing.projectId),
    ))
    .orderBy(attendanceRecordsTable.recordedAt);

  const projected = allRecords
    .filter((r) => r.id !== recordId)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (isInvalidSequence(projected)) {
    res.status(409).json({ error: "الحذف سيُنتج تسلسل حضور/انصراف غير صالح" });
    return;
  }

  await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, recordId));

  // Best-effort cleanup of selfie file (cloud copy is not removed; orphan files
  // are tolerated and can be cleaned by a separate maintenance task).
  if (existing.selfieFilename) {
    const localPath = path.join(uploadsDir, existing.selfieFilename);
    fs.unlink(localPath, () => {});
  }

  logAudit({
    userId: req.user!.userId,
    userName: req.user?.phone,
    action: "delete",
    entityType: "attendance",
    entityId: recordId,
    entityName: existing.type === "check_in" ? "حضور" : "انصراف",
    projectId: existing.projectId,
    projectName: existing.projectName,
    details: { reason, type: existing.type, recordedAt: existing.recordedAt },
  });

  res.status(204).end();
});

// Authenticated photo delivery with project-level ACL.
// Accepts auth via Authorization: Bearer header OR ?token= query (so <img> can render).
router.get("/attendance/records/:recordId/photo", async (req: Request, res: Response): Promise<void> => {
  const headerToken = (() => {
    const h = req.headers.authorization;
    return h && h.startsWith("Bearer ") ? h.slice(7) : null;
  })();
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const token = headerToken || queryToken;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  const recordId = parseInt(Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId, 10);
  if (Number.isNaN(recordId)) {
    res.status(400).json({ error: "معرّف السجل غير صالح" });
    return;
  }

  const [record] = await db.select({
    id: attendanceRecordsTable.id,
    userId: attendanceRecordsTable.userId,
    projectId: attendanceRecordsTable.projectId,
    selfieFilename: attendanceRecordsTable.selfieFilename,
  }).from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, recordId));

  if (!record || !record.selfieFilename) {
    res.status(404).json({ error: "الصورة غير موجودة" });
    return;
  }

  // ACL: own record OR admin OR project_manager of this project
  let allowed = payload.userId === record.userId || payload.role === "admin";
  if (!allowed) {
    const [member] = await db.select({ role: projectMembersTable.role })
      .from(projectMembersTable)
      .where(and(
        eq(projectMembersTable.projectId, record.projectId),
        eq(projectMembersTable.userId, payload.userId),
      ));
    if (member?.role === "project_manager") allowed = true;
  }
  if (!allowed) {
    res.status(403).json({ error: "ليس لديك صلاحية لعرض هذه الصورة" });
    return;
  }

  const filename = record.selfieFilename;
  const localPath = path.join(uploadsDir, filename);
  res.setHeader("Cache-Control", "private, max-age=86400");

  if (fs.existsSync(localPath)) {
    res.sendFile(localPath);
    return;
  }

  try {
    const result = await streamFromCloud(filename);
    if (!result) {
      res.status(404).json({ error: "الصورة غير موجودة" });
      return;
    }
    if (result.contentType) res.setHeader("Content-Type", result.contentType);
    const readable = result.stream as NodeJS.ReadableStream;
    readable.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "خطأ في قراءة الملف" });
      else res.end();
    });
    readable.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "خطأ في قراءة الملف" });
  }
});

export default router;
