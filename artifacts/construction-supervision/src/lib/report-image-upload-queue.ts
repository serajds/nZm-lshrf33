import { fetchWithSession, processFetchResponse } from "@workspace/api-client-react";
import type { ReportImageProfile } from "@workspace/api-zod/image-policy";
import { getAuthToken } from "./auth-session";
import { blobToCanonicalBase64, prepareReportImage } from "./prepare-report-image";

export type ReportImageJob = {
  id: string; groupId: string; fileName: string; loaded: number; total: number;
  status: "queued" | "preparing" | "uploading" | "retrying" | "failed" | "cancelled";
  error?: string; attempt: number; order: number;
};
type Task = ReportImageJob & {
  file: File; clientKey: string; qualityProfile: ReportImageProfile; controller: AbortController;
  prepared?: { blob: Blob; encoding: "webp" | "jpeg" };
  settle: () => void;
};
type Options = {
  projectId: number;
  onChange: (job: ReportImageJob | null, id: string) => void;
  onSuccess: (job: ReportImageJob, url: string) => void;
};

/** A shared two-slot queue across groups, with per-item persistent retry keys. */
export function createReportImageUploadQueue({ projectId, onChange, onSuccess }: Options) {
  const waiting: Task[] = [], jobs = new Map<string, Task>(), activeIds = new Set<string>();
  let active = 0, disposed = false;
  const publish = (job: Task, patch: Partial<ReportImageJob>) => {
    Object.assign(job, patch);
    onChange({
      id: job.id, groupId: job.groupId, fileName: job.fileName, loaded: job.loaded,
      total: job.total, status: job.status, error: job.error, attempt: job.attempt, order: job.order,
    }, job.id);
  };
  const pump = () => {
    while (!disposed && active < 2 && waiting.length) {
      const job = waiting.shift()!;
      active++;
      activeIds.add(job.id);
      void run(job).finally(() => {
        active--; activeIds.delete(job.id);
        if (disposed) { jobs.delete(job.id); onChange(null, job.id); }
        pump();
      });
    }
  };
  const finish = (job: Task, patch: Partial<ReportImageJob>) => {
    publish(job, patch);
    job.settle();
  };
  async function statusCheck(job: Task): Promise<string | null> {
    const requestToken = getAuthToken();
    const response = await fetchWithSession(
      `/api/projects/${projectId}/reports/uploads/status?clientKey=${encodeURIComponent(job.clientKey)}`,
      { headers: requestToken ? { Authorization: `Bearer ${requestToken}` } : {}, signal: job.controller.signal },
    );
    await processFetchResponse(response.clone(), requestToken);
    if (!response.ok) return null;
    const value = await response.json() as { state?: string; file?: { fileUrl?: string } };
    return value.state === "ready" ? value.file?.fileUrl ?? null : null;
  }
  function send(job: Task, payload: { mode: "prepared" | "source"; clientKey: string; fileName: string; encoding: "webp" | "jpeg"; qualityProfile: ReportImageProfile; base64: string }) {
    return new Promise<{ response: Response; requestToken: string | null }>((resolve, reject) => {
      const requestToken = getAuthToken(), xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/reports/uploads`);
      xhr.timeout = 60_000;
      xhr.setRequestHeader("Content-Type", "text/plain");
      if (requestToken) xhr.setRequestHeader("Authorization", `Bearer ${requestToken}`);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) publish(job, { status: "uploading", loaded: event.loaded, total: event.total });
      };
      const abort = () => xhr.abort();
      job.controller.signal.addEventListener("abort", abort, { once: true });
      const detach = () => job.controller.signal.removeEventListener("abort", abort);
      xhr.onload = () => {
        detach();
        if (xhr.status < 200 || xhr.status > 599) { reject(new Error("network_error")); return; }
        const headers = new Headers();
        const renewed = xhr.getResponseHeader("X-Renewed-Token");
        if (renewed) headers.set("X-Renewed-Token", renewed);
        resolve({ response: new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers }), requestToken });
      };
      xhr.onerror = () => { detach(); reject(new Error("network_error")); };
      xhr.ontimeout = () => { detach(); reject(new Error("request_timeout")); };
      xhr.onabort = () => { detach(); reject(new DOMException("Aborted", "AbortError")); };
      let body = JSON.stringify(payload);
      xhr.send(body);
      body = "";
      payload.base64 = "";
    });
  }
  async function run(job: Task) {
    try {
      for (let attempt = 1; attempt <= 4; attempt++) {
        if (job.controller.signal.aborted || disposed) { finish(job, { status: "cancelled" }); return; }
        publish(job, { status: job.prepared ? "uploading" : "preparing", attempt, error: undefined });
        try {
          if (!job.prepared) {
            try {
              const prepared = await prepareReportImage(job.file, job.controller.signal, job.qualityProfile);
              job.prepared = { blob: prepared.blob, encoding: prepared.encoding };
            } catch (error) {
              if (job.controller.signal.aborted) throw error;
              if (error instanceof Error && error.message === "image_pixel_limit") throw error;
              job.prepared = { blob: job.file, encoding: "webp" };
            }
          }
          const base64 = await blobToCanonicalBase64(job.prepared.blob, job.controller.signal);
          publish(job, { status: "uploading", loaded: 0, total: job.prepared.blob.size });
          const sent = await send(job, {
            mode: job.prepared.blob === job.file ? "source" : "prepared", clientKey: job.clientKey,
            fileName: job.file.name, encoding: job.prepared.encoding, qualityProfile: job.qualityProfile, base64,
          });
          await processFetchResponse(sent.response.clone(), sent.requestToken);
          if (sent.response.ok) {
            const response = await sent.response.json() as { fileUrl?: string };
            if (!response.fileUrl) throw new Error("invalid_upload_response");
            onSuccess(job, response.fileUrl);
            jobs.delete(job.id); onChange(null, job.id); job.settle(); return;
          }
          if (![408, 429, 500, 502, 503, 504].includes(sent.response.status)) {
            const body = await sent.response.json().catch(() => ({})) as { error?: string };
            finish(job, { status: "failed", error: body.error ?? `HTTP ${sent.response.status}` }); return;
          }
        } catch (error) {
          if (job.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            finish(job, { status: "cancelled" }); return;
          }
          if (error instanceof Error && error.message === "image_pixel_limit") {
            finish(job, { status: "failed", error: "تتجاوز الصورة الحد الآمن للدقة" }); return;
          }
        }
        const recovered = await statusCheck(job).catch(() => null);
        if (recovered) {
          onSuccess(job, recovered); jobs.delete(job.id); onChange(null, job.id); job.settle(); return;
        }
        if (attempt < 4) {
          publish(job, { status: "retrying", loaded: 0 });
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => { detach(); resolve(); }, 500 * 2 ** (attempt - 1));
            const abort = () => { window.clearTimeout(timer); detach(); reject(new DOMException("Aborted", "AbortError")); };
            const detach = () => job.controller.signal.removeEventListener("abort", abort);
            job.controller.signal.addEventListener("abort", abort, { once: true });
          }).catch(() => {});
        }
      }
      finish(job, { status: "failed", error: "تعذر تأكيد الرفع بعد المحاولات؛ أعد المحاولة" });
    } catch (error) {
      finish(job, { status: job.controller.signal.aborted ? "cancelled" : "failed", error: String(error) });
    }
  }
  const enqueue = (job: Task) => { waiting.push(job); pump(); };
  return {
    add(file: File, groupId: string, order: number, qualityProfile: ReportImageProfile = "report") {
      let settle!: () => void;
      const promise = new Promise<void>(resolve => { settle = resolve; });
      const job: Task = {
        id: crypto.randomUUID(), groupId, fileName: file.name, file, clientKey: crypto.randomUUID(),
        qualityProfile, order, loaded: 0, total: file.size, status: "queued", attempt: 0,
        controller: new AbortController(), settle,
      };
      jobs.set(job.id, job); publish(job, {}); enqueue(job);
      return { id: job.id, promise };
    },
    retry(id: string) {
      const job = jobs.get(id);
      if (!job || !["failed", "cancelled"].includes(job.status) || activeIds.has(id) || disposed) return;
      job.controller = new AbortController();
      let settle!: () => void;
      new Promise<void>(resolve => { settle = resolve; }).catch(() => {});
      job.settle = settle;
      publish(job, { status: "queued", loaded: 0, error: undefined });
      enqueue(job);
    },
    discard(id: string) {
      const job = jobs.get(id);
      if (!job || !["failed", "cancelled"].includes(job.status)) return;
      jobs.delete(id); onChange(null, id);
    },
    cancel(id: string) { jobs.get(id)?.controller.abort(); },
    cancelGroup(groupId: string) { for (const job of jobs.values()) if (job.groupId === groupId) job.controller.abort(); },
    cancelAll() { for (const job of jobs.values()) job.controller.abort(); },
    dispose() {
      disposed = true; waiting.length = 0;
      for (const job of jobs.values()) {
        job.controller.abort();
        if (!activeIds.has(job.id)) { onChange(null, job.id); job.settle(); }
      }
    },
  };
}
