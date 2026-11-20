import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

const SLOW_DATA_NOTICE_DELAY_MS = 10_000;

export function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [slow, setSlow] = useState(false);
  const fetching = useIsFetching({ type: "active" });
  const hasActiveFetch = fetching > 0;
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!online || !hasActiveFetch) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), SLOW_DATA_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasActiveFetch, online]);
  if (online && !slow) return null;
  return <div role="status" dir="rtl" className="mb-4 rounded-lg border bg-muted p-3 text-sm">
    {!online
      ? "لا يوجد اتصال بالشبكة. البيانات الظاهرة هي آخر قراءة متاحة، والتحميلات المتوقفة تُستأنف عند عودة الاتصال."
      : "ما زال تحميل بعض البيانات جارياً. نحتفظ بآخر بيانات متاحة حتى يكتمل التحديث."}
  </div>;
}
