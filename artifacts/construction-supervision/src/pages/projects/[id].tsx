import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetProject,
  useGetProjectSummary,
  useGenerateOwnerLink,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, MapPin, Calendar, ActivitySquare, CheckCircle2,
  AlertTriangle, ArrowRight, Share2, Copy, Clock
} from "lucide-react";
import { ProjectNav } from "@/components/project-nav";

export default function ProjectDetails() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();

  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerLink, setOwnerLink] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

  const { data: project, isLoading: isProjectLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId }
  });
  const { data: summary, isLoading: isSummaryLoading } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId }
  });

  const generateLink = useGenerateOwnerLink();

  const handleGenerateLink = async () => {
    if (!ownerPassword) {
      toast({ variant: "destructive", title: "الرجاء إدخال كلمة مرور للرابط" });
      return;
    }
    try {
      const res = await generateLink.mutateAsync({ projectId, data: { password: ownerPassword } });
      setOwnerLink(`${window.location.origin}/owner/${res.token}`);
      toast({ title: "تم إنشاء الرابط بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل إنشاء الرابط" });
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(ownerLink);
    toast({ title: "تم نسخ الرابط" });
  };

  if (isProjectLoading || isSummaryLoading)
    return <div className="flex h-40 items-center justify-center text-muted-foreground">جاري التحميل...</div>;
  if (!project)
    return <div className="flex h-40 items-center justify-center text-muted-foreground">المشروع غير موجود</div>;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-primary text-primary-foreground">نشط</Badge>;
      case "completed": return <Badge className="bg-emerald-600 text-white">مكتمل</Badge>;
      case "delayed": return <Badge variant="destructive">متأخر</Badge>;
      case "suspended": return <Badge className="bg-orange-500 text-white">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mt-0.5"
          onClick={() => setLocation("/projects")}
        >
          <ArrowRight className="h-5 w-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {getStatusBadge(project.status)}
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {project.location}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">رابط المالك</span>
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>إنشاء رابط للمالك</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>كلمة مرور للرابط</Label>
                  <Input
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="أدخل كلمة مرور لحماية الرابط"
                  />
                </div>
                {!ownerLink ? (
                  <Button onClick={handleGenerateLink} disabled={generateLink.isPending} className="w-full">
                    إنشاء الرابط
                  </Button>
                ) : (
                  <div className="space-y-2 mt-4">
                    <Label>الرابط الخاص بالمالك</Label>
                    <div className="flex gap-2">
                      <Input value={ownerLink} readOnly dir="ltr" className="text-left text-xs" />
                      <Button variant="secondary" onClick={copyLink}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      شارك هذا الرابط وكلمة المرور مع المالك لمتابعة حالة المشروع.
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Project Navigation ── */}
      <ProjectNav projectId={project.id} />

      {/* ── Summary Content ── */}
      <div className="space-y-5">
        {/* Progress + KPIs */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">نسبة الإنجاز</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-3">
                <div className="text-4xl font-bold tabular-nums">
                  {summary?.overallProgress ?? 0}%
                </div>
                <div className="text-sm text-muted-foreground">
                  المخطط: {summary?.plannedProgress ?? 0}%
                </div>
              </div>
              <div className="relative w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="absolute top-0 right-0 h-full bg-primary/25 rounded-full"
                  style={{ width: `${summary?.plannedProgress ?? 0}%` }}
                />
                <div
                  className="absolute top-0 right-0 h-full bg-primary rounded-full"
                  style={{ width: `${summary?.overallProgress ?? 0}%` }}
                />
              </div>
              {summary?.delayDays ? (
                <p className="text-sm text-destructive mt-3 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  تأخير بمقدار {summary.delayDays} يوم عن المخطط
                </p>
              ) : (
                <p className="text-sm text-emerald-600 mt-3 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  المشروع يسير حسب المخطط
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مؤشرات الأداء</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">الأنشطة المكتملة</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.activitiesCompleted ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {summary?.activitiesTotal ?? 0}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">أنشطة متأخرة</p>
                <p className="text-xl font-bold tabular-nums text-destructive">
                  {summary?.activitiesDelayed ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">الأيام المنقضية</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.daysElapsed ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {summary?.totalDays ?? 0}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">تقارير / ملفات</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.reportsCount ?? 0}
                  <span className="text-muted-foreground font-normal"> / </span>
                  {summary?.filesCount ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contract Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">تفاصيل العقد</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { icon: Building2, label: "الجهة المالكة", value: project.ownerEntity },
                { icon: Building2, label: "المقاول المنفذ", value: project.contractor },
                { icon: ActivitySquare, label: "الجهة المشرفة", value: project.supervisorEntity },
                { icon: MapPin, label: "الموقع", value: project.location },
                {
                  icon: Calendar, label: "تاريخ البداية",
                  value: new Date(project.startDate).toLocaleDateString("ar-SA-u-nu-latn"),
                  ltr: true,
                },
                {
                  icon: Calendar, label: "النهاية المتوقعة",
                  value: new Date(project.expectedEndDate).toLocaleDateString("ar-SA-u-nu-latn"),
                  ltr: true,
                },
                ...(project.actualEndDate ? [{
                  icon: Clock, label: "النهاية الفعلية",
                  value: new Date(project.actualEndDate).toLocaleDateString("ar-SA-u-nu-latn"),
                  ltr: true,
                }] : []),
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </p>
                  <p className="text-sm text-foreground" dir={item.ltr ? "ltr" : undefined}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
