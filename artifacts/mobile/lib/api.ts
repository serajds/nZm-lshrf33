import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

// Production custom domain. Used as a hard fallback when EXPO_PUBLIC_DOMAIN
// is missing or accidentally points to a Replit dev/preview host (which has
// edge CSRF that React Native cannot satisfy). This guarantees release
// builds and OTA updates always talk to the real backend.
const PRODUCTION_DOMAIN = "portal.almadaco.ly";
const RAW_DOMAIN_ENV = (process.env.EXPO_PUBLIC_DOMAIN ?? "").trim();
const RAW_DOMAIN =
  !RAW_DOMAIN_ENV || /\.replit\.(dev|app)$/i.test(RAW_DOMAIN_ENV) || /picard\./i.test(RAW_DOMAIN_ENV)
    ? PRODUCTION_DOMAIN
    : RAW_DOMAIN_ENV;
export const BASE_URL = RAW_DOMAIN.startsWith("http") ? RAW_DOMAIN : `https://${RAW_DOMAIN}`;

let _tokenGetter: () => string | null = () => null;
export function setTokenGetter(g: () => string | null): void {
  _tokenGetter = g;
}
export function getToken(): string | null { return _tokenGetter(); }

// Rolling-session support. The server renews the bearer token when it has
// less than half its lifetime left and returns the fresh one in the
// X-Renewed-Token response header. We hand it to the saver so the client can
// persist it transparently — without this, an active user's token would still
// expire after its original 7-day TTL and they'd be kicked out.
const RENEWED_TOKEN_HEADER = "X-Renewed-Token";

let _tokenSaver: (token: string, tokenUsed: string) => void = () => {};
export function setTokenSaver(s: (token: string, tokenUsed: string) => void): void {
  _tokenSaver = s;
}

// Invoked whenever a response comes back 401 (token missing/invalid/expired).
// Central place to wire "session expired" behaviour (clear credentials +
// redirect to login) instead of leaving each screen stuck on an error.
let _unauthorizedHandler: (tokenUsed: string) => void = () => {};
export function setUnauthorizedHandler(h: (tokenUsed: string) => void): void {
  _unauthorizedHandler = h;
}

let _confirmingUnauthorized: { token: string; pending: Promise<boolean> } | null = null;
async function confirmUnauthorized(tokenUsed: string): Promise<boolean> {
  if (tokenUsed !== _tokenGetter()) return false;
  if (_confirmingUnauthorized?.token === tokenUsed) return _confirmingUnauthorized.pending;
  const pending = (async () => { try {
    const res = await fetchWithDeadline(`${BASE_URL}/api/auth/me`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenUsed}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (tokenUsed !== _tokenGetter()) return false;
    const renewed = res.headers.get(RENEWED_TOKEN_HEADER);
    if (renewed) {
      try { _tokenSaver(renewed, tokenUsed); } catch { /* best-effort */ }
      return false;
    }
    if (res.status === 401 && tokenUsed === _tokenGetter()) {
      try { _unauthorizedHandler(tokenUsed); } catch { /* never break caller flow */ }
      return true;
    }
  } catch {
    // A transport failure cannot confirm that credentials are invalid.
  }
  return false;
  })();
  _confirmingUnauthorized = { token: tokenUsed, pending };
  try { return await pending; }
  finally { if (_confirmingUnauthorized?.pending === pending) _confirmingUnauthorized = null; }
}

// Bounded identity reads only. Never automatically retry a possibly committed
// write, and retain credentials when this deadline expires.
async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(async response => {
        // Identity responses are small. Include body transfer in the deadline,
        // not just receipt of headers; a stalled body must not block startup.
        const body = await response.text();
        return new Response(body, { status: response.status, headers: response.headers });
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("انتهت مهلة التحقق من الاتصال"));
        }, timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

// Run the renewed-token + unauthorized pipeline against any fetch Response,
// so every request path (JSON, multipart upload, offline-queue flush)
// participates in rolling renewal and the centralized 401 redirect.
//
// `tokenUsed` is the bearer token that was attached to *this* request. We only
// act when it still matches the current token, which guards against two
// hazards: (1) a stale in-flight request (old token) resolving after the user
// re-logged in must not overwrite the fresh token nor force a logout, and
// (2) a request with no session token (e.g. the login call itself returning
// 401 for bad credentials) must not trigger the "session expired" flow.
function processResponse(res: Response, tokenUsed: string | null): void {
  if (!tokenUsed || tokenUsed !== _tokenGetter()) return;
  const renewed = res.headers.get(RENEWED_TOKEN_HEADER);
  if (renewed) {
    try { _tokenSaver(renewed, tokenUsed); } catch { /* best-effort */ }
    // A response carrying a valid replacement token is not evidence that the
    // session represented by tokenUsed has expired.
    return;
  }
  if (res.status === 401 && tokenUsed === _tokenGetter()) {
    // Revalidate before clearing credentials. This makes the result independent
    // of whether a concurrent renewed-token response or this 401 arrives first.
    void confirmUnauthorized(tokenUsed);
  }
}

export interface ApiUser {
  id: number;
  phone: string;
  fullName: string;
  role: "admin" | "project_manager" | "engineer" | "owner" | "contractor";
  incompleteProfile?: boolean;
}

export interface LoginResponse { user: ApiUser; token: string; }

export interface ApiProject {
  id: number;
  name: string;
  location: string;
  status: string;
  contractor?: string;
  ownerEntity?: string;
  supervisorEntity?: string;
  overallProgress?: number;
  startDate?: string | null;
  expectedEndDate?: string | null;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
  siteRadiusMeters?: number | null;
  reportDisplayMode?: "type_and_number" | "period_only";
}

export interface MyAttendanceProjectStatus {
  projectId: number;
  projectName: string;
  hasSiteLocation: boolean;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
  currentlyCheckedIn: boolean;
  lastRecord: {
    id: number;
    type: "check_in" | "check_out";
    recordedAt: string;
    outOfRange: boolean;
  } | null;
}

export interface ApiReport {
  id: number;
  projectId: number;
  reportNumber: number;
  type: string;
  reportDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  workDescription: string | null;
  progressPercentage: number | null;
  technicalNotes: string | null;
  recommendations: string | null;
  status: "draft" | "approved";
  createdById: number | null;
  approvedAt: string | null;
  imageUrls?: string[] | null;
}

export interface ApiActivity {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  groupId: number | null;
  externalSourceGroupId?: number | null;
  externalSource?: {
    available: boolean;
    groupId: number;
    projectName: string | null;
    groupName: string | null;
    linkCode?: string | null;
  } | null;
  weight: number | null;
  actualProgress: number | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
}

export interface ApiActivityGroup {
  id: number;
  projectId: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface ApiFormTemplate {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  fields: Array<{ id: string; label: string; type: string; required?: boolean; options?: string[] }>;
}

export interface ApiFormSubmission {
  id: number;
  templateId: number;
  projectId: number;
  reportDate: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ApiCompany {
  id: number;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
}

export interface ApiAdminUser {
  id: number;
  phone: string;
  fullName: string;
  role: string;
  createdAt: string;
  companies: { companyId: number; companyName: string }[];
  projects: { projectId: number; projectName: string; role: string }[];
  projectMembershipsCount: number;
  incompleteProfile?: boolean;
}

export interface ApiAuditEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  projectId: number | null;
  projectName: string | null;
  details: unknown;
  createdAt: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
    if (data && typeof data === "object" && "code" in data) {
      this.code = String((data as Record<string, unknown>).code);
    }
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(init.headers);
  const publicAuthRequest = /^\/api\/auth\/(?:login|register)\/?$/.test(path);
  const token = publicAuthRequest ? null : _tokenGetter();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  // Send JSON bodies as text/plain to bypass Replit Autoscale's edge CSRF
  // check, which rejects application/json POSTs missing Origin/Referer
  // (React Native strips those headers on Android). The server is configured
  // to parse text/plain bodies as JSON.
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "text/plain");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");

  let res: Response;
  try {
    const read = !init.method || init.method.toUpperCase() === "GET";
    res = await (read
      ? fetchWithDeadline(url, { ...init, headers, cache: "no-store" }, path === "/api/auth/me" ? 12000 : 30000)
      : fetch(url, { ...init, headers, cache: "no-store" }));
  }
  catch { throw new ApiError("تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.", 0, null); }

  // Bootstrap awaits the confirmation itself below; do not launch a second
  // fire-and-forget probe that can finish before the error is parsed.
  if (!(path === "/api/auth/me" && res.status === 401 && !res.headers.get(RENEWED_TOKEN_HEADER))) {
    processResponse(res, token);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    if (path === "/api/auth/me" && res.status === 401 && token && !await confirmUnauthorized(token)) {
      throw new ApiError("تعذّر تأكيد حالة الجلسة. أعد المحاولة عند استقرار الاتصال.", 0, null);
    }
    let msg = `HTTP ${res.status}`;
    if (data && typeof data === "object" && "error" in data) msg = String((data as Record<string, unknown>).error);
    else if (typeof data === "string" && data.length < 300) msg = data;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

// Auth
export const apiLogin = (phone: string, password: string) =>
  request<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) });
export const apiGetMe = () => request<ApiUser>("/api/auth/me");

// Projects
export const apiListProjects = () => request<ApiProject[]>("/api/projects");
export const apiGetProject = (id: number) => request<ApiProject>(`/api/projects/${id}`);
export const apiMyProjectPermissions = (projectId: number) =>
  request<{ role: string; projectRole: string; tabPermissions: Record<string, { view: boolean; edit: boolean }>; canEditAll: boolean }>(`/api/projects/${projectId}/my-permissions`);

// Attendance
export const apiMyAttendanceStatus = () => request<MyAttendanceProjectStatus[]>("/api/attendance/my-status");

export interface AttendanceCheckParams {
  projectId: number;
  type: "check_in" | "check_out";
  selfieUri: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  clientId?: string;
}

export async function apiAttendanceCheck(p: AttendanceCheckParams): Promise<unknown> {
  // Send the selfie as base64 inside a JSON body with Content-Type: text/plain.
  // This is the same edge-safe transport the rest of the mobile JSON calls use:
  // Replit's Autoscale edge requires Origin/Referer for application/json (and
  // can reject bare multipart uploads), but text/plain is always allowed
  // through. The backend parses text/plain bodies as JSON.
  let selfieBase64: string;
  try {
    selfieBase64 = await FileSystem.readAsStringAsync(p.selfieUri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    throw new ApiError("تعذّر قراءة الصورة.", 0, null);
  }

  const path = `/api/attendance/projects/${p.projectId}/${p.type === "check_in" ? "check-in" : "check-out"}`;
  const body = JSON.stringify({
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: p.accuracy != null && Number.isFinite(p.accuracy) ? p.accuracy : undefined,
    clientId: p.clientId ?? Crypto.randomUUID(),
    selfieBase64,
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "text/plain",
    "X-Requested-With": "XMLHttpRequest",
  };
  const token = _tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try { res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body }); }
  catch { throw new ApiError("تعذّر إرسال الطلب. تأكد من اتصالك بالإنترنت.", 0, null); }
  processResponse(res, token);
  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (data && typeof data === "object" && "error" in data) msg = String((data as Record<string, unknown>).error);
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

// Reports
export const apiListReports = (projectId: number) =>
  request<ApiReport[]>(`/api/projects/${projectId}/reports`);
export const apiGetReport = (projectId: number, id: number) =>
  request<ApiReport>(`/api/projects/${projectId}/reports/${id}`);
export const apiCreateReport = (projectId: number, body: Partial<ApiReport>) =>
  request<ApiReport>(`/api/projects/${projectId}/reports`, { method: "POST", body: JSON.stringify(body) });
export const apiUpdateReport = (projectId: number, id: number, body: Partial<ApiReport>) =>
  request<ApiReport>(`/api/projects/${projectId}/reports/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const apiSetReportStatus = (projectId: number, id: number, status: "draft" | "approved") =>
  request<ApiReport>(`/api/projects/${projectId}/reports/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
export const apiDeleteReport = (projectId: number, id: number) =>
  request<void>(`/api/projects/${projectId}/reports/${id}`, { method: "DELETE" });

// Activities
export const apiListActivities = (projectId: number) =>
  request<ApiActivity[]>(`/api/projects/${projectId}/activities`);
export const apiListActivityGroups = (projectId: number) =>
  request<ApiActivityGroup[]>(`/api/projects/${projectId}/activity-groups`);

// Forms
export const apiListFormTemplates = (projectId: number) =>
  request<ApiFormTemplate[]>(`/api/projects/${projectId}/form-templates`);
export const apiGetFormTemplate = (projectId: number, templateId: number) =>
  request<ApiFormTemplate>(`/api/projects/${projectId}/form-templates/${templateId}`);
export const apiListFormSubmissions = (projectId: number, templateId?: number) => {
  const q = templateId ? `?templateId=${templateId}` : "";
  return request<ApiFormSubmission[]>(`/api/projects/${projectId}/form-submissions${q}`);
};
export const apiCreateFormSubmission = (projectId: number, body: { templateId: number; reportDate: string; data: Record<string, unknown> }) =>
  request<ApiFormSubmission>(`/api/projects/${projectId}/form-submissions`, { method: "POST", body: JSON.stringify(body) });

// Companies
export const apiListCompanies = () => request<ApiCompany[]>("/api/companies");

// Users (admin)
export const apiListUsers = () => request<ApiAdminUser[]>("/api/users");

// Audit log (admin)
export const apiAuditLog = (limit = 100) =>
  request<ApiAuditEntry[]>(`/api/audit-log?limit=${limit}`);

// Project members (admin / PM)
export interface ApiProjectMember {
  id: number;
  projectId: number;
  userId: number;
  userName: string;
  userPhone: string;
  userRole: string;
  role: string;
  companyNames: string[];
  assignedGroupIds: number[];
  isContractorLocked: boolean;
}
export const apiListProjectMembers = (projectId: number) =>
  request<ApiProjectMember[]>(`/api/projects/${projectId}/members`);
export const apiListEligibleUsers = (projectId: number) =>
  request<ApiAdminUser[]>(`/api/projects/${projectId}/eligible-users`);
export const apiAddProjectMember = (projectId: number, body: { userId: number; role: string; assignedGroupIds?: number[] }) =>
  request<ApiProjectMember>(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify(body) });
export const apiRemoveProjectMember = (projectId: number, memberId: number) =>
  request<void>(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });

// Suspensions
export interface ApiSuspension {
  id: number; projectId: number; type: string; title: string;
  startDate: string; endDate: string; calendarDays: number;
  reason: string | null; documentRef: string | null; approvedBy: string | null;
  notes: string | null; datesShifted: boolean; createdAt: string;
}
export const apiListSuspensions = (projectId: number) =>
  request<ApiSuspension[]>(`/api/projects/${projectId}/suspensions`);
export const apiCreateSuspension = (projectId: number, body: Omit<ApiSuspension, "id" | "projectId" | "calendarDays" | "datesShifted" | "createdAt"> & { shiftDates?: boolean }) =>
  request<ApiSuspension>(`/api/projects/${projectId}/suspensions`, { method: "POST", body: JSON.stringify(body) });
export const apiDeleteSuspension = (projectId: number, id: number) =>
  request<void>(`/api/projects/${projectId}/suspensions/${id}`, { method: "DELETE" });

// Extensions
export interface ApiExtension {
  id: number; projectId: number; extensionDate: string; daysAdded: number;
  reason: string | null; documentRef: string | null; approvedBy: string | null;
  notes: string | null; newEndDate: string | null; createdAt: string;
}
export const apiListExtensions = (projectId: number) =>
  request<ApiExtension[]>(`/api/projects/${projectId}/extensions`);
export const apiCreateExtension = (projectId: number, body: { extensionDate: string; daysAdded: number; reason?: string | null; documentRef?: string | null; approvedBy?: string | null; notes?: string | null }) =>
  request<ApiExtension>(`/api/projects/${projectId}/extensions`, { method: "POST", body: JSON.stringify(body) });
export const apiDeleteExtension = (projectId: number, id: number) =>
  request<void>(`/api/projects/${projectId}/extensions/${id}`, { method: "DELETE" });

// Report comments
export interface ApiReportComment {
  id: number;
  reportId: number;
  userId: number;
  userName: string | null;
  body: string;
  createdAt: string;
}
export const apiListReportComments = (projectId: number, reportId: number) =>
  request<ApiReportComment[]>(`/api/projects/${projectId}/reports/${reportId}/comments`);
export const apiCreateReportComment = (projectId: number, reportId: number, body: string) =>
  request<ApiReportComment>(`/api/projects/${projectId}/reports/${reportId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
export const apiDeleteReportComment = (projectId: number, reportId: number, id: number) =>
  request<void>(`/api/projects/${projectId}/reports/${reportId}/comments/${id}`, { method: "DELETE" });

// Push
export const apiRegisterExpoPushToken = (token: string, platform: string, deviceName: string) =>
  request<{ ok: true }>("/api/push/expo/register", { method: "POST", body: JSON.stringify({ token, platform, deviceName }) });
export const apiUnregisterExpoPushToken = (pushToken: string, sessionToken?: string | null) =>
  request<{ ok: true }>("/api/push/expo/unregister", {
    method: "POST",
    body: JSON.stringify({ token: pushToken }),
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
  });
