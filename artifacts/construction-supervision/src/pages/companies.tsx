import { useState, useRef } from "react";
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
        <h1 className="text-xl md:text-2xl font-bold">إدارة الشركات</h1>
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
        <DialogContent className="sm:max-w-[500px]" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingCompany ? "تعديل الشركة" : "إضافة شركة جديدة"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex flex-col items-center gap-3 mb-2">
                <div
                  className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-primary transition-colors overflow-hidden bg-gray-50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="شعار" className="w-full h-full object-contain p-1" />
                  ) : (
                    <div className="text-center">
                      <Image className="h-8 w-8 mx-auto text-gray-400" />
                      <span className="text-xs text-gray-400 mt-1 block">شعار</span>
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
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3 w-3 ml-1" />
                  {logoPreview ? "تغيير الشعار" : "رفع شعار"}
                </Button>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسم الشركة</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>نوع الشركة</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} dir="rtl">
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="owner">مالك</SelectItem>
                        <SelectItem value="contractor">مقاول</SelectItem>
                        <SelectItem value="supervisor">إشراف</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الهاتف</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>البريد الإلكتروني</FormLabel>
                      <FormControl><Input {...field} type="email" /></FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>العنوان</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "جاري الحفظ..." : editingCompany ? "تحديث" : "إضافة"}
              </Button>
            </form>
          </Form>
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
        <div className="flex justify-center py-20 text-muted-foreground">جاري التحميل...</div>
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
