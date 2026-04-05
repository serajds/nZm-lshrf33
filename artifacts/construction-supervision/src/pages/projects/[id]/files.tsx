import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useListFiles,
  useDeleteFile,
  useGetProject,
  getListFilesQueryKey 
} from "@workspace/api-client-react";
import type { ProjectFile } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash2, ArrowRight, FileText, Image as ImageIcon, File as FileIcon, UploadCloud, Download } from "lucide-react";

export default function ProjectFiles() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState("document");
  const [uploadDescription, setUploadDescription] = useState("");
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  
  const { data: files, isLoading } = useListFiles(projectId, {
    category: categoryFilter && categoryFilter !== "all" ? categoryFilter : undefined
  }, { query: { enabled: !!projectId } });
  
  const deleteFile = useDeleteFile();

  const handleDelete = async (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذا الملف؟")) {
      try {
        await deleteFile.mutateAsync({ projectId, id });
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        toast({ title: "تم حذف الملف" });
      } catch {
        toast({ variant: "destructive", title: "فشل الحذف" });
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileToUpload) {
      toast({ variant: "destructive", title: "الرجاء اختيار ملف" });
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", fileToUpload);
      formData.append("category", uploadCategory);
      if (uploadDescription) {
        formData.append("description", uploadDescription);
      }

      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
      setIsDialogOpen(false);
      setFileToUpload(null);
      setUploadDescription("");
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast({ title: "تم رفع الملف بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل رفع الملف" });
    } finally {
      setIsUploading(false);
    }
  };

  const getFileIcon = (category: string) => {
    switch (category) {
      case 'image': return <ImageIcon className="h-8 w-8 text-blue-500" />;
      case 'pdf': return <FileText className="h-8 w-8 text-destructive" />;
      case 'test_result': return <FileText className="h-8 w-8 text-emerald-600" />;
      default: return <FileIcon className="h-8 w-8 text-muted-foreground" />;
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'image': return 'صورة';
      case 'pdf': return 'مخطط / PDF';
      case 'test_result': return 'نتيجة فحص';
      case 'document': return 'مستند';
      default: return 'أخرى';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{project?.name} - الملفات</h1>
      </div>

      <Tabs defaultValue="files" className="w-full" dir="rtl">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
          <TabsTrigger value="summary" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}`)}>ملخص المشروع</TabsTrigger>
          <TabsTrigger value="activities" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/activities`)}>الجدول الزمني</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/reports`)}>التقارير</TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3">الملفات</TabsTrigger>
          <TabsTrigger value="deviation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/deviation`)}>تحليل الانحراف</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="w-full sm:w-48">
          <Select value={categoryFilter ?? "all"} onValueChange={(v) => setCategoryFilter(v)}>
            <SelectTrigger>
              <SelectValue placeholder="تصنيف الملف" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="image">صور</SelectItem>
              <SelectItem value="pdf">مخططات (PDF)</SelectItem>
              <SelectItem value="test_result">نتائج فحوصات</SelectItem>
              <SelectItem value="document">مستندات</SelectItem>
              <SelectItem value="other">أخرى</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { 
            setFileToUpload(null); 
            setUploadDescription(""); 
            setUploadCategory("document");
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UploadCloud className="h-4 w-4" /> رفع ملف
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]" dir="rtl">
            <DialogHeader>
              <DialogTitle>رفع ملف جديد</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>الملف</Label>
                <Input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={(e) => setFileToUpload(e.target.files?.[0] ?? null)}
                  className="cursor-pointer"
                />
              </div>
              <div className="space-y-2">
                <Label>التصنيف</Label>
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
                  <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="image">صورة</SelectItem>
                    <SelectItem value="pdf">مخطط (PDF)</SelectItem>
                    <SelectItem value="test_result">نتيجة فحص</SelectItem>
                    <SelectItem value="document">مستند</SelectItem>
                    <SelectItem value="other">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الوصف (اختياري)</Label>
                <Input 
                  value={uploadDescription} 
                  onChange={(e) => setUploadDescription(e.target.value)} 
                  placeholder="أدخل وصفاً قصيراً للملف"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={isUploading || !fileToUpload}>
                  {isUploading ? "جاري الرفع..." : "رفع الملف"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading ? (
          <div className="col-span-full text-center py-12">جاري التحميل...</div>
        ) : (files ?? []).length === 0 ? (
          <div className="col-span-full text-center py-12 bg-card rounded-lg border border-dashed">
            <FileIcon className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
            <h3 className="text-lg font-medium">لا توجد ملفات</h3>
            <p className="text-muted-foreground text-sm mt-1">لم يتم رفع أي ملفات مطابقة للبحث</p>
          </div>
        ) : (
          (files ?? []).map((file: ProjectFile) => (
            <Card key={file.id} className="overflow-hidden flex flex-col group">
              <CardContent className="p-4 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2 bg-muted rounded-lg shrink-0">
                    {getFileIcon(file.category)}
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {getCategoryLabel(file.category)}
                  </Badge>
                </div>
                
                <h4 className="font-medium text-sm line-clamp-2 mb-1" title={file.originalName}>
                  {file.originalName}
                </h4>
                
                {file.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1 mb-2">
                    {file.description}
                  </p>
                )}
                
                <div className="mt-auto pt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span dir="ltr">{formatFileSize(file.fileSize)}</span>
                  <span dir="ltr">{new Date(file.uploadedAt).toLocaleDateString('ar-SA')}</span>
                </div>
              </CardContent>
              <div className="bg-muted px-4 py-2 border-t flex justify-between gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <Button variant="secondary" size="sm" className="flex-1 gap-1" asChild>
                  <a href={file.fileUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="h-3 w-3" /> تحميل
                  </a>
                </Button>
                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => handleDelete(file.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
