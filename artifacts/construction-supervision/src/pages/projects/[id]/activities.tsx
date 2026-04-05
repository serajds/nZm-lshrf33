import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useListActivities, 
  useCreateActivity, 
  useUpdateActivity, 
  useDeleteActivity,
  useGetProject,
  getListActivitiesQueryKey 
} from "@workspace/api-client-react";
import type { Activity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, ArrowRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

const activitySchema = z.object({
  name: z.string().min(1, "اسم النشاط مطلوب"),
  plannedStartDate: z.string().min(1, "تاريخ البداية المخطط مطلوب"),
  plannedEndDate: z.string().min(1, "تاريخ النهاية المخطط مطلوب"),
  actualStartDate: z.string().optional().nullable(),
  actualEndDate: z.string().optional().nullable(),
  plannedProgress: z.coerce.number().min(0).max(100),
  actualProgress: z.coerce.number().min(0).max(100),
  status: z.enum(["not_started", "in_progress", "completed", "delayed"]).default("not_started"),
  sortOrder: z.coerce.number().default(0),
});

type ActivityFormValues = z.infer<typeof activitySchema>;

export default function ProjectActivities() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: activities, isLoading } = useListActivities(projectId, { query: { enabled: !!projectId } });
  
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      name: "",
      plannedStartDate: "",
      plannedEndDate: "",
      actualStartDate: "",
      actualEndDate: "",
      plannedProgress: 0,
      actualProgress: 0,
      status: "not_started",
      sortOrder: 0,
    }
  });

  const handleEdit = (a: Activity) => {
    setEditingId(a.id);
    form.reset({
      name: a.name,
      plannedStartDate: new Date(a.plannedStartDate).toISOString().split('T')[0],
      plannedEndDate: new Date(a.plannedEndDate).toISOString().split('T')[0],
      actualStartDate: a.actualStartDate ? new Date(a.actualStartDate).toISOString().split('T')[0] : "",
      actualEndDate: a.actualEndDate ? new Date(a.actualEndDate).toISOString().split('T')[0] : "",
      plannedProgress: a.plannedProgress,
      actualProgress: a.actualProgress,
      status: a.status as ActivityFormValues["status"],
      sortOrder: a.sortOrder ?? 0,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذا النشاط؟")) {
      try {
        await deleteActivity.mutateAsync({ projectId, id });
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(projectId) });
        toast({ title: "تم حذف النشاط" });
      } catch {
        toast({ variant: "destructive", title: "فشل الحذف" });
      }
    }
  };

  const onSubmit = async (values: ActivityFormValues) => {
    try {
      const payload = {
        ...values,
        actualStartDate: values.actualStartDate || null,
        actualEndDate: values.actualEndDate || null,
      };

      if (editingId) {
        await updateActivity.mutateAsync({ projectId, id: editingId, data: payload });
        toast({ title: "تم التحديث" });
      } else {
        await createActivity.mutateAsync({ projectId, data: payload });
        toast({ title: "تمت الإضافة" });
      }
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(projectId) });
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
    } catch {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'not_started': return <Badge variant="outline">لم يبدأ</Badge>;
      case 'in_progress': return <Badge className="bg-blue-500">قيد التنفيذ</Badge>;
      case 'completed': return <Badge className="bg-emerald-500">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const ganttData = (activities ?? []).map((a) => ({
    name: a.name,
    "المخطط": a.plannedProgress,
    "الفعلي": a.actualProgress,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{project?.name} - الجدول الزمني</h1>
      </div>

      <Tabs defaultValue="activities" className="w-full" dir="rtl">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
          <TabsTrigger value="summary" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}`)}>ملخص المشروع</TabsTrigger>
          <TabsTrigger value="activities" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3">الجدول الزمني</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/reports`)}>التقارير</TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/files`)}>الملفات</TabsTrigger>
          <TabsTrigger value="deviation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/deviation`)}>تحليل الانحراف</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>الإنجاز المخطط مقابل الفعلي</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ganttData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} interval={0} fontSize={12} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={{ textAlign: 'right', direction: 'rtl' }} formatter={(v: number) => [`${v}%`]} />
                  <Bar dataKey="المخطط" fill="hsl(var(--muted-foreground))" opacity={0.5} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="الفعلي" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الأنشطة</CardTitle>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) { form.reset(); setEditingId(null); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> إضافة نشاط
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]" dir="rtl">
                <DialogHeader>
                  <DialogTitle>{editingId ? "تعديل نشاط" : "نشاط جديد"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>اسم النشاط</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="plannedStartDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>بداية المخطط</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="plannedEndDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>نهاية المخطط</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="actualStartDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>بداية الفعلي</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="actualEndDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>نهاية الفعلي</FormLabel>
                            <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="plannedProgress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>إنجاز المخطط (%)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="actualProgress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>إنجاز الفعلي (%)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>الحالة</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                              </FormControl>
                              <SelectContent dir="rtl">
                                <SelectItem value="not_started">لم يبدأ</SelectItem>
                                <SelectItem value="in_progress">قيد التنفيذ</SelectItem>
                                <SelectItem value="completed">مكتمل</SelectItem>
                                <SelectItem value="delayed">متأخر</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sortOrder"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>الترتيب</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                      <Button type="submit" disabled={createActivity.isPending || updateActivity.isPending}>حفظ</Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">النشاط</TableHead>
                  <TableHead className="text-right">البداية</TableHead>
                  <TableHead className="text-right">النهاية</TableHead>
                  <TableHead className="text-center">مخطط</TableHead>
                  <TableHead className="text-center">فعلي</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4">جاري التحميل...</TableCell></TableRow>
                ) : (activities ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">لا يوجد أنشطة</TableCell></TableRow>
                ) : (
                  (activities ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell dir="ltr" className="text-right text-muted-foreground">{new Date(a.plannedStartDate).toLocaleDateString('ar-SA')}</TableCell>
                      <TableCell dir="ltr" className="text-right text-muted-foreground">{new Date(a.plannedEndDate).toLocaleDateString('ar-SA')}</TableCell>
                      <TableCell className="text-center">%{a.plannedProgress}</TableCell>
                      <TableCell className="text-center font-bold text-primary">%{a.actualProgress}</TableCell>
                      <TableCell>{getStatusBadge(a.status)}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(a)}>
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
