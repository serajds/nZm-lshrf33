import { useState } from "react";
import { Download, Share, Plus, MoreVertical, Monitor, Smartphone } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function InstallButton({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { isInstalled, platform, hasNativePrompt, promptInstall } = usePwaInstall();
  const [showHelp, setShowHelp] = useState(false);

  if (isInstalled) return null;

  const onClick = async () => {
    if (hasNativePrompt) {
      const result = await promptInstall();
      if (result === "dismissed" || result === "unavailable") {
        setShowHelp(true);
      }
    } else {
      setShowHelp(true);
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        title="تثبيت التطبيق على جهازك"
        className={
          variant === "compact"
            ? "flex items-center justify-center rounded-lg p-2 transition-colors text-primary hover:bg-primary/10"
            : "flex items-center gap-1.5 text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 font-medium transition-colors shrink-0"
        }
      >
        <Download className="h-4 w-4" />
        {variant === "full" && (
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        )}
      </button>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تثبيت التطبيق على جهازك</DialogTitle>
            <DialogDescription>
              اتبع الخطوات التالية حسب نوع جهازك ومتصفحك:
            </DialogDescription>
          </DialogHeader>

          {platform === "ios" && <IosInstructions />}
          {platform === "android" && <AndroidInstructions />}
          {platform === "desktop-chrome" && <DesktopChromeInstructions />}
          {platform === "firefox" && <FirefoxNotice />}
          {platform === "safari-desktop" && <SafariDesktopNotice />}
          {platform === "other" && <GenericInstructions />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
        {n}
      </span>
      <span className="flex items-center gap-1.5 flex-wrap leading-6">{children}</span>
    </li>
  );
}

function IosInstructions() {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Smartphone className="h-4 w-4" /> iPhone / iPad — Safari
      </div>
      <ol className="space-y-3 text-sm">
        <Step n="١">
          اضغط زر المشاركة <Share className="h-4 w-4 inline text-blue-600" /> في شريط Safari السفلي
        </Step>
        <Step n="٢">
          اختر "إضافة إلى الشاشة الرئيسية" <Plus className="h-4 w-4 inline" />
        </Step>
        <Step n="٣">اضغط "إضافة" في الأعلى</Step>
      </ol>
      <p className="text-xs text-muted-foreground pt-2 border-t">
        يجب فتح الموقع داخل تطبيق Safari (وليس داخل واتساب أو أي تطبيق آخر).
      </p>
    </>
  );
}

function AndroidInstructions() {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Smartphone className="h-4 w-4" /> Android — Chrome
      </div>
      <ol className="space-y-3 text-sm">
        <Step n="١">
          اضغط زر القائمة (ثلاث نقاط) <MoreVertical className="h-4 w-4 inline" /> أعلى يمين Chrome
        </Step>
        <Step n="٢">اختر "تثبيت التطبيق" أو "Install app" أو "إضافة إلى الشاشة الرئيسية"</Step>
        <Step n="٣">اضغط "تثبيت"</Step>
      </ol>
      <p className="text-xs text-muted-foreground pt-2 border-t">
        إذا لم يظهر الخيار، تأكد من تحديث Chrome، وأن تفتح الموقع داخل Chrome مباشرة.
      </p>
    </>
  );
}

function DesktopChromeInstructions() {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Monitor className="h-4 w-4" /> الكمبيوتر — Chrome / Edge / Brave
      </div>
      <ol className="space-y-3 text-sm">
        <Step n="١">
          ابحث عن أيقونة التثبيت <Download className="h-4 w-4 inline" /> على يسار شريط العنوان
        </Step>
        <Step n="٢">أو افتح القائمة (ثلاث نقاط) واختر "تثبيت إدارة الإشراف..."</Step>
        <Step n="٣">اضغط "تثبيت"</Step>
      </ol>
      <p className="text-xs text-muted-foreground pt-2 border-t">
        إذا لم تظهر الأيقونة، تنقّل قليلاً داخل التطبيق ثم أعد فتح القائمة. بعض المتصفحات تطلب
        تفاعلاً قبل إتاحة التثبيت.
      </p>
    </>
  );
}

function FirefoxNotice() {
  return (
    <div className="space-y-2 text-sm">
      <p>متصفح Firefox للكمبيوتر لا يدعم تثبيت تطبيقات الويب حالياً.</p>
      <p className="text-muted-foreground">
        لتثبيت التطبيق، يرجى فتحه في متصفح <strong>Chrome</strong> أو <strong>Edge</strong> أو
        <strong> Brave</strong>.
      </p>
    </div>
  );
}

function SafariDesktopNotice() {
  return (
    <div className="space-y-2 text-sm">
      <p>متصفح Safari على macOS لا يدعم تثبيت تطبيقات الويب.</p>
      <p className="text-muted-foreground">
        يمكنك إضافة الموقع إلى Dock من قائمة File → Add to Dock، أو فتحه في
        <strong> Chrome</strong> / <strong>Edge</strong> للتثبيت الكامل.
      </p>
    </div>
  );
}

function GenericInstructions() {
  return (
    <div className="space-y-2 text-sm">
      <p>افتح هذا الموقع في متصفح يدعم تطبيقات الويب التقدمية:</p>
      <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
        <li>Chrome (الكمبيوتر / الأندرويد)</li>
        <li>Edge (الكمبيوتر / الأندرويد)</li>
        <li>Safari (iPhone / iPad)</li>
      </ul>
    </div>
  );
}
