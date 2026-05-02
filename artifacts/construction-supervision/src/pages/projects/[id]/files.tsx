import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { 
  useListFiles,
  useDeleteFile,
  useGetProject,
  getListFilesQueryKey 
} from "@workspace/api-client-react";
import { useTabAccess } from "@/hooks/use-tab-access";
import type { ProjectFile } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  Trash2, ArrowRight, FileText, File as FileIcon, 
  UploadCloud, Download, Search, FolderOpen, FileImage, FileSpreadsheet,
  FileCheck2, Eye, HardDrive
} from "lucide-react";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  image:       { label: "صور",            icon: FileImage,       color: "text-blue-600",    bg: "bg-blue-50",     border: "border-blue-200" },
  pdf:         { label: "مخططات (PDF)",   icon: FileText,        color: "text-red-600",     bg: "bg-red-50",      border: "border-red-200" },
  test_result: { label: "نتائج فحوصات",  icon: FileCheck2,      color: "text-emerald-600", bg: "bg-emerald-50",  border: "border-emerald-200" },
  document:    { label: "مستندات",        icon: FileSpreadsheet, color: "text-amber-600",   bg: "bg-amber-50",    border: "border-amber-200" },
  other:       { label: "أخرى",           icon: FileIcon,        color: "text-slate-600",   bg: "bg-slate-50",    border: "border-slate-200" },
};

function getCategoryConfig(category: string) {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.other;
}

export default function ProjectFiles() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("الملفات");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadCategory, setUploadCategory] = useState("document");
  const [uploadDescription, setUploadDescription] = useState("");
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { canEdit, isHidden } = useTabAccess(projectId, "files", { redirectIfHidden: true });
  const isViewer = !canEdit;
  
  const { data: allFiles, isLoading } = useListFiles(projectId, {}, { query: { enabled: !!projectId } });
  
  const deleteFile = useDeleteFile();

  const categoryFiltered = (allFiles ?? []).filter((f: ProjectFile) =>
    !categoryFilter || categoryFilter === "all" || f.category === categoryFilter
  );

  const filteredFiles = categoryFiltered.filter((f: ProjectFile) =>
    !searchQuery || f.originalName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categoryCounts = (allFiles ?? []).reduce((acc: Record<string, number>, f: ProjectFile) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalSize = (allFiles ?? []).reduce((s: number, f: ProjectFile) => s + f.fileSize, 0);

  const handleDownload = async (file: ProjectFile) => {
    const token = localStorage.getItem("auth_token");
    const url = token ? `${file.fileUrl}?token=${encodeURIComponent(token)}` : file.fileUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.originalName;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteFile.mutateAsync({ projectId, id: deletingId });
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
      toast({ title: "تم حذف الملف" });
    } catch {
      toast({ variant: "destructive", title: "فشل الحذف" });
    } finally {
      setDeletingId(null);
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFileToUpload(droppedFile);
      const ext = droppedFile.name.split('.').pop()?.toLowerCase();
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext ?? '')) {
        setUploadCategory('image');
      } else if (ext === 'pdf') {
        setUploadCategory('pdf');
      } else if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext ?? '')) {
        setUploadCategory('document');
      }
    }
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const isImageFile = (file: ProjectFile) => {
    return file.category === 'image' || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.originalName);
  };

  const getFileUrl = (file: ProjectFile) => {
    const token = localStorage.getItem("auth_token");
    return token ? `${file.fileUrl}?token=${encodeURIComponent(token)}` : file.fileUrl;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">الملفات والمستندات</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {!isLoading && (allFiles ?? []).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${!categoryFilter || categoryFilter === 'all' ? 'ring-2 ring-primary shadow-md' : ''}`}
            onClick={() => setCategoryFilter("all")}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold tabular-nums">{(allFiles ?? []).length}</p>
                <p className="text-[11px] text-muted-foreground truncate">جميع الملفات</p>
              </div>
            </CardContent>
          </Card>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            const count = categoryCounts[key] || 0;
            if (count === 0) return null;
            const Icon = cfg.icon;
            const isActive = categoryFilter === key;
            return (
              <Card 
                key={key}
                className={`cursor-pointer transition-all hover:shadow-md ${isActive ? `ring-2 ring-primary shadow-md` : ''}`}
                onClick={() => setCategoryFilter(isActive ? "all" : key)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${cfg.bg} shrink-0`}>
                    <Icon className={`h-5 w-5 ${cfg.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold tabular-nums">{count}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{cfg.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="بحث في الملفات..." 
            className="pr-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {totalSize > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground px-3 border rounded-md bg-muted/30">
            <HardDrive className="h-3.5 w-3.5" />
            <span>{formatFileSize(totalSize)}</span>
          </div>
        )}
        {!isViewer && (
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { 
            setFileToUpload(null); 
            setUploadDescription(""); 
            setUploadCategory("document");
            setIsDragOver(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2 shrink-0">
              <UploadCloud className="h-4 w-4" /> رفع ملف
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]" dir="rtl">
            <DialogHeader>
              <DialogTitle>رفع ملف جديد</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4 pt-2">
              <div
                className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                  isDragOver ? 'border-primary bg-primary/5' : fileToUpload ? 'border-emerald-400 bg-emerald-50' : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFileToUpload(f);
                    if (f) {
                      const ext = f.name.split('.').pop()?.toLowerCase();
                      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext ?? '')) setUploadCategory('image');
                      else if (ext === 'pdf') setUploadCategory('pdf');
                    }
                  }}
                  className="hidden"
                />
                {fileToUpload ? (
                  <div className="space-y-2">
                    <FileCheck2 className="h-10 w-10 text-emerald-500 mx-auto" />
                    <p className="font-medium text-sm truncate">{fileToUpload.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(fileToUpload.size)}</p>
                    <Button type="button" variant="ghost" size="sm" className="text-xs"
                      onClick={(e) => { e.stopPropagation(); setFileToUpload(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                      تغيير الملف
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <UploadCloud className={`h-10 w-10 mx-auto ${isDragOver ? 'text-primary' : 'text-muted-foreground/40'}`} />
                    <p className="text-sm font-medium">اسحب الملف هنا أو انقر للاختيار</p>
                    <p className="text-xs text-muted-foreground">يدعم جميع أنواع الملفات</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>التصنيف</Label>
                  <Select value={uploadCategory} onValueChange={setUploadCategory}>
                    <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>{cfg.label.replace(/\s*\(.*\)/, '')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>الوصف <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
                  <Input 
                    value={uploadDescription} 
                    onChange={(e) => setUploadDescription(e.target.value)} 
                    placeholder="وصف مختصر"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={isUploading || !fileToUpload} className="gap-2 min-w-[100px]">
                  {isUploading ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      جاري الرفع...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4" />
                      رفع الملف
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner text="جاري تحميل الملفات..." />
      ) : filteredFiles.length === 0 ? (
        <Card className="border-dashed">
          <EmptyState
            icon={<FolderOpen className="h-7 w-7 text-muted-foreground/60" />}
            title={searchQuery ? "لا توجد نتائج" : "لا توجد ملفات"}
            description={searchQuery ? `لم يتم العثور على ملفات تطابق "${searchQuery}"` : "ارفع ملفات المشروع مثل المخططات والصور والمستندات"}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredFiles.map((file: ProjectFile) => {
            const cfg = getCategoryConfig(file.category);
            const Icon = cfg.icon;
            const showPreview = isImageFile(file);
            return (
              <Card key={file.id} className="overflow-hidden flex flex-col group hover:shadow-lg transition-all duration-200">
                {showPreview ? (
                  <div 
                    className="h-36 bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer relative"
                    onClick={() => setPreviewFile(file)}
                  >
                    <img 
                      src={getFileUrl(file)} 
                      alt={file.originalName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'hidden'; }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Eye className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                  </div>
                ) : (
                  <div className={`h-24 ${cfg.bg} flex items-center justify-center`}>
                    <Icon className={`h-12 w-12 ${cfg.color} opacity-60`} />
                  </div>
                )}
                
                <CardContent className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm line-clamp-2 flex-1 leading-snug" title={file.originalName}>
                      {file.originalName}
                    </h4>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.color} ${cfg.border} border`}>
                      {cfg.label.replace(/\s*\(.*\)/, '')}
                    </Badge>
                  </div>
                  
                  {file.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {file.description}
                    </p>
                  )}
                  
                  <div className="mt-auto pt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t">
                    <span className="tabular-nums font-medium" dir="ltr">{formatFileSize(file.fileSize)}</span>
                    <span className="tabular-nums">{fmtDate(file.uploadedAt)}</span>
                  </div>
                </CardContent>

                <div className="px-3 pb-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5 h-8 text-xs" onClick={() => handleDownload(file)}>
                    <Download className="h-3.5 w-3.5" /> تحميل
                  </Button>
                  {!isViewer && (
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeletingId(file.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden" dir="rtl">
          {previewFile && (
            <>
              <div className="bg-black flex items-center justify-center max-h-[70vh] min-h-[300px]">
                <img 
                  src={getFileUrl(previewFile)} 
                  alt={previewFile.originalName} 
                  className="max-w-full max-h-[70vh] object-contain"
                />
              </div>
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{previewFile.originalName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatFileSize(previewFile.fileSize)} · {fmtDate(previewFile.uploadedAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => handleDownload(previewFile)}>
                  <Download className="h-3.5 w-3.5" /> تحميل
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذا الملف؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
