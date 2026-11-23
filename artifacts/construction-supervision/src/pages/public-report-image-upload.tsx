import { useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES,
  REPORT_IMAGE_MAX_BYTES,
  isJpgReportImageUpload,
} from "@workspace/api-zod";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type PublicShare = {
  category: string;
  expiresAt: string;
  status: "pending" | "uploading" | "completed";
  periodStart: string;
  periodEnd: string;
  uploadedCount: number;
  maxImages: number;
};

type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  currentFile: number;
  totalFiles: number;
  uploadedFiles: number;
  fileName: string;
};

function formatReportDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-LY-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ar-LY-u-nu-latn").format(value);
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return {};
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function uploadImage(
  token: string,
  file: File,
  imageBase64: string,
  onProgress: (ratio: number) => void,
): Promise<{ uploadedCount?: number; maxImages?: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}/public/report-image-shares/upload`);
    request.setRequestHeader("Content-Type", "text/plain");
    request.timeout = 180_000;
    request.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () => {
      let data: Record<string, unknown> = {};
      if ((request.getResponseHeader("content-type") ?? "").includes("application/json")) {
        try {
          data = JSON.parse(request.responseText) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(data as { uploadedCount?: number; maxImages?: number });
      } else {
        reject(new Error(typeof data.error === "string" ? data.error : "تعذّر رفع الصورة. أعد المحاولة."));
      }
    };
    request.onerror = () => reject(new Error("تعذّر الاتصال أثناء رفع الصورة. تحقق من الاتصال ثم أعد المحاولة."));
    request.ontimeout = () => reject(new Error("استغرق رفع الصورة وقتاً طويلاً. أعد المحاولة."));
    request.onabort = () => reject(new Error("تم إيقاف رفع الصورة."));
    request.send(JSON.stringify({
      token,
      fileName: file.name,
      mimeType: file.type,
      imageBase64,
    }));
  });
}

export default function PublicReportImageUpload() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [share, setShare] = useState<PublicShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const remainingImages = share
    ? Math.max(0, share.maxImages - share.uploadedCount)
    : 0;

  useEffect(() => {
    document.title = "رفع صور القسم";
    if (!token) {
      setError("الرابط غير صالح أو لا يحتوي على رمز الرفع.");
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/public/report-image-shares?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async response => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "الرابط غير صالح أو انتهت صلاحيته.");
        setShare(data as PublicShare);
      })
      .catch(err => setError(err instanceof Error ? err.message : "تعذّر فتح رابط الرفع."))
      .finally(() => setLoading(false));
  }, [token]);

  const refreshShare = async () => {
    try {
      const response = await fetch(`${API_BASE}/public/report-image-shares?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await readJson(response);
      if (response.ok) setShare(data as PublicShare);
    } catch {
      // Keep the last confirmed count visible if the refresh cannot connect.
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!token || files.length === 0 || uploading || completed) return;
    setError("");
    setNotice("");

    const validationErrors: string[] = [];
    const acceptedFiles = files.filter(file => {
      if (!isJpgReportImageUpload(file.name, file.type)) {
        validationErrors.push(`يُسمح فقط بالصور ذات الامتداد JPG: ${file.name}`);
        return false;
      }
      if (file.size <= 0 || file.size > REPORT_IMAGE_MAX_BYTES) {
        validationErrors.push(`يجب ألا يتجاوز حجم الصورة 5 ميغابايت: ${file.name}`);
        return false;
      }
      return true;
    });
    if (acceptedFiles.length > remainingImages) {
      validationErrors.push(`يمكنك اختيار ${formatCount(remainingImages)} صورة إضافية فقط؛ الحد الذي اختاره منشئ الرابط ${formatCount(share?.maxImages ?? REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES)} صورة.`);
    }
    const validFiles = acceptedFiles.slice(0, remainingImages);
    setError(validationErrors.join("\n"));
    if (validFiles.length === 0) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    const totalBytes = validFiles.reduce((total, file) => total + file.size, 0);
    let loadedBytes = 0;
    let uploadedCount = 0;
    let requestFailed = false;
    setUploading(true);
    setUploadProgress({
      loadedBytes: 0,
      totalBytes,
      currentFile: 1,
      totalFiles: validFiles.length,
      uploadedFiles: 0,
      fileName: validFiles[0].name,
    });
    for (const [index, file] of validFiles.entries()) {
      try {
        setUploadProgress({
          loadedBytes,
          totalBytes,
          currentFile: index + 1,
          totalFiles: validFiles.length,
          uploadedFiles: uploadedCount,
          fileName: file.name,
        });
        const imageBase64 = await fileToBase64(file);
        const result = await uploadImage(token, file, imageBase64, ratio => {
          setUploadProgress({
            loadedBytes: Math.min(totalBytes, loadedBytes + Math.floor(file.size * ratio)),
            totalBytes,
            currentFile: index + 1,
            totalFiles: validFiles.length,
            uploadedFiles: uploadedCount,
            fileName: file.name,
          });
        });
        loadedBytes += file.size;
        uploadedCount += 1;
        setShare(current => current ? {
          ...current,
          status: "uploading",
          uploadedCount: result.uploadedCount ?? current.uploadedCount + 1,
          maxImages: result.maxImages ?? current.maxImages,
        } : current);
        setUploadProgress({
          loadedBytes,
          totalBytes,
          currentFile: index + 1,
          totalFiles: validFiles.length,
          uploadedFiles: uploadedCount,
          fileName: file.name,
        });
      } catch (err) {
        requestFailed = true;
        validationErrors.push(err instanceof Error ? err.message : "تعذّر رفع الصورة. أعد المحاولة.");
        setError(validationErrors.join("\n"));
      }
    }
    if (requestFailed) await refreshShare();
    setUploading(false);
    if (uploadedCount > 0) {
      setNotice(`تم رفع ${formatCount(uploadedCount)} صورة عبر هذا الطلب. مهم: اضغط «إنهاء الرفع» بعد إضافة جميع الصور لتأكيد اكتمال القسم.`);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploading || completing || completed || remainingImages === 0) return;
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = uploading || completing || completed || remainingImages === 0 ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    if (uploading || completing || completed || remainingImages === 0) return;
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const finishUpload = async () => {
    if (!token || completing || uploading) return;
    setCompleting(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/public/report-image-shares/complete`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ token }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "تعذّر إنهاء رفع الصور.");
      setCompleted(true);
      setShare(current => current ? { ...current, status: "completed" } : current);
      setNotice("تم إنهاء رفع الصور بنجاح.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر إنهاء رفع الصور.");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="rounded-xl bg-slate-800 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white/10 p-2"><Camera className="h-6 w-6" /></div>
            <div>
              <h1 className="text-xl font-bold">رفع صور القسم</h1>
              <p className="mt-1 text-sm text-slate-200">أضف الصور المطلوبة ثم أنهِ الرفع.</p>
            </div>
          </div>
        </header>

        {loading ? (
          <Card><CardContent className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> جارٍ التحقق من الرابط...
          </CardContent></Card>
        ) : error && !share ? (
          <Card><CardContent role="alert" className="p-6 text-center text-sm text-destructive">{error}</CardContent></Card>
        ) : share ? (
          <>
            <Card>
              <CardContent className="space-y-5 p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-800"><ImagePlus className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">القسم المسموح برفع الصور إليه</div>
                    <div className="mt-1 text-lg font-semibold">{share.category}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-slate-50 p-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">الفترة من</div>
                    <div className="mt-1 font-semibold tabular-nums" dir="auto">{formatReportDate(share.periodStart)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">الفترة إلى</div>
                    <div className="mt-1 font-semibold tabular-nums" dir="auto">{formatReportDate(share.periodEnd)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-center text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">الحد الأقصى</div>
                    <div className="mt-1 font-bold tabular-nums">{formatCount(share.maxImages)} صورة</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">المرفوع عبر الرابط</div>
                    <div className="mt-1 font-bold tabular-nums">{formatCount(share.uploadedCount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">المتبقي</div>
                    <div className="mt-1 font-bold tabular-nums">{formatCount(remainingImages)}</div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white px-4 py-3 text-sm">
                  {completed ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" /> مكتمل
                    </span>
                  ) : uploading ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-blue-800">
                      <Loader2 className="h-4 w-4 animate-spin" /> جارٍ الرفع
                    </span>
                  ) : share.status === "uploading" ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-blue-800">جارٍ الرفع — يمكنك إضافة صور أخرى أو إنهاء الرفع.</span>
                  ) : (
                    <span className="font-semibold text-amber-800">بانتظار الرفع</span>
                  )}
                  {!completed && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ينتهي الرابط في {new Date(share.expiresAt).toLocaleDateString("ar-SA-u-nu-latn")}
                    </p>
                  )}
                </div>

                {!completed && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".jpg,image/jpeg"
                      multiple
                      className="sr-only"
                      onChange={event => void uploadFiles(Array.from(event.currentTarget.files ?? []))}
                      disabled={uploading || completing || remainingImages === 0}
                    />
                    {uploadProgress && (
                      <div className="space-y-2 rounded-lg border bg-white px-4 py-3" aria-live="polite">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-semibold">
                            {uploading ? `رفع الصورة ${uploadProgress.currentFile} من ${uploadProgress.totalFiles}` : "تقدم رفع الصور"}
                          </span>
                          <span className="font-bold tabular-nums">
                            {Math.floor((uploadProgress.loadedBytes / uploadProgress.totalBytes) * 100)}٪
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label="تقدم رفع الصور"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.floor((uploadProgress.loadedBytes / uploadProgress.totalBytes) * 100)}
                          className="h-3 overflow-hidden rounded-full bg-slate-200"
                        >
                          <div
                            className="h-full rounded-full bg-blue-700 transition-[width] duration-150"
                            style={{ width: `${Math.floor((uploadProgress.loadedBytes / uploadProgress.totalBytes) * 100)}%` }}
                          />
                        </div>
                        <p className="truncate text-xs text-muted-foreground" dir="auto">{uploadProgress.fileName}</p>
                      </div>
                    )}
                    <div
                      role="region"
                      aria-label="منطقة إسقاط الصور"
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors ${
                        dragActive
                          ? "border-blue-700 bg-blue-50"
                          : "border-slate-300 bg-white"
                      } ${uploading || completing ? "opacity-60" : ""}`}
                    >
                      <UploadCloud className={`mx-auto h-8 w-8 ${dragActive ? "text-blue-800" : "text-slate-500"}`} />
                      <p className="mt-2 font-semibold">
                        {dragActive ? "أفلت الصور هنا" : "اسحب الصور وأفلتها هنا"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">أو اختر الصور من جهازك باستخدام الزر أدناه.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button type="button" variant="outline" className="h-11 gap-2"
                        disabled={uploading || completing || remainingImages === 0} onClick={() => fileInput.current?.click()}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                        {uploading ? "جارٍ رفع الصور..." : remainingImages === 0 ? "اكتمل الحد الأقصى" : "اختيار الصور"}
                      </Button>
                      <Button type="button" className="h-11 gap-2" disabled={uploading || completing}
                        onClick={() => void finishUpload()}>
                        {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        إنهاء الرفع
                      </Button>
                    </div>
                    <p className="text-xs leading-6 text-muted-foreground">
                      صور JPG فقط، بحد أقصى {formatCount(share.maxImages)} صورة لهذا الرابط و5 ميغابايت للصورة.
                    </p>
                  </>
                )}

                {notice && <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-3 text-sm font-semibold leading-6 text-amber-950">{notice}</p>}
                {error && <p role="alert" className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </main>
  );
}
