const TZ = "Africa/Tripoli";

export function fmtLibyaDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-LY", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtLibyaTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtLibyaDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayLibyaISO(): string {
  return fmtLibyaDate(new Date());
}

export function withAuthToken(url: string): string {
  if (!url) return url;
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("المتصفح لا يدعم تحديد الموقع الجغرافي"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      err => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("لم يتم منح إذن الوصول إلى الموقع الجغرافي"));
        else if (err.code === err.POSITION_UNAVAILABLE) reject(new Error("تعذّر الحصول على الموقع الحالي"));
        else if (err.code === err.TIMEOUT) reject(new Error("انتهت مهلة الحصول على الموقع"));
        else reject(new Error("خطأ في تحديد الموقع: " + err.message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
