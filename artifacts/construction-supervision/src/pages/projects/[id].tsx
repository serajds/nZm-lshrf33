import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { 
  useGetProject, 
  useGetProjectSummary, 
  useGenerateOwnerLink,
  getGetProjectQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, MapPin, Calendar, Clock, ActivitySquare, CheckCircle2, 
  AlertTriangle, ArrowRight, Share2, Copy
} from "lucide-react";

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
      const res = await generateLink.mutateAsync({
        projectId,
        data: { password: ownerPassword }
      });
      setOwnerLink(`${window.location.origin}/owner/${res.token}`);
      toast({ title: "تم إنشاء الرابط بنجاح" });
    } catch (e) {
      toast({ variant: "destructive", title: "فشل إنشاء الرابط" });
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(ownerLink);
    toast({ title: "تم نسخ الرابط" });
  };

  if (isProjectLoading || isSummaryLoading) return <div className="flex h-40 items-center justify-center">جاري التحميل...</div>;
  if (!project) return <div>المشروع غير موجود</div>;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-primary">نشط</Badge>;
      case 'completed': return <Badge className="bg-emerald-500">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      case 'suspended': return <Badge className="bg-orange-500">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            {getStatusBadge(project.status)}
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {project.location}
            </span>
          </div>
        </div>
        
        <div className="mr-auto">
          <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Share2 className="h-4 w-4" />
                رابط المالك
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
                      <Input value={ownerLink} readOnly dir="ltr" className="text-left" />
                      <Button variant="secondary" onClick={copyLink}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">شارك هذا الرابط وكلمة المرور مع المالك لمتابعة حالة المشروع.</p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="summary" className="w-full" dir="rtl">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
          <TabsTrigger value="summary" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3">ملخص المشروع</TabsTrigger>
          <TabsTrigger value="activities" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${project.id}/activities`)}>الجدول الزمني</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${project.id}/reports`)}>التقارير</TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${project.id}/files`)}>الملفات</TabsTrigger>
          <TabsTrigger value="deviation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${project.id}/deviation`)}>تحليل الانحراف</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-6 space-y-6">
          {/* Progress Overview */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">نسبة الإنجاز</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between mb-2">
                  <div className="text-4xl font-bold">{summary?.overallProgress || 0}%</div>
                  <div className="text-sm text-muted-foreground">
                    المخطط: {summary?.plannedProgress || 0}%
                  </div>
                </div>
                <div className="relative w-full h-3 bg-secondary rounded-full overflow-hidden mt-4">
                  <div className="absolute top-0 right-0 h-full bg-primary/30" style={{ width: `${summary?.plannedProgress || 0}%` }} />
                  <div className="absolute top-0 right-0 h-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" style={{ width: `${summary?.overallProgress || 0}%` }} />
                </div>
                {summary?.delayDays ? (
                  <p className="text-sm text-destructive mt-3 flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    تأخير بمقدار {summary.delayDays} يوم عن المخطط
                  </p>
                ) : (
                  <p className="text-sm text-emerald-600 mt-3 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    المشروع يسير حسب المخطط
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">مؤشرات الأداء</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">الأنشطة المكتملة</p>
                  <p className="text-2xl font-semibold">{summary?.activitiesCompleted || 0} <span className="text-sm font-normal text-muted-foreground">من {summary?.activitiesTotal || 0}</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">أنشطة متأخرة</p>
                  <p className="text-2xl font-semibold text-destructive">{summary?.activitiesDelayed || 0}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">الأيام المنقضية</p>
                  <p className="text-2xl font-semibold">{summary?.daysElapsed || 0} <span className="text-sm font-normal text-muted-foreground">من {summary?.totalDays || 0}</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">التقارير / الملفات</p>
                  <p className="text-2xl font-semibold">{summary?.reportsCount || 0} / {summary?.filesCount || 0}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Project Details Grid */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">تفاصيل العقد</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" /> الجهة المالكة
                  </p>
                  <p className="text-foreground">{project.ownerEntity}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" /> المقاول المنفذ
                  </p>
                  <p className="text-foreground">{project.contractor}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" /> الجهة المشرفة
                  </p>
                  <p className="text-foreground">{project.supervisorEntity}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" /> الموقع
                  </p>
                  <p className="text-foreground">{project.location}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" /> تاريخ البداية
                  </p>
                  <p className="text-foreground" dir="ltr">{new Date(project.startDate).toLocaleDateString('ar-SA-u-nu-latn')}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" /> النهاية المتوقعة
                  </p>
                  <p className="text-foreground" dir="ltr">{new Date(project.expectedEndDate).toLocaleDateString('ar-SA-u-nu-latn')}</p>
                </div>
                {project.actualEndDate && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4" /> النهاية الفعلية
                    </p>
                    <p className="text-foreground" dir="ltr">{new Date(project.actualEndDate).toLocaleDateString('ar-SA-u-nu-latn')}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
