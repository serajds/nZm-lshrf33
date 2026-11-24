import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { 
  useListFiles,
  useDeleteFile,
  useGetProject,
  getListFilesQueryKey,
  fetchWithSession,
} from "@workspace/api-client-react";
import { useTabAccess } from "@/hooks/use-tab-access";
import type { ProjectFile } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  FileCheck2, Eye, HardDrive, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { ProtectedImage, downloadProtectedAsset } from "@/components/protected-image";

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
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 24;
  const [uploadCategory, setUploadCategory] = useState("document");
  const [uploadDescription, setUploadDescription] = useState("");
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { canEdit, isHidden } = useTabAccess(projectId, "files", { redirectIfHidden: true });
  const isViewer = !canEdit;
  
  const listParams = {
    page: currentPage,
    pageSize,
    category: categoryFilter && categoryFilter !== "all" ? categoryFilter as
      "image" | "pdf" | "test_result" | "document" | "other" : undefined,
    search: searchQuery.trim() || undefined,
  };
  const {
    data: filePage,
    isLoading,
    isError,
    refetch,
  } = useListFiles(projectId, listParams, { query: { enabled: !!projectId } });
  const pageFiles = filePage?.files ?? [];
  const summary = filePage?.summary;
  
  const deleteFile = useDeleteFile();
  useEffect(() => {
    setSelectedImageIds([]);
  }, [projectId]);

  useEffect(() => {
    if (filePage && currentPage > Math.max(filePage.totalPages, 1)) {
      setCurrentPage(Math.max(filePage.totalPages, 1));
    }
  }, [currentPage, filePage]);

  const visibleImageFiles = pageFiles.filter((file: ProjectFile) => file.category === "image");
  const visibleImageIds = new Set(visibleImageFiles.map((f: ProjectFile) => f.id));
  const selectedVisibleImageCount = selectedImageIds.filter(id => visibleImageIds.has(id)).length;
  const selectedImageCount = selectedImageIds.length;

  const handleDownload = async (file: ProjectFile) => {
    try {
      await downloadProtectedAsset(file.fileUrl, file.originalName);
    } catch {
      toast({ variant: "destructive", title: "فشل تحميل الملف" });
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteFile.mutateAsync({ projectId, id: deletingId });
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
      setSelectedImageIds(current => current.filter(id => id !== deletingId));
      if (pageFiles.some(file => file.id === deletingId && file.category === "image")) {
        queryClient.invalidateQueries({
          predicate: query => typeof query.queryKey[0] === "string"
            && query.queryKey[0].startsWith(`/api/projects/${projectId}/reports`),
        });
      }
      toast({ title: "تم حذف الملف" });
    } catch {
      toast({ variant: "destructive", title: "فشل الحذف" });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleVisibleImageSelection = (checked: boolean) => {
    setSelectedImageIds(current => {
      if (checked) return [...new Set([...current, ...visibleImageFiles.map((file: ProjectFile) => file.id)])];
      return current.filter(id => !visibleImageIds.has(id));
    });
  };

  const toggleImageSelection = (id: number, checked: boolean) => {
    setSelectedImageIds(current => checked
      ? [...new Set([...current, id])]
      : current.filter(selectedId => selectedId !== id));
  };

  const handleBulkDeleteImages = async () => {
    const ids = selectedImageIds;
    if (ids.length === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    let didAttempt = false;
    let totalDeleted = 0;
    let totalRequested = 0;
    try {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        didAttempt = true;
        const response = await fetchWithSession(`/api/projects/${projectId}/files/images/bulk`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const result = await response.json().catch(() => null) as
          | { requestedCount?: number; deletedCount?: number; error?: string }
          | null;
        if (!response.ok || !result) {
          throw new Error(result?.error || "تعذّر حذف الصور المحددة");
        }
        totalRequested += result.requestedCount ?? batch.length;
        totalDeleted += result.deletedCount ?? 0;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
        queryClient.invalidateQueries({
          predicate: query => typeof query.queryKey[0] === "string"
            && query.queryKey[0].startsWith(`/api/projects/${projectId}/reports`),
        }),
      ]);
      setSelectedImageIds([]);
      setIsBulkDeleteConfirmOpen(false);
      if (totalDeleted < totalRequested) {
        toast({
          variant: "destructive",
          title: `حُذف ${totalDeleted} من ${totalRequested} صورة`,
          description: "بقيت بعض الصور في الملفات؛ حدّث القائمة وتحقق منها.",
        });
      } else {
        toast({ title: `تم حذف ${totalDeleted} صورة من الملفات والتقارير` });
      }
    } catch (error) {
      if (didAttempt) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
          queryClient.invalidateQueries({
            predicate: query => typeof query.queryKey[0] === "string"
              && query.queryKey[0].startsWith(`/api/projects/${projectId}/reports`),
          }),
        ]);
        setSelectedImageIds([]);
        setIsBulkDeleteConfirmOpen(false);
      }
      toast({
        variant: "destructive",
        title: didAttempt
          ? `تعذّر إكمال الحذف؛ تم تأكيد حذف ${totalDeleted} صورة`
          : "تعذّر حذف الصور المحددة",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsBulkDeleting(false);
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

      const response = await fetchWithSession(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(`Upload failed with HTTP ${response.status}`);

      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
      setCurrentPage(1);
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

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="page-hero flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="relative z-10 mt-0.5 shrink-0 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="relative z-10 text-lg font-bold leading-tight text-white md:text-2xl">{project?.name}</h1>
          <p className="relative z-10 mt-1 text-sm text-white/65">الملفات والمستندات</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {!isLoading && (summary?.totalFiles ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card 
            className={`surface-card surface-card-hover cursor-pointer ${!categoryFilter || categoryFilter === 'all' ? 'ring-2 ring-primary shadow-md' : ''}`}
            onClick={() => { setCategoryFilter("all"); setCurrentPage(1); }}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold tabular-nums">{summary?.totalFiles ?? 0}</p>
                <p className="text-[11px] text-muted-foreground truncate">جميع الملفات</p>
              </div>
            </CardContent>
          </Card>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            const count = summary?.categories[key as keyof typeof summary.categories] ?? 0;
            const Icon = cfg.icon;
            const isActive = categoryFilter === key;
            return (
              <Card 
                key={key}
                className={`surface-card surface-card-hover cursor-pointer ${isActive ? `ring-2 ring-primary shadow-md` : ''}`}
                onClick={() => { setCategoryFilter(isActive ? "all" : key); setCurrentPage(1); }}
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
            className="h-11 rounded-xl pr-9"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>
        {(summary?.totalSize ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground px-3 border rounded-md bg-muted/30">
            <HardDrive className="h-3.5 w-3.5" />
            <span>{formatFileSize(summary?.totalSize ?? 0)}</span>
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
          <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden" dir="rtl">
            <div className="bg-muted/40 p-6 pb-4 border-b border-border/50">
              <DialogHeader>
                <DialogTitle className="text-xl">رفع ملف جديد</DialogTitle>
              </DialogHeader>
            </div>
            <form onSubmit={handleUpload} className="p-6 pt-4 space-y-6">
              <div
                className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                  isDragOver ? 'border-primary bg-primary/5 scale-[1.02]' : fileToUpload ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-500/10' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
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
                  <div className="space-y-3">
                    <div className="mx-auto w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                      <FileCheck2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm truncate max-w-[250px] mx-auto text-foreground/90">{fileToUpload.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatFileSize(fileToUpload.size)}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="mt-2 text-xs h-8"
                      onClick={(e) => { e.stopPropagation(); setFileToUpload(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                      تغيير الملف
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isDragOver ? 'bg-primary/20' : 'bg-muted'}`}>
                      <UploadCloud className={`h-8 w-8 ${isDragOver ? 'text-primary' : 'text-muted-foreground/60'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground/90">اسحب الملف هنا أو انقر للاختيار</p>
                      <p className="text-xs text-muted-foreground mt-1">يدعم جميع أنواع الملفات المسموح بها</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-muted/30 shadow-sm">
                <div className="space-y-2">
                  <Label className="text-foreground/90">التصنيف</Label>
                  <Select value={uploadCategory} onValueChange={setUploadCategory}>
                    <SelectTrigger className="h-11 bg-background" dir="rtl"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <cfg.icon className={`h-4 w-4 ${cfg.color}`} />
                            {cfg.label.replace(/\s*\(.*\)/, '')}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/90">الوصف <span className="text-muted-foreground text-[10px] font-normal px-1.5 py-0.5 bg-muted rounded">(اختياري)</span></Label>
                  <Input 
                    className="h-11 bg-background"
                    value={uploadDescription} 
                    onChange={(e) => setUploadDescription(e.target.value)} 
                    placeholder="وصف مختصر للملف"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                <Button type="submit" disabled={isUploading || !fileToUpload} className="w-full sm:w-auto shadow-md gap-2">
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الرفع...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4" />
                      تأكيد ورفع الملف
                    </>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {!isViewer && (visibleImageFiles.length > 0 || selectedImageCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={visibleImageFiles.length > 0 && selectedVisibleImageCount === visibleImageFiles.length
                ? true
                : selectedVisibleImageCount > 0 ? "indeterminate" : false}
              onCheckedChange={checked => toggleVisibleImageSelection(checked === true)}
              disabled={visibleImageFiles.length === 0 || isBulkDeleting}
              aria-label="تحديد الصور الظاهرة"
            />
            <span>
              {visibleImageFiles.length > 0
                ? `تحديد الصور الظاهرة (${visibleImageFiles.length})`
                : "لا توجد صور ظاهرة ضمن التصفية الحالية"}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {selectedImageCount > 0 && (
              <>
                <span className="text-sm text-muted-foreground">
                  المحدد: {selectedImageCount} صورة
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setIsBulkDeleteConfirmOpen(true)}
                  disabled={isBulkDeleting || deleteFile.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  حذف المحدد
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedImageIds([])}
                  disabled={isBulkDeleting}
                >
                  إلغاء التحديد
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner text="جاري تحميل الملفات..." />
      ) : isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-destructive">تعذّر تحميل ملفات المشروع. تحقق من الاتصال وحاول مرة أخرى.</p>
            <Button variant="outline" onClick={() => void refetch()}>إعادة المحاولة</Button>
          </CardContent>
        </Card>
      ) : pageFiles.length === 0 ? (
        <Card className="border-dashed">
          <EmptyState
            icon={<FolderOpen className="h-7 w-7 text-muted-foreground/60" />}
            title={searchQuery || (categoryFilter && categoryFilter !== "all") ? "لا توجد نتائج" : "لا توجد ملفات"}
            description={searchQuery
              ? `لم يتم العثور على ملفات تطابق "${searchQuery}"`
              : categoryFilter && categoryFilter !== "all"
                ? "لا توجد ملفات ضمن هذا التصنيف"
                : "ارفع ملفات المشروع مثل المخططات والصور والمستندات"}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pageFiles.map((file: ProjectFile) => {
            const cfg = getCategoryConfig(file.category);
            const Icon = cfg.icon;
            const showPreview = isImageFile(file);
            return (
              <Card
                key={file.id}
                className={`overflow-hidden flex flex-col group hover:shadow-lg transition-all duration-200 ${selectedImageIds.includes(file.id) ? "ring-2 ring-primary" : ""}`}
              >
                {showPreview ? (
                  <div 
                    className="h-36 bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer relative"
                    onClick={() => setPreviewFile(file)}
                  >
                    <ProtectedImage
                      src={file.fileUrl}
                      alt={file.originalName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'hidden'; }}
                    />
                    {!isViewer && file.category === "image" && (
                      <div
                        className="absolute right-2 top-2 z-10 rounded-md bg-background/90 p-1 shadow"
                        onClick={event => event.stopPropagation()}
                        onPointerDown={event => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedImageIds.includes(file.id)}
                          onCheckedChange={checked => toggleImageSelection(file.id, checked === true)}
                          aria-label={`تحديد الصورة ${file.originalName}`}
                        />
                      </div>
                    )}
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

      {!isLoading && !isError && filePage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3">
          <p className="text-sm text-muted-foreground">
            النتائج: <span className="font-semibold text-foreground">{filePage.total}</span>
            {" · "}
            الصفحة <span className="font-semibold text-foreground">{filePage.page}</span>
            {" من "}
            <span className="font-semibold text-foreground">{Math.max(filePage.totalPages, 1)}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronRight className="ml-1 h-4 w-4" /> السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(page => Math.min(filePage.totalPages, page + 1))}
              disabled={currentPage >= filePage.totalPages}
            >
              التالي <ChevronLeft className="mr-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden" dir="rtl">
          {previewFile && (
            <>
              <div className="bg-black flex items-center justify-center max-h-[70vh] min-h-[300px]">
                <ProtectedImage
                  src={previewFile.fileUrl}
                  alt={previewFile.originalName} 
                  loading="lazy"
                  decoding="async"
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
            <AlertDialogDescription>
              {pageFiles.find(file => file.id === deletingId)?.category === "image"
                ? "سيُحذف الملف نهائيًا من التخزين ومن كل تقرير يستخدم هذه الصورة. لا يمكن التراجع عن ذلك."
                : "هل أنت متأكد من حذف هذا الملف؟ لا يمكن التراجع عن هذا الإجراء."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={open => {
        if (!isBulkDeleting) setIsBulkDeleteConfirmOpen(open);
      }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الصور المحددة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف {selectedImageCount} صورة نهائيًا من ملفات المشروع والتخزين، وإزالتها من التقارير التي تستخدمها. لا يمكن التراجع عن ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={isBulkDeleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkDeleting || selectedImageCount === 0}
              onClick={event => {
                event.preventDefault();
                void handleBulkDeleteImages();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" /> جارٍ الحذف...</> : "حذف الصور"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
