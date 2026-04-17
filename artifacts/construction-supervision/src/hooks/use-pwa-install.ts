import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type Platform =
  | "ios"
  | "android"
  | "desktop-chrome"
  | "firefox"
  | "safari-desktop"
  | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const isIPad =
    /iPad|Macintosh/.test(ua) &&
    typeof document !== "undefined" &&
    "ontouchend" in document;
  const isIOS = /iPhone|iPod/.test(ua) || isIPad;
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome|Edg|OPR|Brave/.test(ua)) return "desktop-chrome";
  if (/Safari/.test(ua)) return "safari-desktop";
  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as any).standalone === true;
  return Boolean(mq || iosStandalone);
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(detectStandalone());
  const [platform] = useState<Platform>(detectPlatform());

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    const mq = window.matchMedia("(display-mode: standalone)");
    const onModeChange = () => setIsInstalled(detectStandalone());

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    mq.addEventListener?.("change", onModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onModeChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return "unavailable" as const;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome;
  }, [deferredPrompt]);

  return {
    isInstalled,
    platform,
    hasNativePrompt: !!deferredPrompt,
    promptInstall,
  };
}
