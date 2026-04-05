import { useState } from "react";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import type { CreateProjectBody } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Search, Building2, MapPin, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const projectSchema = z.object({
  name: z.string().min(1, "اسم المشروع مطلوب"),
  location: z.string().min(1, "الموقع مطلوب"),
  ownerEntity: z.string().min(1, "الجهة المالكة مطلوبة"),
  supervisorEntity: z.string().min(1, "الجهة المشرفة مطلوبة"),
  contractor: z.string().min(1, "المقاول مطلوب"),
  startDate: z.string().min(1, "تاريخ البداية مطلوب"),
  expectedEndDate: z.string().min(1, "تاريخ النهاية المتوقع مطلوب"),
  status: z.enum(["active", "completed", "delayed", "suspended"]).default("active"),
});

export default function Projects() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: projects, isLoading } = useListProjects({
    search: search || null,
    status: statusFilter && statusFilter !== "all" ? statusFilter : null,
  });

  const createProject = useCreateProject();

  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      location: "",
      ownerEntity: "",
      supervisorEntity: "",
      contractor: "",
      startDate: new Date().toISOString().split('T')[0],
      expectedEndDate: new Date(Date.now() + 31536000000).toISOString().split('T')[0], // +1 year
      status: "active",
    }
  });

  const onSubmit = async (values: z.infer<typeof projectSchema>) => {
    try {
      await createProject.mutateAsync({ data: values });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "تم إنشاء المشروع بنجاح" });
    } catch (error) {
      toast({ variant: "destructive", title: "فشل إنشاء المشروع" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="default" className="bg-primary hover:bg-primary">نشط</Badge>;
      case 'completed': return <Badge variant="secondary" className="bg-emerald-500 hover:bg-emerald-600 text-white">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      case 'suspended': return <Badge variant="outline" className="bg-orange-500 text-white hover:bg-orange-600 border-none">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
        <h1 className="text-3xl font-bold tracking-tight">المشاريع</h1>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              مشروع جديد
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]" dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة مشروع جديد</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>اسم المشروع</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ownerEntity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>الجهة المالكة</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="contractor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>المقاول المنفذ</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="supervisorEntity"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>الجهة المشرفة</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>موقع المشروع</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ البداية</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="expectedEndDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ النهاية المتوقع</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end pt-4 gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                  <Button type="submit" disabled={createProject.isPending}>حفظ المشروع</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="بحث عن مشروع..." 
            className="pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v)}>
            <SelectTrigger>
              <SelectValue placeholder="حالة المشروع" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="active">نشط</SelectItem>
              <SelectItem value="completed">مكتمل</SelectItem>
              <SelectItem value="delayed">متأخر</SelectItem>
              <SelectItem value="suspended">متوقف</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">جاري التحميل...</div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border border-dashed">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
          <h3 className="text-lg font-medium">لا توجد مشاريع</h3>
          <p className="text-muted-foreground text-sm mt-1">لم يتم العثور على مشاريع مطابقة للبحث</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects?.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow flex flex-col h-full">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-lg line-clamp-2">
                    <Link href={`/projects/${project.id}`} className="hover:text-primary transition-colors">
                      {project.name}
                    </Link>
                  </CardTitle>
                  {getStatusBadge(project.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">المالك: {project.ownerEntity}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span>النهاية: {new Date(project.expectedEndDate).toLocaleDateString('ar-SA')}</span>
                  </div>
                </div>
                
                <div className="space-y-1.5 mt-auto pt-4">
                  <div className="flex justify-between text-sm font-medium">
                    <span>نسبة الإنجاز</span>
                    <span>%{project.overallProgress}</span>
                  </div>
                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${project.overallProgress < 30 ? 'bg-destructive' : project.overallProgress < 70 ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${project.overallProgress}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
