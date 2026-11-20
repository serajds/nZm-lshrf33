import {
  applyRenewedToken,
  clearCredentialForToken,
  getCurrentCredential,
} from "@/lib/session";
import { shouldExpireSession } from "@/lib/session-guard";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  auth?: boolean;
  body?: unknown;
  textPlain?: boolean;
}

function getApiBaseUrl(): string {
  const configuredApi = process.env.EXPO_PUBLIC_API_URL?.trim();
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  let base = configuredApi || configuredDomain;

  if (!base) {
    throw new ApiError(
      "عنوان الخادم غير مهيأ. افتح التطبيق من مساحة العمل أو أضف عنوان API في إعدادات البناء.",
      0,
    );
  }

  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, "");

  if (configuredApi) {
    return base.endsWith("/api") ? base : `${base}/api`;
  }
  return `${base}/api`;
}

function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${suffix}`;
}

function extractServerError(body: unknown, fallback: string): { message: string; code?: string } {
  if (!body || typeof body !== "object") return { message: fallback };
  const data = body as { error?: unknown; code?: unknown };
  return {
    message: typeof data.error === "string" && data.error.trim() ? data.error : fallback,
    code: typeof data.code === "string" ? data.code : undefined,
  };
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true, body, textPlain = false, headers: inputHeaders, ...requestInit } = options;
  const sentToken = auth ? getCurrentCredential()?.token ?? null : null;
  const headers = new Headers(inputHeaders);
  headers.set("Accept", "application/json");
  if (sentToken) headers.set("Authorization", `Bearer ${sentToken}`);

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    headers.set("Content-Type", textPlain ? "text/plain;charset=UTF-8" : "application/json");
    requestBody = textPlain ? JSON.stringify(body) : JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...requestInit,
      headers,
      body: requestBody,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.",
      0,
    );
  }

  const renewedToken = response.headers.get("X-Renewed-Token");
  if (renewedToken && sentToken) {
    await applyRenewedToken(renewedToken, sentToken);
  }

  if (
    shouldExpireSession(
      response.status,
      sentToken,
      getCurrentCredential()?.token ?? null,
    )
  ) {
    await clearCredentialForToken(sentToken);
  }

  const raw = response.status === 204 ? "" : await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const fallback = response.status === 401
      ? "انتهت صلاحية الجلسة. سجّل الدخول من جديد."
      : response.status === 403
        ? "ليس لديك صلاحية لتنفيذ هذا الإجراء."
        : "تعذّر إكمال الطلب. أعد المحاولة.";
    const detail = extractServerError(parsed, fallback);
    throw new ApiError(detail.message, response.status, detail.code);
  }

  return parsed as T;
}
