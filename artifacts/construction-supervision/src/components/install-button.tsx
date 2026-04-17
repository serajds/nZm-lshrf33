import { useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Variant = "compact" | "full";

export function InstallButton({ variant = "full" }: { variant?: Variant }) {
  const { canInstall, isIOS, hasNativePrompt, promptInstall } = usePwaInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (!canInstall) return null;

  const onClick = async () => {
    if (hasNativePrompt) {
      await promptInstall();
    } else if (isIOS) {
      setShowIosHelp(true);
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

      <Dialog open={showIosHelp} onOpenChange={setShowIosHelp}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تثبيت التطبيق على iPhone / iPad</DialogTitle>
            <DialogDescription>
              نظام iOS لا يدعم التثبيت التلقائي، يمكنك إضافة التطبيق يدوياً عبر
              متصفح Safari بالخطوات التالية:
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
                ١
              </span>
              <span className="flex items-center gap-1.5 flex-wrap">
                اضغط زر المشاركة
                <Share className="h-4 w-4 inline text-blue-600" />
                في شريط أدوات Safari
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
                ٢
              </span>
              <span className="flex items-center gap-1.5 flex-wrap">
                اختر "إضافة إلى الشاشة الرئيسية"
                <Plus className="h-4 w-4 inline" />
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs shrink-0">
                ٣
              </span>
              <span>اضغط "إضافة" — وسيظهر التطبيق على شاشتك الرئيسية.</span>
            </li>
          </ol>
          <div className="text-xs text-muted-foreground pt-2 border-t">
            ملاحظة: تأكد من فتح الموقع في Safari وليس داخل تطبيق آخر.
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
