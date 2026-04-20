import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eye, X, BellOff } from "lucide-react";

interface SummaryWidget {
  id: string;
  label: string;
  templateId: number | null;
  fieldId: string | null;
  value?: any;
  fieldLabel?: string;
  reportDate?: string;
  submittedAt?: string;
}

interface Props {
  projectId: number;
  widgets: SummaryWidget[];
  enabled: boolean;
}

const AUTO_CLOSE_MS = 10_000;
const TICK_MS = 100;

function stableSerialize(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${k}:${stableSerialize(obj[k])}`).join(",")}}`;
}

function computeFingerprint(widgets: SummaryWidget[]): string {
  if (!widgets.length) return "empty";
  const parts = widgets.map((w) => [
    w.id ?? "",
    w.fieldId ?? "",
    w.templateId ?? "",
    stableSerialize(w.value),
    w.reportDate ?? "",
    w.submittedAt ?? "",
  ].join("|"));
  return `${widgets.length}::${parts.join("##")}`;
}

function dismissalKey(projectId: number) {
  return `project-quick-view-dismissed:${projectId}`;
}

export function ProjectQuickViewDialog({ projectId, widgets, enabled }: Props) {
  const [open, setOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState(AUTO_CLOSE_MS);
  const [paused, setPaused] = useState(false);
  const triggeredRef = useRef(false);

  const fingerprint = useMemo(() => computeFingerprint(widgets), [widgets]);
  const hasWidgets = widgets.length > 0;

  // Reset trigger when navigating between projects without unmounting.
  useEffect(() => {
    triggeredRef.current = false;
    setOpen(false);
    setRemainingMs(AUTO_CLOSE_MS);
    setPaused(false);
  }, [projectId]);

  // Trigger open exactly once per page entry, after widgets load.
  useEffect(() => {
    if (!enabled) return;
    if (triggeredRef.current) return;
    if (!hasWidgets) return;

    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(dismissalKey(projectId));
    } catch {
      // ignore (private mode etc.)
    }
    if (dismissed && dismissed === fingerprint) {
      triggeredRef.current = true;
      return;
    }
    triggeredRef.current = true;
    setOpen(true);
    setRemainingMs(AUTO_CLOSE_MS);
  }, [enabled, hasWidgets, fingerprint, projectId]);

  // Countdown timer with pause-on-hover/focus.
  useEffect(() => {
    if (!open) return;
    if (paused) return;
    const id = window.setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - TICK_MS;
        if (next <= 0) {
          window.clearInterval(id);
          setOpen(false);
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [open, paused]);

  // Reset countdown when reopening (defensive).
  useEffect(() => {
    if (open) setRemainingMs(AUTO_CLOSE_MS);
  }, [open]);

  const handleDismissUntilChanged = () => {
    try {
      localStorage.setItem(dismissalKey(projectId), fingerprint);
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const progressPct = Math.max(0, Math.min(100, (remainingMs / AUTO_CLOSE_MS) * 100));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          dir="rtl"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(e) => {
            // Only unpause if focus left the dialog entirely.
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setPaused(false);
            }
          }}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[calc(100vw-1.5rem)] max-w-xl",
            "translate-x-[-50%] translate-y-[-50%]",
            "border bg-background shadow-xl rounded-lg overflow-hidden",
            "max-h-[88vh] flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 p-4 border-b bg-muted/40">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0">
                <Eye className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold leading-tight">
                  نظرة سريعة
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">
                  آخر مستجدات أدوات الملخص
                </DialogPrimitive.Description>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground",
                  paused && "opacity-50",
                )}
                aria-live="polite"
              >
                {paused ? "متوقف" : `${remainingSec} ث`}
              </span>
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Countdown bar */}
          <div className="h-1 w-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full bg-primary transition-[width] ease-linear",
                paused && "bg-muted-foreground/40",
              )}
              style={{
                width: `${progressPct}%`,
                transitionDuration: paused ? "0ms" : `${TICK_MS}ms`,
              }}
            />
          </div>

          {/* Body */}
          <div className="p-4 overflow-y-auto flex-1">
            <div className="grid gap-3 sm:grid-cols-2">
              {widgets.map((w) => (
                <Card key={w.id} className="border-2 border-dashed border-primary/20">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      {w.fieldLabel || w.label || "بدون عنوان"}
                    </p>
                    {w.value != null ? (
                      <div className="space-y-0.5">
                        {String(w.value).split("\n").map((line, i) => (
                          <p key={i} className="text-sm font-semibold leading-relaxed break-words">
                            {line}
                          </p>
                        ))}
                        {w.reportDate && (
                          <p className="text-[10px] text-muted-foreground mt-1.5" dir="ltr">
                            {w.reportDate}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">لا توجد بيانات</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 border-t bg-muted/30 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleDismissUntilChanged}
            >
              <BellOff className="h-3.5 w-3.5" />
              لا تُظهر مجدداً حتى تتغير
            </Button>
            <DialogPrimitive.Close asChild>
              <Button size="sm" className="gap-1.5">
                حسناً
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
