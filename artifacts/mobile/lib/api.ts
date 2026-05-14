import * as Crypto from "expo-crypto";

const RAW_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
const BASE_URL = RAW_DOMAIN
  ? (RAW_DOMAIN.startsWith("http") ? RAW_DOMAIN : `https://${RAW_DOMAIN}`)
  : "";

let _tokenGetter: () => string | null = () => null;
export function setTokenGetter(g: () => string | null): void {
  _tokenGetter = g;
}

export interface ApiUser {
  id: number;
  phone: string;
  fullName: string;
  role: "admin" | "project_manager" | "engineer" | "owner" | "contractor";
}

export interface LoginResponse {
  user: ApiUser;
  token: string;
}

export interface ApiProject {
  id: number;
  name: string;
  location: string;
  status: string;
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
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    throw new ApiError("تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.", 0, null);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (data && typeof data === "object" && "error" in data) {
      msg = String((data as Record<string, unknown>).error);
    } else if (typeof data === "string" && data.length < 300) {
      msg = data;
    }
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export async function apiLogin(phone: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
}

export async function apiGetMe(): Promise<ApiUser> {
  return request<ApiUser>("/api/auth/me");
}

export async function apiListProjects(): Promise<ApiProject[]> {
  return request<ApiProject[]>("/api/projects");
}

export async function apiMyAttendanceStatus(): Promise<MyAttendanceProjectStatus[]> {
  return request<MyAttendanceProjectStatus[]>("/api/attendance/my-status");
}

export interface AttendanceCheckParams {
  projectId: number;
  type: "check_in" | "check_out";
  selfieUri: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export async function apiAttendanceCheck(p: AttendanceCheckParams): Promise<unknown> {
  const fd = new FormData();
  // React Native FormData accepts { uri, name, type } objects.
  // React Native FormData accepts { uri, name, type } objects.
  fd.append("selfie", {
    uri: p.selfieUri,
    name: `selfie-${Date.now()}.jpg`,
    type: "image/jpeg",
  } as unknown as Blob);
  fd.append("latitude", String(p.latitude));
  fd.append("longitude", String(p.longitude));
  if (p.accuracy != null && Number.isFinite(p.accuracy)) {
    fd.append("accuracy", String(p.accuracy));
  }
  fd.append("clientId", Crypto.randomUUID());

  const path = `/api/attendance/projects/${p.projectId}/${p.type === "check_in" ? "check-in" : "check-out"}`;
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = _tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Do NOT set Content-Type — let fetch set the multipart boundary.

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: fd as unknown as BodyInit });
  } catch {
    throw new ApiError("تعذّر إرسال الطلب. تأكد من اتصالك بالإنترنت.", 0, null);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (data && typeof data === "object" && "error" in data) {
      msg = String((data as Record<string, unknown>).error);
    }
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
