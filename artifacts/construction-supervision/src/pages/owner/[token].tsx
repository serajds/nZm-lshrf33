import { useState } from "react";
import { useParams } from "wouter";
import { useVerifyOwnerAccess } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, MapPin, Calendar, HardHat, Lock, 
  CheckCircle2, AlertTriangle, FileText
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

export default function OwnerPortal() {
  const params = useParams();
  const token = params.token || "";
  const { toast } = useToast();
  
  const [password, setPassword] = useState("");
  const [ownerData, setOwnerData] = useState<any>(null);
  
  const verifyAccess = useVerifyOwnerAccess();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    try {
      const res = await verifyAccess.mutateAsync({
        data: { token, password }
      });
      setOwnerData(res);
    } catch (e: any) {
      toast({ 
        variant: "destructive", 
        title: "رمز الدخول غير صحيح",
        description: e?.error || "الرجاء التأكد من كلمة المرور"
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

  const { project, activities, reports, summary } = ownerData;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-primary">نشط</Badge>;
      case 'completed': return <Badge className="bg-emerald-500">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      case 'suspended': return <Badge className="bg-orange-500">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const ganttData = activities?.map((a: any) => ({
    name: a.name,
    "المخطط": a.plannedProgress,
    "الفعلي": a.actualProgress,
  })) || [];

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
              <div className={`text-3xl font-bold ${summary.delayDays > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {summary.delayDays > 0 ? `${summary.delayDays} يوم` : 'لا يوجد تأخير'}
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
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="progress">سير العمل</TabsTrigger>
            <TabsTrigger value="reports">التقارير</TabsTrigger>
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
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
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
              {reports?.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-lg border">لا توجد تقارير متاحة</div>
              ) : (
                reports?.map((report: any) => (
                  <Card key={report.id}>
                    <CardHeader className="pb-3 border-b">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">
                          تقرير {report.type === 'weekly' ? 'أسبوعي' : 'شهري'} 
                        </CardTitle>
                        <span className="text-sm text-muted-foreground" dir="ltr">
                          {new Date(report.reportDate).toLocaleDateString('ar-SA')}
                        </span>
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
        </Tabs>
      </div>
    </div>
  );
}
