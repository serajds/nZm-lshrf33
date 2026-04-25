import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { attendanceRecordsTable, projectsTable, usersTable, projectMembersTable, userCompaniesTable } from "@workspace/db";
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { requireAuth, requireProjectAccess } from "../middlewares/auth";
import { haversineDistanceMeters } from "../lib/geo";
import { logAudit } from "../lib/audit";
import { uploadToCloud, streamFromCloud } from "../lib/fileStorage";
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
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

async function compressSelfie(filePath: string): Promise<{ size: number; filename: string }> {
  const baseName = path.basename(filePath, path.extname(filePath));
  const compressedName = baseName + ".jpg";
  const compressedPath = path.join(path.dirname(filePath), compressedName);

  await sharp(filePath)
    .rotate()
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(compressedPath);

  if (compressedPath !== filePath) fs.unlinkSync(filePath);
  const stats = fs.statSync(compressedPath);
  return { size: stats.size, filename: compressedName };
}

const router: IRouter = Router();

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

  const projectIds = await getProjectIdsForUser(userId, role);
  if (projectIds.length === 0) { res.json([]); return; }

  // Latest record per project for this user
  const records = await db.select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, userId),
      inArray(attendanceRecordsTable.projectId, projectIds),
    ))
    .orderBy(desc(attendanceRecordsTable.recordedAt));

  const latestPerProject = new Map<number, typeof records[number]>();
  for (const r of records) {
    if (!latestPerProject.has(r.projectId)) latestPerProject.set(r.projectId, r);
  }

  const projects = await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds));

  const out = projects.map(p => {
    const last = latestPerProject.get(p.id) || null;
    return {
      projectId: p.id,
      projectName: p.name,
      hasSiteLocation: p.siteLatitude != null && p.siteLongitude != null,
      siteLatitude: p.siteLatitude,
      siteLongitude: p.siteLongitude,
      siteRadiusMeters: p.siteRadiusMeters,
      currentlyCheckedIn: last?.type === "check_in",
      lastRecord: last,
    };
  });

  res.json(out);
});

// Get my own attendance history
router.get("/attendance/my-history", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);

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
    .where(eq(attendanceRecordsTable.userId, userId))
    .orderBy(desc(attendanceRecordsTable.recordedAt))
    .limit(limit);

  res.json(records);
});

// Check-in
router.post(
  "/attendance/projects/:projectId/check-in",
  requireProjectAccess("projectId"),
  upload.single("selfie"),
  async (req, res): Promise<void> => {
    await recordAttendance(req, res, "check_in");
  },
);

// Check-out
router.post(
  "/attendance/projects/:projectId/check-out",
  requireProjectAccess("projectId"),
  upload.single("selfie"),
  async (req, res): Promise<void> => {
    await recordAttendance(req, res, "check_out");
  },
);

async function recordAttendance(req: any, res: any, type: "check_in" | "check_out") {
  const userId = req.user!.userId;
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  if (!req.file) { res.status(400).json({ error: "صورة السيلفي مطلوبة" }); return; }

  const lat = req.body.latitude !== undefined ? parseFloat(String(req.body.latitude)) : NaN;
  const lng = req.body.longitude !== undefined ? parseFloat(String(req.body.longitude)) : NaN;
  const acc = req.body.accuracy !== undefined ? parseFloat(String(req.body.accuracy)) : NaN;
  const notes = (req.body.notes ? String(req.body.notes) : "").trim() || null;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: "الموقع الجغرافي مطلوب" });
    return;
  }

  // Last record check (server-side state validation)
  const [last] = await db.select()
    .from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, userId),
      eq(attendanceRecordsTable.projectId, projectId),
    ))
    .orderBy(desc(attendanceRecordsTable.recordedAt))
    .limit(1);

  if (type === "check_in" && last?.type === "check_in") {
    fs.unlink(req.file.path, () => {});
    res.status(409).json({ error: "أنت مسجل حضور بالفعل في هذا المشروع. سجّل انصراف أولاً." });
    return;
  }
  if (type === "check_out" && last?.type !== "check_in") {
    fs.unlink(req.file.path, () => {});
    res.status(409).json({ error: "لا يمكن تسجيل انصراف بدون حضور سابق." });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    fs.unlink(req.file.path, () => {});
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  let distance: number | null = null;
  let outOfRange = false;
  if (project.siteLatitude != null && project.siteLongitude != null) {
    distance = haversineDistanceMeters(lat, lng, project.siteLatitude, project.siteLongitude);
    const radius = project.siteRadiusMeters ?? 200;
    outOfRange = distance > radius;
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

  res.status(201).json(record);
}

// Active (currently checked-in) for a project
router.get(
  "/attendance/projects/:projectId/active",
  requireProjectAccess("projectId"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(raw, 10);

    if (req.user?.role === "owner") {
      const [{ count }] = await db.select({ count: sql<number>`COUNT(DISTINCT user_id)::int` })
        .from(sql`(
          SELECT DISTINCT ON (user_id) user_id, type
          FROM attendance_records
          WHERE project_id = ${projectId}
          ORDER BY user_id, recorded_at DESC
        ) latest`)
        .where(sql`latest.type = 'check_in'`);
      res.json({ activeCount: count ?? 0, members: [] });
      return;
    }

    // Latest record per user for this project; keep ones whose latest = check_in
    const rows = await db.execute(sql`
      SELECT
        ar.id, ar.user_id, ar.recorded_at, ar.latitude, ar.longitude,
        ar.accuracy_meters, ar.distance_meters, ar.out_of_range, ar.selfie_url, ar.notes,
        u.full_name, u.phone, u.role AS user_role
      FROM (
        SELECT DISTINCT ON (user_id)
          id, user_id, recorded_at, latitude, longitude, accuracy_meters,
          distance_meters, out_of_range, selfie_url, notes, type
        FROM attendance_records
        WHERE project_id = ${projectId}
        ORDER BY user_id, recorded_at DESC
      ) ar
      JOIN users u ON u.id = ar.user_id
      WHERE ar.type = 'check_in'
      ORDER BY ar.recorded_at DESC
    `);

    const members = (rows.rows as any[]).map(r => ({
      recordId: r.id,
      userId: r.user_id,
      fullName: r.full_name,
      phone: r.phone,
      userRole: r.user_role,
      checkedInAt: r.recorded_at,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracyMeters: r.accuracy_meters,
      distanceMeters: r.distance_meters,
      outOfRange: r.out_of_range,
      selfieUrl: r.selfie_url,
      notes: r.notes,
    }));

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

    if (req.user?.role === "owner") {
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

    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : null;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : null;

    const conditions = [
      eq(attendanceRecordsTable.projectId, projectId),
      eq(attendanceRecordsTable.userId, targetUserId),
    ];
    if (dateFrom) conditions.push(gte(attendanceRecordsTable.recordedAt, libyaDayStartUtc(dateFrom)));
    if (dateTo) conditions.push(lte(attendanceRecordsTable.recordedAt, libyaDayEndUtc(dateTo)));

    const records = await db.select()
      .from(attendanceRecordsTable)
      .where(and(...conditions))
      .orderBy(attendanceRecordsTable.recordedAt);

    // Group by Libya local date (GMT+2)
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" });
    const byDay = new Map<string, { checkIn: Date | null; checkOut: Date | null }>();

    for (const r of records) {
      const day = fmt.format(new Date(r.recordedAt));
      let entry = byDay.get(day);
      if (!entry) { entry = { checkIn: null, checkOut: null }; byDay.set(day, entry); }
      if (r.type === "check_in" && !entry.checkIn) entry.checkIn = new Date(r.recordedAt);
      if (r.type === "check_out") entry.checkOut = new Date(r.recordedAt);
    }

    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        checkIn: v.checkIn ? v.checkIn.toISOString() : null,
        checkOut: v.checkOut ? v.checkOut.toISOString() : null,
      }));

    const [employee] = await db.select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));

    const [project] = await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    res.json({
      project,
      employee,
      dateFrom,
      dateTo,
      days,
    });
  },
);

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
