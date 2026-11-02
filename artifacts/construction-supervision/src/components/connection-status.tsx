import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

export function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [slow, setSlow] = useState(false);
  const fetching = useIsFetching();
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
    if (!fetching) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [fetching > 0]);
  if (online && !slow) return null;
  return <div role="status" dir="rtl" className="mb-4 rounded-lg border bg-muted p-3 text-sm">
    {!online
      ? "لا يوجد اتصال بالشبكة. البيانات الظاهرة هي آخر قراءة متاحة، والتحميلات المتوقفة تُستأنف عند عودة الاتصال."
      : "الاتصال أبطأ من المعتاد. نحتفظ بآخر بيانات محمّلة أثناء انتظار الاستجابة."}
  </div>;
}
