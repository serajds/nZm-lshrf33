import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects, useCreateProject, useUpdateProject, useDeleteProject,
  getListProjectsQueryKey, getGetProjectQueryKey, getGetProjectSummaryQueryKey, getProject, getProjectSummary,
} from "@workspace/api-client-react";
import { Building2, Network, Plus, RefreshCw, SearchX, Tags, TriangleAlert, Layers, GitBranch } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useProjectCategories } from "@/hooks/use-project-categories";
import {
  EMPTY_FILTERS, apiErrorMessage, buildPortfolioView, hasActiveFilters, ownerOptions, portfolioCounters,
  type PortfolioFilters,
} from "@/lib/project-portfolio";
import type { PortfolioProject } from "@/components/projects/types";
import { ProjectFormDialog, emptyFormValues, formValuesToPayload, projectToFormValues, type ProjectFormValues } from "@/components/projects/project-form-dialog";
import { DeleteProjectDialog } from "@/components/projects/delete-project-dialog";
import { CategoryManagerDialog } from "@/components/projects/category-manager";
import { MainProjectCard, ProjectCard, type CardActions } from "@/components/projects/portfolio-card";
import { PortfolioTable } from "@/components/projects/portfolio-table";
import { PortfolioCountersStrip, PortfolioFiltersBar } from "@/components/projects/portfolio-filters";

function SectionHeading({ icon, title, hint, count }: { icon: React.ReactNode; title: string; hint: string; count: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-lg bg-primary/10 p-1.5 text-primary">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <span className="font-mono text-sm text-muted-foreground">{count}</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-label="جاري تحميل المشاريع" aria-busy>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted" />)}</div>
      <div className="h-36 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />)}</div>
    </div>
  );
}

export default function Projects() {
  usePageTitle("المشاريع");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canManageProjects = isAdmin; // create/delete are admin-only server-side

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PortfolioFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [initialValues, setInitialValues] = useState<ProjectFormValues | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<PortfolioProject | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const editRequest = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.search === search ? f : { ...f, search })), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Fetched ONCE unfiltered; all filtering happens on the client.
  const listQuery = useListProjects(undefined, {
    query: { staleTime: 1000 * 60 * 5, placeholderData: (prev: unknown) => prev } as any,
  });
  const projects = listQuery.data as PortfolioProject[] | undefined;
  const all = useMemo(() => projects ?? [], [projects]);

  const categoriesQuery = useProjectCategories();
  const categoriesState = categoriesQuery.isLoading ? "loading" : categoriesQuery.isError ? "error" : "ok";

  const counters = useMemo(() => (projects ? portfolioCounters(projects) : null), [projects]);
  const portfolio = useMemo(() => buildPortfolioView(all, filters), [all, filters]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  const categoryUsage = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of all) if (p.categoryId != null) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [all]);
  const filtering = hasActiveFilters(filters) || search.trim() !== filters.search.trim();

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const prefetchProject = (projectId: number) => {
    queryClient.prefetchQuery({ queryKey: getGetProjectQueryKey(projectId), queryFn: ({ signal }) => getProject(projectId, { signal }), staleTime: 1000 * 60 * 5 });
    queryClient.prefetchQuery({ queryKey: getGetProjectSummaryQueryKey(projectId), queryFn: ({ signal }) => getProjectSummary(projectId, { signal }), staleTime: 1000 * 60 * 5 });
  };

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });

  const openCreate = (parent?: PortfolioProject) => {
    editRequest.current += 1;
    setEditingProject(null);
    setDetailError(null);
    setInitialValues(emptyFormValues(parent && isAdmin ? parent.id : null));
    setDialogOpen(true);
  };

  // List rows are lightweight (no OneDrive folder) — load the full record before filling the form.
  const loadDetail = async (p: PortfolioProject) => {
    const req = ++editRequest.current;
    setInitialValues(null);
    setDetailError(null);
    try {
      const full = await queryClient.fetchQuery({ queryKey: getGetProjectQueryKey(p.id), queryFn: ({ signal }) => getProject(p.id, { signal }), staleTime: 0 });
      if (req !== editRequest.current) return;
      setInitialValues(projectToFormValues({ ...p, ...(full as PortfolioProject) }));
    } catch (e) {
      if (req === editRequest.current) setDetailError(apiErrorMessage(e, "تعذر تحميل بيانات المشروع"));
    }
  };
  const openEdit = (p: PortfolioProject) => {
    setEditingProject(p);
    setDialogOpen(true);
    void loadDetail(p);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) { editRequest.current += 1; setEditingProject(null); setInitialValues(null); setDetailError(null); }
  };

  const canAssignCategory = isAdmin || (editingProject ? editingProject.canManage === true : false);

  const onSubmit = async (values: ProjectFormValues) => {
    const payload = formValuesToPayload(values, { isAdmin, canAssignCategory });
    try {
      if (editingProject) {
        await updateProject.mutateAsync({ id: editingProject.id, data: payload as any });
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(editingProject.id) });
        toast({ title: "تم تحديث المشروع بنجاح" });
      } else {
        await createProject.mutateAsync({ data: payload as any });
        toast({ title: "تم إنشاء المشروع بنجاح" });
      }
      invalidateList();
      closeDialog(false);
    } catch (e) {
      toast({ variant: "destructive", title: editingProject ? "فشل تحديث المشروع" : "فشل إنشاء المشروع", description: apiErrorMessage(e, "حدث خطأ غير متوقع") });
    }
  };

  const confirmDelete = async (p: PortfolioProject) => {
    try {
      await deleteProject.mutateAsync({ id: p.id });
      invalidateList();
      toast({ title: "تم حذف المشروع بنجاح" });
    } catch (e) {
      toast({ variant: "destructive", title: "فشل حذف المشروع", description: apiErrorMessage(e, "حدث خطأ غير متوقع") });
    } finally {
      setDeletingProject(null);
    }
  };

  const unlink = async (p: PortfolioProject) => {
    setUnlinkingId(p.id);
    try {
      await updateProject.mutateAsync({ id: p.id, data: { parentProjectId: null } as any });
      invalidateList();
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(p.id) });
      toast({ title: "تم فك الارتباط", description: `أصبح «${p.name}» مشروعاً مستقلاً.` });
    } catch (e) {
      toast({ variant: "destructive", title: "تعذر فك الارتباط", description: apiErrorMessage(e, "حدث خطأ غير متوقع") });
    } finally {
      setUnlinkingId(null);
    }
  };

  const actions: CardActions = {
    canEdit: p => isAdmin || p.canManage === true,
    canDelete: canManageProjects,
    isAdmin,
    onEdit: openEdit,
    onDelete: setDeletingProject,
    onAddChild: p => openCreate(p),
    onUnlink: p => void unlink(p),
    prefetch: prefetchProject,
    unlinkingId,
  };

  const resetFilters = () => { setSearch(""); setFilters(EMPTY_FILTERS); };
  const noResults = portfolio.matchedCount === 0;

  return (
    <div className="mx-auto max-w-[1600px] min-w-0 space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 px-5 py-5 text-white shadow-sm sm:px-7 sm:py-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="relative z-10 rounded-2xl border border-white/15 bg-white/10 p-3"><Building2 className="h-6 w-6 text-cyan-200" /></div>
          <div>
            <h1 className="relative z-10 text-lg font-bold tracking-tight text-white md:text-2xl">محفظة المشاريع</h1>
            <p className="relative z-10 mt-1 text-sm text-white/65">كل مشروع بجدوله المستقل، مجمّعة تنظيمياً تحت مشاريعها الرئيسية</p>
          </div>
        </div>
        <div className="relative z-10 flex w-full flex-wrap gap-2 sm:w-auto">
          {isAdmin && (
            <Button variant="outline" className="flex-1 gap-2 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:flex-none" onClick={() => setCategoriesOpen(true)}>
              <Tags className="h-4 w-4" />إدارة التصنيفات
            </Button>
          )}
          {canManageProjects && (
            <Button className="flex-1 gap-2 rounded-xl border-0 bg-white text-slate-900 hover:bg-white/90 sm:flex-none" onClick={() => openCreate()}>
              <Plus className="h-4 w-4" />مشروع جديد
            </Button>
          )}
        </div>
      </div>

      {listQuery.isLoading && !projects ? (
        <ListSkeleton />
      ) : listQuery.isError && !projects ? (
        <div className="surface-card flex flex-col items-center gap-3 p-10 text-center" role="alert">
          <TriangleAlert className="h-8 w-8 text-destructive" />
          <p className="font-semibold">تعذر تحميل المشاريع</p>
          <p className="max-w-md text-sm text-muted-foreground">{apiErrorMessage(listQuery.error, "تحقق من الاتصال ثم أعد المحاولة.")}</p>
          <Button variant="outline" onClick={() => void listQuery.refetch()}><RefreshCw className="ml-1 h-4 w-4" />إعادة المحاولة</Button>
        </div>
      ) : (
        <>
          {listQuery.isError && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-900" role="alert">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">تعذر تحديث القائمة؛ البيانات المعروضة من آخر تحميل ناجح.</span>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void listQuery.refetch()}><RefreshCw className="ml-1 h-3.5 w-3.5" />تحديث</Button>
            </div>
          )}

          <PortfolioCountersStrip counters={counters} matched={portfolio.matchedCount} filtering={filtering}
            activeRelation={filters.relation} onRelation={r => setFilters(f => ({ ...f, relation: r }))} />

          <PortfolioFiltersBar
            search={search} onSearch={setSearch} filters={filters} onChange={patch => setFilters(f => ({ ...f, ...patch }))}
            categories={categoriesQuery.data ?? []} categoriesState={categoriesState} owners={owners}
            view={view} onView={setView} onReset={resetFilters} filtering={filtering}
          />
          {categoriesState === "error" && (
            <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
              تعذر تحميل التصنيفات، لذا تصفية التصنيف معطلة مؤقتاً.
              <button type="button" className="font-semibold underline" onClick={() => void categoriesQuery.refetch()}>إعادة المحاولة</button>
            </p>
          )}

          {all.length === 0 ? (
            <div className="surface-card flex flex-col items-center gap-3 border-dashed p-12 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-bold">لا توجد مشاريع بعد</p>
              <p className="max-w-sm text-sm text-muted-foreground">{canManageProjects ? "أنشئ أول مشروع لتبدأ متابعة جدوله وتقاريره." : "لم يتم ربطك بأي مشروع حتى الآن. تواصل مع مسؤول النظام."}</p>
              {canManageProjects && <Button onClick={() => openCreate()} className="gap-2"><Plus className="h-4 w-4" />مشروع جديد</Button>}
            </div>
          ) : noResults ? (
            <div className="surface-card flex flex-col items-center gap-3 border-dashed p-12 text-center">
              <SearchX className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-bold">لا توجد مشاريع مطابقة</p>
              <p className="text-sm text-muted-foreground">جرّب كلمات أخرى أو خفف عوامل التصفية.</p>
              <Button variant="outline" onClick={resetFilters}>مسح التصفية</Button>
            </div>
          ) : view === "table" ? (
            <PortfolioTable rows={portfolio.matched} all={all} prefetch={prefetchProject} />
          ) : (
            <div className="space-y-8">
              {portfolio.groups.length > 0 && (
                <section className="space-y-4" aria-label="المشاريع الرئيسية">
                  <SectionHeading icon={<Network className="h-4 w-4" />} title="المشاريع الرئيسية وفروعها" hint="تجميع تنظيمي — لكل مشروع فرعي جدوله الزمني المستقل" count={portfolio.groups.length} />
                  <div className="grid gap-4 xl:grid-cols-2">
                    {portfolio.groups.map(g => (
                      <MainProjectCard key={`${g.parent.id}-${filtering}`} parent={g.parent} parentMatches={g.parentMatches} children={g.children} totalChildren={g.totalChildren} a={actions} defaultOpen={filtering || g.children.length <= 4} />
                    ))}
                  </div>
                </section>
              )}
              {portfolio.standalone.length > 0 && (
                <section className="space-y-4" aria-label="المشاريع المستقلة">
                  <SectionHeading icon={<Layers className="h-4 w-4" />} title="مشاريع مستقلة" hint="غير مرتبطة بمشروع رئيسي" count={portfolio.standalone.length} />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {portfolio.standalone.map(p => <ProjectCard key={p.id} project={p} a={actions} />)}
                  </div>
                </section>
              )}
              {portfolio.otherChildren.length > 0 && (
                <section className="space-y-4" aria-label="مشاريع فرعية أخرى">
                  <SectionHeading icon={<GitBranch className="h-4 w-4" />} title="مشاريع فرعية أخرى متاحة لك" hint="تتبع مشاريع رئيسية خارج صلاحياتك" count={portfolio.otherChildren.length} />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {portfolio.otherChildren.map(p => <ProjectCard key={p.id} project={p} a={actions} variant="orphan" />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      <ProjectFormDialog
        open={dialogOpen}
        onOpenChange={closeDialog}
        editingProject={editingProject}
        initialValues={initialValues}
        detailError={detailError}
        onRetryDetail={() => editingProject && void loadDetail(editingProject)}
        allProjects={all}
        isAdmin={isAdmin}
        canAssignCategory={canAssignCategory}
        isSubmitting={createProject.isPending || updateProject.isPending}
        onSubmit={onSubmit}
      />
      <DeleteProjectDialog project={deletingProject} pending={deleteProject.isPending} onClose={() => setDeletingProject(null)} onConfirm={p => void confirmDelete(p)} />
      {isAdmin && <CategoryManagerDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} usage={categoryUsage} />}
    </div>
  );
}
