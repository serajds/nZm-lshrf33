import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Building2, CalendarOff, Folder, FolderOpen, ChevronRight, ArrowUp, Loader2, FlaskConical, X, FileText, Network, Tags, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectLinkCodeSettings } from "@/components/project-link-code-settings";
import { useProjectCategories } from "@/hooks/use-project-categories";
import { parentCandidates } from "@/lib/project-portfolio";
import type { PortfolioProject } from "./types";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface CompanyOption {
  id: number;
  name: string;
  type: "owner" | "contractor" | "supervisor";
  logoUrl: string | null;
}

const projectSchema = z.object({
  name: z.string().min(1, "اسم المشروع مطلوب"),
  location: z.string().min(1, "الموقع مطلوب"),
  ownerEntity: z.string().min(1, "الجهة المالكة مطلوبة"),
  supervisorEntity: z.string().min(1, "الجهة المشرفة مطلوبة"),
  contractor: z.string().min(1, "المقاول مطلوب"),
  noSchedule: z.boolean().default(false),
  startDate: z.string().optional().default(""),
  expectedEndDate: z.string().optional().default(""),
  status: z.enum(["active", "completed", "delayed", "suspended"]).default("active"),
  ownerCompanyId: z.string().optional(),
  contractorCompanyId: z.string().optional(),
  supervisorCompanyId: z.string().optional(),
  onedriveTestResultsFolderId: z.string().optional(),
  parentProjectId: z.string().default("none"),
  categoryId: z.string().default("none"),
}).refine((data) => data.noSchedule || (!!data.startDate && data.startDate.length > 0), {
  message: "تاريخ البداية مطلوب", path: ["startDate"],
}).refine((data) => data.noSchedule || (!!data.expectedEndDate && data.expectedEndDate.length > 0), {
  message: "تاريخ النهاية المتوقع مطلوب", path: ["expectedEndDate"],
}).refine((data) => {
  if (data.noSchedule || !data.startDate || !data.expectedEndDate) return true;
  return data.expectedEndDate >= data.startDate;
}, { message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية", path: ["expectedEndDate"] });

export type ProjectFormValues = z.infer<typeof projectSchema>;

const today = () => new Date().toISOString().split("T")[0];
const nextYear = () => new Date(Date.now() + 31536000000).toISOString().split("T")[0];
const isoDay = (d?: string | null) => (d ? new Date(d).toISOString().split("T")[0] : "");

export function emptyFormValues(parentId?: number | null): ProjectFormValues {
  return {
    name: "", location: "", ownerEntity: "", supervisorEntity: "", contractor: "",
    noSchedule: false, startDate: today(), expectedEndDate: nextYear(), status: "active",
    ownerCompanyId: "", contractorCompanyId: "", supervisorCompanyId: "", onedriveTestResultsFolderId: "",
    parentProjectId: parentId ? String(parentId) : "none", categoryId: "none",
  };
}

export function projectToFormValues(p: PortfolioProject): ProjectFormValues {
  return {
    name: p.name, location: p.location, ownerEntity: p.ownerEntity, supervisorEntity: p.supervisorEntity, contractor: p.contractor,
    noSchedule: p.noSchedule === true,
    startDate: isoDay(p.startDate), expectedEndDate: isoDay(p.expectedEndDate),
    status: p.status as ProjectFormValues["status"],
    ownerCompanyId: p.ownerCompanyId ? String(p.ownerCompanyId) : "",
    contractorCompanyId: p.contractorCompanyId ? String(p.contractorCompanyId) : "",
    supervisorCompanyId: p.supervisorCompanyId ? String(p.supervisorCompanyId) : "",
    onedriveTestResultsFolderId: p.onedriveTestResultsFolderId || "",
    parentProjectId: p.parentProjectId ? String(p.parentProjectId) : "none",
    categoryId: p.categoryId ? String(p.categoryId) : "none",
  };
}

export { formValuesToPayload } from "@/lib/project-portfolio";

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProject: PortfolioProject | null;
  initialValues: ProjectFormValues | null; // null => still loading detail
  detailError: string | null;
  onRetryDetail: () => void;
  allProjects: PortfolioProject[];
  isAdmin: boolean;
  canAssignCategory: boolean;
  isSubmitting: boolean;
  onSubmit: (values: ProjectFormValues) => void;
}

export function ProjectFormDialog(props: ProjectFormDialogProps) {
  const { open, onOpenChange, editingProject, initialValues, detailError, onRetryDetail } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-[700px] max-h-[90dvh] overflow-hidden p-0" dir="rtl">
        <div className="bg-muted/40 p-6 pb-4 border-b border-border/50">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl">{editingProject ? "تعديل بيانات المشروع" : "إضافة مشروع جديد"}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {editingProject ? "قم بتحديث بيانات المشروع والجهات المشاركة فيه." : "أدخل تفاصيل المشروع الجديد لتتبعه في النظام."}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>
        <div className="min-w-0 overflow-y-auto max-h-[calc(90dvh-140px)]">
          {detailError ? (
            <div className="m-6 flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
              <span className="flex items-center gap-2 font-semibold text-destructive"><TriangleAlert className="h-4 w-4" />تعذر تحميل بيانات المشروع الكاملة</span>
              <span className="text-muted-foreground">{detailError}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetryDetail}><RefreshCw className="ml-1 h-4 w-4" />إعادة المحاولة</Button>
            </div>
          ) : !initialValues ? (
            <div className="space-y-4 p-6" aria-label="جارٍ تحميل بيانات المشروع">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : (
            <ProjectFormBody key={editingProject?.id ?? "new"} {...props} initialValues={initialValues} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectFormBody({ editingProject, initialValues, allProjects, isAdmin, canAssignCategory, isSubmitting, onSubmit, onOpenChange }: ProjectFormDialogProps & { initialValues: ProjectFormValues }) {
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [folderBrowserItems, setFolderBrowserItems] = useState<any[]>([]);
  const [folderBrowserLoading, setFolderBrowserLoading] = useState(false);
  const [folderBrowserCurrentId, setFolderBrowserCurrentId] = useState<string>("root");
  const [folderBrowserPath, setFolderBrowserPath] = useState<{ id: string; name: string }[]>([]);
  const [folderError, setFolderError] = useState(false);

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["companies"],
    queryFn: () => customFetch<CompanyOption[]>(`${API_BASE}/companies`, { responseType: "json" }),
    staleTime: 1000 * 60 * 10,
  });
  const ownerCompanies = companies.filter(c => c.type === "owner");
  const contractorCompanies = companies.filter(c => c.type === "contractor");
  const supervisorCompanies = companies.filter(c => c.type === "supervisor");

  const categoriesQuery = useProjectCategories(canAssignCategory);

  const form = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: initialValues });
  const watchNoSchedule = form.watch("noSchedule");

  const selfId = editingProject?.id ?? null;
  const selfHasChildren = selfId != null && allProjects.some(p => p.parentProjectId === selfId);
  const candidates = parentCandidates(allProjects, selfId);
  const currentParent = form.watch("parentProjectId");
  const hiddenParent = editingProject?.portfolioRelation === "child" && editingProject.parentProjectId == null;

  const browseFolders = async (folderId?: string) => {
    setFolderBrowserLoading(true);
    setFolderError(false);
    try {
      const url = folderId ? `${API_BASE}/onedrive/browse?folderId=${folderId}` : `${API_BASE}/onedrive/browse`;
      const data = await customFetch<{ items?: any[]; parentId: string | null; currentFolderId: string }>(url, { responseType: "json" });
      setFolderBrowserItems(data.items || []);
      setFolderBrowserCurrentId(data.currentFolderId);
    } catch {
      setFolderError(true);
      setFolderBrowserItems([]);
    } finally {
      setFolderBrowserLoading(false);
    }
  };
  const openFolderBrowser = () => {
    setFolderBrowserPath([]);
    setFolderBrowserItems([]);
    setFolderBrowserCurrentId("root");
    setFolderBrowserOpen(true);
    browseFolders();
  };
  const navigateToFolder = (folderId: string, folderName: string) => {
    setFolderBrowserPath(prev => [...prev, { id: folderId, name: folderName }]);
    browseFolders(folderId);
  };
  const navigateUp = () => {
    if (folderBrowserPath.length <= 1) { setFolderBrowserPath([]); browseFolders(); }
    else {
      const newPath = folderBrowserPath.slice(0, -1);
      setFolderBrowserPath(newPath);
      browseFolders(newPath[newPath.length - 1].id);
    }
  };
  const selectFolder = (folderId: string) => {
    form.setValue("onedriveTestResultsFolderId", folderId);
    setFolderBrowserOpen(false);
  };
  const handleCompanySelect = (companyId: string, field: "ownerEntity" | "contractor" | "supervisorEntity") => {
    const company = companies.find(c => String(c.id) === companyId);
    if (company) form.setValue(field, company.name);
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 px-4 py-4 space-y-8 sm:px-6">
                  {/* Section 1: Basic Info */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      البيانات الأساسية
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-muted/30 shadow-sm">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">اسم المشروع</FormLabel>
                            <FormControl><Input {...field} className="h-11 bg-background" placeholder="أدخل اسم المشروع" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">موقع المشروع</FormLabel>
                            <FormControl><Input {...field} className="h-11 bg-background" placeholder="ليبيا - مصراتة" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">حالة المشروع</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange} dir="rtl">
                              <FormControl>
                                <SelectTrigger className="h-11 bg-background"><SelectValue /></SelectTrigger>
                              </FormControl>
                              <SelectContent dir="rtl">
                                <SelectItem value="active">نشط (قيد التنفيذ)</SelectItem>
                                <SelectItem value="completed">مكتمل</SelectItem>
                                <SelectItem value="delayed">منحرف عن الخطة</SelectItem>
                                <SelectItem value="suspended">متوقف</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Section 2: Parties */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      الجهات المشاركة
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-muted/30 shadow-sm">
                      <div className="sm:col-span-2 p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="ownerCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">الجهة المالكة</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "ownerEntity"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر شركة..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {ownerCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="ownerEntity"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المالك كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="contractorCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">المقاول</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "contractor"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر مقاول..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {contractorCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="contractor"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المقاول كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="supervisorCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">الاستشاري المشرف</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "supervisorEntity"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر استشاري..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {supervisorCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="supervisorEntity"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المشرف كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Integrations & Dates */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      الجدول الزمني والربط
                    </h3>
                    
                    <div className="p-5 rounded-2xl border bg-muted/30 shadow-sm space-y-5">
                      <FormField
                        control={form.control}
                        name="noSchedule"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-xl border bg-background p-4 gap-3 shadow-sm hover:border-primary/30 transition-colors">
                            <div className="space-y-0.5 flex-1 min-w-0">
                              <FormLabel className="text-sm font-semibold flex items-center gap-2">
                                <CalendarOff className="h-4 w-4 text-primary shrink-0" />
                                بدون جدول زمني معتمد
                              </FormLabel>
                              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                                عند التفعيل، لن يُحسب الانحراف الزمني أو التأخيرات، وتصبح تواريخ البداية والنهاية اختيارية تماماً.
                              </p>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  field.onChange(checked);
                                  if (checked) {
                                    form.setValue("startDate", "");
                                    form.setValue("expectedEndDate", "");
                                  } else {
                                    form.setValue("startDate", new Date().toISOString().split('T')[0]);
                                    form.setValue("expectedEndDate", new Date(Date.now() + 31536000000).toISOString().split('T')[0]);
                                  }
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      {!watchNoSchedule && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border bg-background shadow-sm">
                          <FormField
                            control={form.control}
                            name="startDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/90">تاريخ البداية الفعلي</FormLabel>
                                <FormControl><Input type="date" {...field} className="h-11" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="expectedEndDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/90">تاريخ النهاية المتوقع</FormLabel>
                                <FormControl><Input type="date" {...field} className="h-11" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}

                      <FormField
                        control={form.control}
                        name="onedriveTestResultsFolderId"
                        render={({ field }) => (
                          <FormItem className="p-4 rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm">
                            <FormLabel className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-500 mb-3 font-semibold">
                              <FlaskConical className="h-4 w-4" />
                              الربط السحابي لنتائج الاختبارات (OneDrive)
                            </FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} placeholder="لم يتم اختيار مجلد لنتائج الاختبارات" dir="ltr" className="text-left text-sm flex-1 bg-background" readOnly />
                              </FormControl>
                              <Button type="button" variant="outline" onClick={openFolderBrowser} className="shrink-0 gap-1.5 bg-background">
                                <FolderOpen className="h-4 w-4" />
                                تصفح
                              </Button>
                              {field.value && (
                                <Button type="button" variant="ghost" size="icon" onClick={() => form.setValue("onedriveTestResultsFolderId", "")} className="shrink-0 text-muted-foreground hover:text-red-500 bg-background border shadow-sm">
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>


          {(isAdmin || canAssignCategory) && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary/80 tracking-wide flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                التنظيم في المحفظة
              </h3>
              <div className="grid grid-cols-1 gap-5 rounded-2xl border bg-muted/30 p-5 shadow-sm sm:grid-cols-2">
                {isAdmin && (
                  <FormField
                    control={form.control}
                    name="parentProjectId"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1.5 text-foreground/90"><Network className="h-4 w-4 text-primary" />المشروع الرئيسي</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange} dir="rtl" disabled={selfHasChildren || hiddenParent}>
                          <FormControl><SelectTrigger className="h-11 bg-background"><SelectValue placeholder="بدون مشروع رئيسي" /></SelectTrigger></FormControl>
                          <SelectContent dir="rtl">
                            <SelectItem value="none">بدون — مشروع مستقل أو رئيسي</SelectItem>
                            {candidates.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                            {currentParent !== "none" && !candidates.some(c => String(c.id) === currentParent) && (
                              <SelectItem value={currentParent} disabled>المشروع الرئيسي الحالي</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {selfHasChildren
                            ? "هذا المشروع رئيسي وله مشاريع فرعية، لذا لا يمكن جعله فرعياً. افصل فروعه أولاً."
                            : hiddenParent
                              ? "هذا المشروع مرتبط بمشروع رئيسي غير متاح لك."
                              : "تجميع تنظيمي فقط؛ يبقى لكل مشروع جدوله الزمني المستقل، ولا يؤثر على ربط مصادر الأنشطة."}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {canAssignCategory && (
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="flex items-center gap-1.5 text-foreground/90"><Tags className="h-4 w-4 text-primary" />التصنيف</FormLabel>
                        {categoriesQuery.isLoading ? (
                          <div className="h-11 animate-pulse rounded-md bg-muted" aria-label="جارٍ تحميل التصنيفات" />
                        ) : categoriesQuery.isError ? (
                          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                            تعذر تحميل التصنيفات
                            <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void categoriesQuery.refetch()}><RefreshCw className="ml-1 h-3 w-3" />إعادة</Button>
                          </div>
                        ) : (
                          <Select value={field.value} onValueChange={field.onChange} dir="rtl">
                            <FormControl><SelectTrigger className="h-11 bg-background"><SelectValue placeholder="بدون تصنيف" /></SelectTrigger></FormControl>
                            <SelectContent dir="rtl">
                              <SelectItem value="none">بدون تصنيف</SelectItem>
                              {(categoriesQuery.data ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                              {field.value !== "none" && !(categoriesQuery.data ?? []).some(c => String(c.id) === field.value) && (
                                <SelectItem value={field.value} disabled>{editingProject?.categoryName ?? "التصنيف الحالي"}</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        )}
                        {!categoriesQuery.isLoading && !categoriesQuery.isError && (categoriesQuery.data ?? []).length === 0 && (
                          <p className="text-xs text-muted-foreground">{isAdmin ? "لا توجد تصنيفات بعد. أضفها من «إدارة التصنيفات»." : "لا توجد تصنيفات متاحة لك حالياً."}</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>
          )}

          {editingProject && isAdmin && (
            <ProjectLinkCodeSettings key={editingProject.id} projectId={editingProject.id} />
          )}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background pb-2 z-10 -mx-2 px-2">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>إلغاء والتراجع</Button>
            <Button type="submit" className="w-full sm:w-auto shadow-md" disabled={isSubmitting}>
              {isSubmitting ? "جاري الحفظ..." : editingProject ? "حفظ تعديلات المشروع" : "تأكيد إضافة المشروع"}
            </Button>
          </div>
        </form>
      </Form>

      <Dialog open={folderBrowserOpen} onOpenChange={setFolderBrowserOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-emerald-600" />
              اختيار مجلد من OneDrive
            </DialogTitle>
          </DialogHeader>

          {folderBrowserPath.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <button type="button" onClick={() => { setFolderBrowserPath([]); browseFolders(); }} className="hover:text-foreground hover:underline">
                OneDrive
              </button>
              {folderBrowserPath.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 rotate-180" />
                  <button
                    type="button"
                    onClick={() => {
                      const newPath = folderBrowserPath.slice(0, i + 1);
                      setFolderBrowserPath(newPath);
                      browseFolders(p.id);
                    }}
                    className="hover:text-foreground hover:underline"
                  >
                    {p.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="border rounded-lg max-h-[350px] overflow-y-auto">
            {folderBrowserLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              </div>
            ) : folderError ? (
              <div className="flex flex-col items-center gap-3 py-10 text-sm text-destructive" role="alert">
                حدث خطأ أثناء تصفح OneDrive
                <Button type="button" variant="outline" size="sm" onClick={() => browseFolders(folderBrowserPath[folderBrowserPath.length - 1]?.id)}><RefreshCw className="ml-1 h-4 w-4" />إعادة المحاولة</Button>
              </div>
            ) : folderBrowserItems.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                لا توجد عناصر في هذا المجلد
              </div>
            ) : (
              <div className="divide-y">
                {folderBrowserPath.length > 0 && (
                  <button
                    type="button"
                    onClick={navigateUp}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-right"
                  >
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">..</span>
                  </button>
                )}
                {folderBrowserItems.filter(i => i.isFolder).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
                    <button
                      type="button"
                      onClick={() => navigateToFolder(item.id, item.name)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-right"
                    >
                      <Folder className="h-5 w-5 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.childCount} عنصر</p>
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => selectFolder(item.id)}
                      className="shrink-0 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                    >
                      اختيار
                    </Button>
                  </div>
                ))}
                {folderBrowserItems.filter(i => !i.isFolder).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 opacity-50">
                    <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                    <p className="text-sm truncate">{item.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {folderBrowserCurrentId !== "root" && (
            <Button
              type="button"
              onClick={() => selectFolder(folderBrowserCurrentId)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              اختيار المجلد الحالي
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
