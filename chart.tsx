import { useEffect, useState } from "react";
import { Download, X, Share, Plus } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const DISMISS_KEY = "pwa_install_dismissed_at";
const SNOOZE_DAYS = 7;

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return days < SNOOZE_DAYS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * Floating bottom banner that proactively suggests installing the app as a
 * PWA. It appears automatically when:
 *
 *   - The app is NOT already installed (display-mode != standalone), AND
 *   - Either the browser fired `beforeinstallprompt` (Chrome / Edge / Brave
 *     on Android & desktop), OR the device is iOS (Safari has no native
 *     prompt, so we show an instructional banner with the share-sheet hint),
 *     AND
 *   - The user has not dismissed it in the last 7 days.
 *
 * On accept: triggers the native browser prompt (Chromium) or opens the
 * platform-specific instructions dialog (iOS).
 */
export function InstallPromptBanner() {
  const { isInstalled, platform, hasNativePrompt, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState<boolean>(true); // start hidden
  const [showHelp, setShowHelp] = useState(false);

  // Re-evaluate snooze on mount and whenever availability flips on.
  useEffect(() => {
    setDismissed(isSnoozed());
  }, [hasNativePrompt, isInstalled]);

  if (isInstalled || dismissed) return null;

  // For iOS we always offer the banner (since beforeinstallprompt never
  // fires on Safari) — the CTA opens the share-sheet instructions.
  // For Chromium we wait until the browser actually allows installing.
  const canShow = hasNativePrompt || platform === "ios";
  if (!canShow) return null;

  const onInstall = async () => {
    if (hasNativePrompt) {
      const result = await promptInstall();
      if (result === "accepted") {
        // appinstalled handler in the hook will hide everything; nothing else to do.
        return;
      }
      // Dismissed/unavailable → fall back to instructions so the user has a way.
      setShowHelp(true);
    } else {
      // iOS path
      setShowHelp(true);
    }
  };

  const onDismiss = () => {
    snooze();
    setDismissed(true);
  };

  return (
    <>
      <div
        dir="rtl"
        className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
        role="dialog"
        aria-label="تثبيت التطبيق"
      >
        <div className="mx-auto max-w-md pointer-events-auto rounded-2xl bg-card border shadow-2xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-primary/10 text-primary shrink-0">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">
              ثبّت التطبيق على جهازك
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {platform === "ios"
                ? "افتح القائمة في Safari لإضافته للشاشة الرئيسية"
                : "وصول أسرع، يعمل بدون متصفح، ويدعم العمل دون اتصال"}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onInstall}
              className="text-xs sm:text-sm font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {platform === "ios" ? "كيف؟" : "تثبيت"}
            </button>
            <button
              onClick={onDismiss}
              aria-label="ليس الآن"
              title="ليس الآن"
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تثبيت التطبيق على iPhone / iPad</DialogTitle>
            <DialogDescription>
              متصفح Safari لا يدعم رسالة التثبيت التلقائية، لكن خطوتين فقط:
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
                ١
              </span>
              <span className="leading-6">
                اضغط زر المشاركة <Share className="h-4 w-4 inline text-blue-600" /> في شريط Safari السفلي
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
                ٢
              </span>
              <span className="leading-6">
                اختر "إضافة إلى الشاشة الرئيسية" <Plus className="h-4 w-4 inline" />
              </span>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            يجب فتح الموقع داخل تطبيق Safari (وليس داخل واتساب أو متصفح آخر).
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
