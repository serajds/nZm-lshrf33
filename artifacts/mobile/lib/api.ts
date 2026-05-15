import * as Crypto from "expo-crypto";

const RAW_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
export const BASE_URL = RAW_DOMAIN
  ? (RAW_DOMAIN.startsWith("http") ? RAW_DOMAIN : `https://${RAW_DOMAIN}`)
  : "";

let _tokenGetter: () => string | null = () => null;
export function setTokenGetter(g: () => string | null): void {
  _tokenGetter = g;
}
export function getToken(): string | null { return _tokenGetter(); }

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
  const token = _tokenGetter();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  // Send JSON bodies as text/plain to bypass Replit Autoscale's edge CSRF
  // check, which rejects application/json POSTs missing Origin/Referer
  // (React Native strips those headers on Android). The server is configured
  // to parse text/plain bodies as JSON.
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "text/plain");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");

  let res: Response;
  try { res = await fetch(url, { ...init, headers }); }
  catch { throw new ApiError("تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.", 0, null); }

  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
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
  const fd = new FormData();
  fd.append("selfie", { uri: p.selfieUri, name: `selfie-${Date.now()}.jpg`, type: "image/jpeg" } as unknown as Blob);
  fd.append("latitude", String(p.latitude));
  fd.append("longitude", String(p.longitude));
  if (p.accuracy != null && Number.isFinite(p.accuracy)) fd.append("accuracy", String(p.accuracy));
  fd.append("clientId", p.clientId ?? Crypto.randomUUID());

  const path = `/api/attendance/projects/${p.projectId}/${p.type === "check_in" ? "check-in" : "check-out"}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (BASE_URL) {
    headers.Origin = BASE_URL;
    headers.Referer = `${BASE_URL}/`;
  }
  const token = _tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try { res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body: fd as unknown as BodyInit }); }
  catch { throw new ApiError("تعذّر إرسال الطلب. تأكد من اتصالك بالإنترنت.", 0, null); }
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
export const apiUnregisterExpoPushToken = (token: string) =>
  request<{ ok: true }>("/api/push/expo/unregister", { method: "POST", body: JSON.stringify({ token }) });
