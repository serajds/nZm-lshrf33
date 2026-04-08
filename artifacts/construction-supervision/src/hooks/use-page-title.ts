import { useEffect } from "react";

const APP_NAME = "إدارة الإشراف والمتابعة";

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${APP_NAME} - ${title}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
