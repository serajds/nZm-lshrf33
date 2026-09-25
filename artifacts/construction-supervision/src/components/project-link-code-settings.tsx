import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithSession, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mounted only inside an administrator's edit dialog. Never reads from the project list. */
export function ProjectLinkCodeSettings({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<{ linkCode: string | null }>({
    queryKey: ["admin-project-link-code", projectId],
    queryFn: async () => {
      const response = await fetchWithSession(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error("تعذر تحميل رمز الربط");
      const project = await response.json();
      return { linkCode: typeof project.linkCode === "string" ? project.linkCode : null };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const value = draft ?? data?.linkCode ?? "";
  const changed = draft !== null && draft.trim() !== (data?.linkCode ?? "");

  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ linkCode: draft!.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "تعذر حفظ الرمز");
      const nextCode = typeof body?.linkCode === "string" ? body.linkCode : draft!.trim() || null;
      queryClient.setQueryData(["admin-project-link-code", projectId], { linkCode: nextCode });
      // The project detail cache may have been prefetched before this setting changed.
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ الرمز");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5" aria-labelledby="project-link-code-heading">
      <h3 id="project-link-code-heading" className="text-sm font-semibold">رمز ربط المشروع الجانبي</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        اختياري. عيّن رمزاً فريداً لهذا المشروع وشاركه فقط مع مسؤول المشروع الذي سيستورد بنوده إلى إحدى مجموعاته. لا يظهر الرمز في قائمة المشاريع. مسح الرمز يمنع إنشاء روابط جديدة به.
      </p>
      {isLoading ? (
        <div className="mt-4 h-11 animate-pulse rounded-md bg-muted" aria-label="جارٍ تحميل رمز الربط" />
      ) : isError ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
          تعذر تحميل الرمز. <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}><RefreshCw className="ml-1 h-4 w-4" />إعادة المحاولة</Button>
        </div>
      ) : (
        <>
          <label htmlFor="project-link-code" className="mt-4 block text-sm font-medium">رمز هذا المشروع</label>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <Input id="project-link-code" type={revealed ? "text" : "password"} dir="ltr" autoComplete="off" spellCheck={false} value={value} onChange={(event) => { setDraft(event.target.value); setSaved(false); setCopied(false); }} placeholder="اتركه فارغاً لتعطيل الربط" className="h-11 min-w-0 flex-1 basis-40 text-left" disabled={saving} aria-invalid={!!error} aria-describedby="project-link-code-help" />
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => setRevealed(!revealed)} aria-label={revealed ? "إخفاء الرمز" : "إظهار الرمز"} aria-pressed={revealed}>
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" disabled={!value.trim()} aria-label="نسخ رمز المشروع" onClick={async () => {
              try { await navigator.clipboard.writeText(value.trim()); setCopied(true); setError(""); }
              catch { setError("تعذر النسخ. يمكنك إظهار الرمز ونسخه يدوياً."); }
            }}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p id="project-link-code-help" className="mt-2 text-xs text-muted-foreground">حفظ الرمز منفصل عن حفظ بقية بيانات المشروع.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" className="min-h-11" disabled={!changed || saving} onClick={() => void save()}>
              {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              {saving ? "جارٍ الحفظ..." : "حفظ الرمز"}
            </Button>
            {value && <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => { setDraft(""); setSaved(false); }}>مسح الرمز</Button>}
            {saved && <span role="status" className="text-xs text-emerald-700">تم حفظ الرمز</span>}
            {copied && <span role="status" className="text-xs text-muted-foreground">تم النسخ</span>}
          </div>
          {error && <p role="alert" className="mt-2 break-words text-sm text-destructive">{error}</p>}
        </>
      )}
    </section>
  );
}