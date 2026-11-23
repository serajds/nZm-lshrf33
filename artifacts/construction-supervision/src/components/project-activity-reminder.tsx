import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BellRing } from "lucide-react";
import { useAutomaticNoticeSlot } from "./automatic-notices";

type Reminder = { show: boolean; fullName?: string; lastUpdatedAt?: string | null };
const REMINDER_CACHE_MS = 24 * 60 * 60 * 1000;

export function ProjectActivityReminder({ projectId, canViewActivities }: {
  projectId: number;
  canViewActivities: boolean;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [reminder, setReminder] = useState<(Reminder & { projectId: number; userId: number; day: string }) | null>(null);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Tripoli" }).format(new Date());
  const queryKey = ["project-activity-reminder", user?.id, projectId, day];
  const { data, isFetching, isFetchedAfterMount, dataUpdatedAt } = useQuery<Reminder>({
    queryKey,
    queryFn: () => {
      // A claimed reminder waiting behind another notice has not been dismissed.
      // Keep it available across project sub-page navigation in this session.
      const pending = queryClient.getQueryData<Reminder>(queryKey);
      return pending ? Promise.resolve(pending)
        : customFetch(`/api/projects/${projectId}/my-activity-reminder/claim`, { method: "POST" });
    },
    enabled: !!user && projectId > 0,
    retry: false,
    // The key contains the Libya-local day, so cache both shown and dismissed
    // outcomes for that day instead of reclaiming on every project tab mount.
    staleTime: REMINDER_CACHE_MS,
    gcTime: REMINDER_CACHE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (isFetchedAfterMount && !isFetching && data?.show && user) {
      setReminder({ ...data, projectId, userId: user.id, day });
    }
  }, [data, dataUpdatedAt, isFetchedAfterMount, isFetching, projectId, user?.id, day]);

  const requested = reminder?.show === true && reminder.projectId === projectId
    && reminder.userId === user?.id && reminder.day === day;
  const visible = useAutomaticNoticeSlot(requested, projectId);

  const dismiss = () => {
    setReminder(null);
    queryClient.setQueryData<Reminder>(queryKey, { show: false });
  };
  const lastUpdate = reminder?.lastUpdatedAt ? new Date(reminder.lastUpdatedAt) : null;
  const formattedUpdate = lastUpdate && Number.isFinite(lastUpdate.getTime())
    ? lastUpdate.toLocaleString("ar-LY-u-nu-latn", { timeZone: "Africa/Tripoli", dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <Dialog open={visible} onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" /> تذكير تحديث الجدول الزمني
          </DialogTitle>
          <DialogDescription className="pt-3 leading-7">
            {reminder?.fullName}، يرجى مراجعة بنود الأعمال وتحديث نسب الإنجاز وبياناتها وفق حالة التنفيذ الفعلية.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted p-3 text-sm leading-7">
          {formattedUpdate
            ? `آخر تعديل مسجّل لك على بنود هذا المشروع: ${formattedUpdate}`
            : "لم يُسجّل تحديث سابق لك على بنود هذا المشروع."}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={dismiss}>إغلاق</Button>
          {canViewActivities && (
            <Button onClick={() => { dismiss(); navigate(`/projects/${projectId}/activities`); }}>
              فتح الجدول الزمني
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
