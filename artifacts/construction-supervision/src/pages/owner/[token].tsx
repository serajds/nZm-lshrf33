import { useState } from "react";
import { useParams } from "wouter";
import { useVerifyOwnerAccess } from "@workspace/api-client-react";
import type { OwnerProjectView, Activity, Report, ProjectExtension, ProjectSuspension } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, MapPin, HardHat, Lock, 
  CheckCircle2, AlertTriangle, Calendar, ArrowBigRightDash, Clock, PauseCircle, Printer
} from "lucide-react";
import { previewReport } from "@/lib/report-pdf";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

export default function OwnerPortal() {
  const params = useParams();
  const token = params.token ?? "";
  const { toast } = useToast();
  
  const [password, setPassword] = useState("");
  const [ownerData, setOwnerData] = useState<OwnerProjectView | null>(null);
  const verifyAccess = useVerifyOwnerAccess();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    try {
      const res = await verifyAccess.mutateAsync({
        data: { token, password }
      });
      setOwnerData(res);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "الرجاء التأكد من كلمة المرور";
      toast({ 
        variant: "destructive", 
        title: "رمز الدخول غير صحيح",
        description: errorMessage
      });
    }
  };

  if (!ownerData) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-muted p-4" dir="rtl">
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">بوابة المالك</h1>
          <p className="text-muted-foreground mt-2">متابعة مشاريع البناء الخاصة بك</p>
        </div>

        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl">الوصول للمشروع</CardTitle>
            <CardDescription>أدخل كلمة المرور المزودة من قبل المهندس المشرف</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label>كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="password" 
                    placeholder="••••••••" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9 text-right" 
                    dir="ltr"
                  />
                </div>
              </div>
              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={verifyAccess.isPending}>
                {verifyAccess.isPending ? "جاري التحقق..." : "عرض المشروع"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { project, activities, reports, extensions = [], suspensions = [], summary } = ownerData;
  const totalExtDays = extensions.reduce((s, e) => s + e.daysAdded, 0);
  const latestExt = extensions.length > 0 ? extensions[extensions.length - 1] : null;
  const totalSuspDays = (suspensions as ProjectSuspension[]).reduce((s, x) => s + x.calendarDays, 0);

  const handlePreview = (report: Report) => {
    previewReport({
      projectName: project.name,
      ownerEntity: project.ownerEntity,
      contractor: project.contractor,
      supervisorEntity: project.supervisorEntity,
      location: project.location,
      reportType: report.type,
      reportDate: report.reportDate,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      progressPercentage: report.progressPercentage,
      workDescription: report.workDescription,
      technicalNotes: report.technicalNotes,
      recommendations: report.recommendations,
      imageUrls: report.imageUrls ?? [],
      reportId: report.id,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-primary">نشط</Badge>;
      case 'completed': return <Badge className="bg-emerald-500">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      case 'suspended': return <Badge className="bg-orange-500">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const ganttData = activities.map((a: Activity) => ({
    name: a.name,
    "المخطط": a.plannedProgress,
    "الفعلي": a.actualProgress,
  }));

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {project.location}</span>
              <span className="flex items-center gap-1"><HardHat className="h-4 w-4" /> المقاول: {project.contractor}</span>
            </div>
          </div>
          {getStatusBadge(project.status)}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">الإنجاز الفعلي</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.overallProgress}%</div>
              <div className="text-xs text-muted-foreground mt-1">المخطط: {summary.plannedProgress}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">حالة التأخير</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${summary.delayDays && summary.delayDays > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {summary.delayDays && summary.delayDays > 0 ? `${summary.delayDays} يوم` : 'لا يوجد تأخير'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">الأنشطة المكتملة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.activitiesCompleted} / {summary.activitiesTotal}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">التقارير المعتمدة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.reportsCount}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="progress" className="w-full">
          <TabsList className="w-full justify-start mb-4 flex-wrap gap-1">
            <TabsTrigger value="progress">سير العمل</TabsTrigger>
            <TabsTrigger value="reports">التقارير</TabsTrigger>
            <TabsTrigger value="extensions">التمديدات {extensions.length > 0 && <Badge className="mr-1 bg-amber-500 text-white text-[10px] px-1 py-0">{extensions.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="suspensions">التوقفات {(suspensions as ProjectSuspension[]).length > 0 && <Badge className="mr-1 bg-violet-500 text-white text-[10px] px-1 py-0">{(suspensions as ProjectSuspension[]).length}</Badge>}</TabsTrigger>
          </TabsList>
          
          <TabsContent value="progress" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>مقارنة الإنجاز (المخطط مقابل الفعلي)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ganttData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                      <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip contentStyle={{ textAlign: 'right', direction: 'rtl' }} formatter={(v: number) => [`${v}%`]} />
                      <Bar dataKey="المخطط" fill="hsl(var(--muted-foreground))" opacity={0.5} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="الفعلي" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports">
            <div className="grid gap-4">
              {reports.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-lg border">لا توجد تقارير متاحة</div>
              ) : (
                reports.map((report: Report) => (
                  <Card key={report.id}>
                    <CardHeader className="pb-3 border-b">
                      <div className="flex justify-between items-center gap-3">
                        <CardTitle className="text-lg">
                          تقرير {report.type === 'weekly' ? 'أسبوعي' : 'شهري'} 
                        </CardTitle>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm text-muted-foreground font-mono">
                            {fmtDate(report.reportDate)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-violet-600 hover:bg-violet-50 hover:text-violet-700 border-violet-200 gap-1"
                            onClick={() => handlePreview(report)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            معاينة وطباعة
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-sm font-semibold mb-1">وصف الأعمال المنجزة</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.workDescription}</p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold">نسبة الإنجاز للفترة</span>
                            <span className="font-bold text-primary">{report.progressPercentage}%</span>
                          </div>
                          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${report.progressPercentage}%` }} />
                          </div>
                        </div>
                      </div>
                      
                      {(report.technicalNotes || report.recommendations) && (
                        <div className="bg-muted p-4 rounded-md space-y-3 mt-4">
                          {report.technicalNotes && (
                            <div>
                              <h4 className="text-sm font-semibold text-destructive mb-1 flex items-center gap-1"><AlertTriangle className="h-4 w-4"/> ملاحظات فنية</h4>
                              <p className="text-sm text-muted-foreground">{report.technicalNotes}</p>
                            </div>
                          )}
                          {report.recommendations && (
                            <div>
                              <h4 className="text-sm font-semibold text-emerald-600 mb-1 flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> التوصيات</h4>
                              <p className="text-sm text-muted-foreground">{report.recommendations}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="extensions">
            <div className="space-y-4">
              {extensions.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    لا توجد تمديدات زمنية — المشروع يسير وفق الجدول الأصلي
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" /> التاريخ الأصلي للإنهاء
                        </p>
                        <p className="text-lg font-bold tabular-nums" dir="ltr">
                          {fmtDate(project.expectedEndDate)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-amber-400">
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <ArrowBigRightDash className="h-3.5 w-3.5 text-amber-500" /> التاريخ الحالي بعد التمديدات
                        </p>
                        <p className="text-lg font-bold tabular-nums text-amber-600" dir="ltr">
                          {latestExt ? fmtDate(latestExt.newEndDate) : "—"}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> إجمالي أيام التمديد
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-amber-600">
                          {totalExtDays} <span className="text-sm font-normal">يوم</span>
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">سجل التمديدات الرسمية</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table className="min-w-[580px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">تاريخ الاتفاقية</TableHead>
                            <TableHead className="text-center">الأيام المضافة</TableHead>
                            <TableHead className="text-right">تاريخ الإنهاء الجديد</TableHead>
                            <TableHead className="text-right">السبب</TableHead>
                            <TableHead className="text-right">رقم الخطاب</TableHead>
                            <TableHead className="text-right">الجهة الموافِقة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extensions.map((ext, i) => (
                            <TableRow key={ext.id}>
                              <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(ext.extensionDate)}</TableCell>
                              <TableCell className="text-center">
                                <Badge className="bg-amber-500 text-white">+{ext.daysAdded} يوم</Badge>
                              </TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums font-medium text-amber-700">
                                {fmtDate(ext.newEndDate)}
                              </TableCell>
                              <TableCell className="text-sm max-w-[160px] truncate" title={ext.reason ?? undefined}>
                                {ext.reason ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-sm font-mono">
                                {ext.documentRef ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-sm">
                                {ext.approvedBy ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="suspensions">
            <div className="space-y-4">
              {(suspensions as ProjectSuspension[]).length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    لا توجد توقفات مسجلة للمشروع
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <PauseCircle className="h-3.5 w-3.5 text-violet-500" /> عدد التوقفات المسجلة
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-violet-600">
                          {(suspensions as ProjectSuspension[]).length}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-amber-400">
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-amber-500" /> إجمالي أيام التوقف
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-amber-600">
                          {totalSuspDays} <span className="text-sm font-normal">يوم</span>
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">سجل التوقفات الرسمية</CardTitle>
                      <CardDescription>العطل الرسمية والظروف القاهرة المعتمدة</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table className="min-w-[560px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">النوع</TableHead>
                            <TableHead className="text-right">تاريخ البدء</TableHead>
                            <TableHead className="text-right">تاريخ الانتهاء</TableHead>
                            <TableHead className="text-center">الأيام</TableHead>
                            <TableHead className="text-right">السبب</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(suspensions as ProjectSuspension[]).map((susp, i) => (
                            <TableRow key={susp.id}>
                              <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                              <TableCell>
                                {susp.type === "official_holiday" ? (
                                  <Badge className="bg-violet-100 text-violet-700 border border-violet-300">عطلة رسمية</Badge>
                                ) : susp.type === "force_majeure" ? (
                                  <Badge className="bg-red-100 text-red-700 border border-red-300">ظرف قاهر</Badge>
                                ) : (
                                  <Badge className="bg-orange-100 text-orange-700 border border-orange-300">توقف مقاول</Badge>
                                )}
                              </TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(susp.startDate)}</TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(susp.endDate)}</TableCell>
                              <TableCell className="text-center">
                                <Badge className="bg-amber-500 text-white">{susp.calendarDays} يوم</Badge>
                              </TableCell>
                              <TableCell className="text-sm max-w-[160px] truncate" title={susp.reason ?? undefined}>
                                {susp.reason ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
