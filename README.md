import { useState, useRef } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Edit2, Building2, Upload, Phone, Mail, MapPin, Image } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

interface Company {
  id: number;
  name: string;
  type: "owner" | "contractor" | "supervisor";
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

const typeLabels: Record<string, string> = {
  owner: "مالك",
  contractor: "مقاول",
  supervisor: "إشراف",
};

const typeBadgeColors: Record<string, string> = {
  owner: "bg-blue-500 hover:bg-blue-600 text-white",
  contractor: "bg-amber-500 hover:bg-amber-600 text-white",
  supervisor: "bg-emerald-500 hover:bg-emerald-600 text-white",
};

const companySchema = z.object({
  name: z.string().min(1, "اسم الشركة مطلوب"),
  type: z.enum(["owner", "contractor", "supervisor"]),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

export default function Companies() {
  usePageTitle("الشركات");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const res = await authFetch(`${API}/companies`);
      if (!res.ok) throw new Error("فشل تحميل الشركات");
      return res.json();
    },
  });

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: "", type: "owner", phone: "", email: "", address: "" },
  });

  const openCreate = () => {
    setEditingCompany(null);
    setLogoFile(null);
    setLogoPreview(null);
    form.reset({ name: "", type: "owner", phone: "", email: "", address: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (c: Company) => {
    setEditingCompany(c);
    setLogoFile(null);
    setLogoPreview(c.logoUrl ? `${API.replace("/api", "")}${c.logoUrl}` : null);
    form.reset({
      name: c.name,
      type: c.type,
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
    });
    setIsDialogOpen(true);
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const createMutation = useMutation({
    mutationFn: async (values: CompanyFormValues) => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("type", values.type);
      if (values.phone) formData.append("phone", values.phone);
      if (values.email) formData.append("email", values.email);
      if (values.address) formData.append("address", values.address);
      if (logoFile) formData.append("logo", logoFile);

      const res = await authFetch(`${API}/companies`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("فشل إنشاء الشركة");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast({ title: "تم إنشاء الشركة بنجاح" });
      setIsDialogOpen(false);
    },
    onError: () => toast({ variant: "destructive", title: "فشل إنشاء الشركة" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: CompanyFormValues) => {
      if (!editingCompany) return;
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("type", values.type);
      if (values.phone) formData.append("phone", values.phone);
      if (values.email) formData.append("email", values.email);
      if (values.address) formData.append("address", values.address);
      if (logoFile) formData.append("logo", logoFile);

      const res = await authFetch(`${API}/companies/${editingCompany.id}`, { method: "PATCH", body: formData });
      if (!res.ok) throw new Error("فشل تحديث الشركة");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast({ title: "تم تحديث الشركة بنجاح" });
      setIsDialogOpen(false);
    },
    onError: () => toast({ variant: "destructive", title: "فشل تحديث الشركة" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`${API}/companies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("فشل حذف الشركة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast({ title: "تم حذف الشركة بنجاح" });
      setDeletingCompany(null);
    },
    onError: () => toast({ variant: "destructive", title: "فشل حذف الشركة" }),
  });

  const onSubmit = (values: CompanyFormValues) => {
    if (editingCompany) {
      updateMutation.mutate(values);
    } else {
      createMutation.mutate(values);
    }
  };

  const filtered = typeFilter && typeFilter !== "all"
    ? companies.filter(c => c.type === typeFilter)
    : companies;

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 rounded-xl">
            <Building2 className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold">إدارة الشركات</h1>
            <p className="text-sm text-muted-foreground mt-0.5">الشركات المالكة والمقاولين وجهات الإشراف</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={typeFilter ?? "all"} onValueChange={(v) => setTypeFilter(v === "all" ? null : v)} dir="rtl">
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="الكل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="owner">مالك</SelectItem>
              <SelectItem value="contractor">مقاول</SelectItem>
              <SelectItem value="supervisor">إشراف</SelectItem>
            </SelectContent>
          </Select>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            شركة جديدة
          </Button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) { setEditingCompany(null); form.reset(); setLogoFile(null); setLogoPreview(null); }
      }}>
        <DialogContent className="sm:max-w-[650px] p-0 overflow-hidden" dir="rtl">
          <div className="bg-gradient-to-br from-amber-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 rounded-xl">
                  <Building2 className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <DialogTitle className="text-xl">{editingCompany ? "تعديل بيانات الشركة" : "إضافة شركة جديدة"}</DialogTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {editingCompany ? "تحديث بيانات الشركة وتعديل معلومات التواصل." : "أدخل بيانات الشركة الأساسية وارفع شعارها."}
                  </p>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="px-6 py-4 space-y-8">
                
                <div className="flex flex-col items-center justify-center p-6 bg-gradient-to-br from-muted/30 to-background rounded-2xl border shadow-sm">
                  <div className="flex flex-col items-center gap-4">
                    <div
                      className="w-28 h-28 rounded-2xl border-2 border-dashed border-border/60 hover:border-amber-500/50 flex items-center justify-center cursor-pointer transition-all overflow-hidden bg-background hover:bg-amber-500/5 shadow-sm group"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {logoPreview ? (
                        <img src={logoPreview} alt="شعار" loading="lazy" decoding="async" className="w-full h-full object-contain p-1 group-hover:scale-105 transition-transform" />
                      ) : (
                        <div className="text-center group">
                          <Image className="h-10 w-10 mx-auto text-muted-foreground group-hover:text-amber-500 transition-colors" />
                          <span className="text-xs text-muted-foreground group-hover:text-amber-600 mt-2 block transition-colors">شعار الشركة</span>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoSelect}
                    />
                    <Button type="button" variant="outline" size="sm" className="rounded-full text-xs hover:bg-amber-50" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3 w-3 ml-1.5 text-amber-600" />
                      {logoPreview ? "تغيير الشعار" : "رفع شعار جديد"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-amber-600/80 uppercase tracking-wide flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                    البيانات الأساسية
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel className="text-foreground/90">اسم الشركة</FormLabel>
                          <FormControl><Input {...field} placeholder="أدخل اسم الشركة" className="bg-background" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel className="text-foreground/90">نوع الشركة</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value} dir="rtl">
                            <FormControl>
                              <SelectTrigger className="bg-background"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="owner">جهة مالكة</SelectItem>
                              <SelectItem value="contractor">شركة مقاولات</SelectItem>
                              <SelectItem value="supervisor">جهة إشراف هندسي</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">رقم الهاتف (اختياري)</FormLabel>
                          <FormControl><Input {...field} placeholder="05XXXXXXXX" dir="ltr" className="text-right bg-background" /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">البريد الإلكتروني (اختياري)</FormLabel>
                          <FormControl><Input {...field} type="email" placeholder="example@company.com" dir="ltr" className="text-right bg-background" /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel className="text-foreground/90">العنوان (اختياري)</FormLabel>
                          <FormControl><Input {...field} placeholder="أدخل المقر الرئيسي" className="bg-background" /></FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                  <Button type="submit" className="w-full sm:w-auto shadow-md" disabled={isSubmitting}>
                    {isSubmitting ? "جاري الحفظ..." : editingCompany ? "تحديث بيانات الشركة" : "إضافة الشركة"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingCompany} onOpenChange={(o) => !o && setDeletingCompany(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الشركة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف "{deletingCompany?.name}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingCompany && deleteMutation.mutate(deletingCompany.id)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <LoadingSpinner text="جاري تحميل الشركات..." />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-12 w-12 mb-4" />
            <p className="text-lg font-semibold">لا توجد شركات</p>
            <p className="text-sm">أضف شركات لربطها بالمشاريع وعرض شعاراتها في التقارير</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((company) => (
            <Card key={company.id} className="relative group hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-xl border bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {company.logoUrl ? (
                      <img
                        src={`${API.replace("/api", "")}${company.logoUrl}`}
                        alt={company.name}
                        className="w-full h-full object-contain p-1"
                      />
                    ) : (
                      <Building2 className="h-8 w-8 text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base truncate">{company.name}</h3>
                    <Badge className={`${typeBadgeColors[company.type]} mt-1 text-xs`}>
                      {typeLabels[company.type]}
                    </Badge>
                    {company.phone && (
                      <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" />{company.phone}
                      </div>
                    )}
                    {company.email && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground truncate">
                        <Mail className="h-3 w-3" />{company.email}
                      </div>
                    )}
                    {company.address && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground truncate">
                        <MapPin className="h-3 w-3" />{company.address}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(company)}>
                    <Edit2 className="h-3 w-3 ml-1" />
                    تعديل
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeletingCompany(company)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
