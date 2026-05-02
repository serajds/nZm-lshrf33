import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  isPushSupported,
  getPermission,
  getCurrentSubscription,
  enablePushNotifications,
  disablePushNotifications,
} from "@/lib/push-client";

/**
 * A small bell icon that shows the current push-notification state and
 * lets the user enable / disable browser push notifications. Hidden in
 * environments where the API is not supported (e.g. older Safari).
 *
 * State machine:
 *   - "unsupported": never render anything
 *   - "denied":      render bell-off (clicking explains they must change browser settings)
 *   - "granted" + subscribed: bell-ring, click → unsubscribe
 *   - "granted" + not subscribed OR "default": bell, click → subscribe
 */
export function NotificationToggle() {
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok = isPushSupported();
    setSupported(ok);
    if (!ok) return;
    setPermission(getPermission());
    getCurrentSubscription().then((s) => setSubscribed(!!s)).catch(() => {});
  }, []);

  if (!supported) return null;

  async function handleEnable() {
    setBusy(true);
    try {
      const ok = await enablePushNotifications();
      setPermission(getPermission());
      setSubscribed(ok);
      if (ok) {
        toast({ title: "تم تفعيل الإشعارات" });
      } else {
        toast({
          variant: "destructive",
          title: "تم رفض الإذن",
          description: "يمكنك السماح بالإشعارات من إعدادات المتصفح.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "فشل تفعيل الإشعارات";
      toast({ variant: "destructive", title: "تعذّر التفعيل", description: msg });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      await disablePushNotifications();
      setSubscribed(false);
      toast({ title: "تم إيقاف الإشعارات" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الإيقاف";
      toast({ variant: "destructive", title: "خطأ", description: msg });
    } finally {
      setBusy(false);
    }
  }

  // Choose icon for the trigger based on the current state.
  const Icon = busy
    ? Loader2
    : permission === "denied"
      ? BellOff
      : subscribed
        ? BellRing
        : Bell;

  const iconClass = busy ? "h-4 w-4 animate-spin" : "h-4 w-4";

  // States with distinct interactions:
  //  - denied → just show a tooltip-like menu telling them to fix it in browser
  //  - default/granted+!subscribed → menu offering "تفعيل"
  //  - granted+subscribed → menu offering "إيقاف"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="إشعارات"
          data-testid="button-notifications"
        >
          <Icon className={iconClass} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>الإشعارات الفورية</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {permission === "denied" ? (
          <div className="px-2 py-2 text-xs text-muted-foreground leading-relaxed">
            تم رفض إذن الإشعارات في المتصفح. لتفعيلها، اسمح بالإشعارات من شريط
            الموقع أو إعدادات الموقع في المتصفح.
          </div>
        ) : subscribed ? (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              ستصلك إشعارات الحضور والتمديدات والتوقّفات على هذا الجهاز.
            </div>
            <DropdownMenuItem onClick={handleDisable} disabled={busy} data-testid="menuitem-disable-push">
              <BellOff className="h-4 w-4 ml-2" />
              <span>إيقاف الإشعارات</span>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground leading-relaxed">
              فعّل الإشعارات لتتلقّى تنبيهات الحضور والتمديدات والتوقّفات حتى وأنت
              خارج التطبيق.
            </div>
            <DropdownMenuItem onClick={handleEnable} disabled={busy} data-testid="menuitem-enable-push">
              <BellRing className="h-4 w-4 ml-2" />
              <span>تفعيل الإشعارات</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
