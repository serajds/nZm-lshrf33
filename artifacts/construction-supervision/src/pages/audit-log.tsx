import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, Edit2, Trash2, Filter } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type AuditEntry = {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  projectId: number | null;
  projectName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

function authFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json());
}

const ACTION_LABELS: Record<string, string> = { create: "إنشاء", update: "تعديل", delete: "حذف" };
const ACTION_COLORS: Record<string, string> = { create: "bg-green-100 text-green-700", update: "bg-blue-100 text-blue-700", delete: "bg-red-100 text-red-700" };
const ENTITY_LABELS: Record<string, string> = { project: "مشروع", activity: "نشاط", report: "تقرير", user: "مستخدم" };

const ACTION_ICONS: Record<string, typeof Plus> = { create: Plus, update: Edit2, delete: Trash2 };

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = new URLSearchParams();
  if (entityType !== "all") params.set("entityType", entityType);
  if (action !== "all") params.set("action", action);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  params.set("limit", "200");

  const { data: logs, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log", entityType, action, dateFrom, dateTo],
    queryFn: () => authFetch(`${API_BASE}/audit-log?${params.toString()}`),
  });

  const hasFilters = entityType !== "all" || action !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-xl">
          <ClipboardList className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg md:text-2xl font-bold">سجل العمليات</h1>
          <p className="text-sm text-muted-foreground mt-0.5">تتبع جميع التغييرات في النظام</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    <SelectItem value="project">مشروع</SelectItem>
                    <SelectItem value="activity">نشاط</SelectItem>
                    <SelectItem value="report">تقرير</SelectItem>
                    <SelectItem value="user">مستخدم</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">كل الإجراءات</SelectItem>
                    <SelectItem value="create">إنشاء</SelectItem>
                    <SelectItem value="update">تعديل</SelectItem>
                    <SelectItem value="delete">حذف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">من</span>
              <Input type="date" className="flex-1 min-w-0 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">إلى</span>
              <Input type="date" className="flex-1 min-w-0 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setEntityType("all"); setAction("all"); setDateFrom(""); setDateTo(""); }}>مسح</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-10 text-muted-foreground">جاري التحميل...</div>
          ) : !logs || logs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">لا توجد عمليات مسجلة</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">المستخدم</TableHead>
                      <TableHead className="text-right">الإجراء</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">العنصر</TableHead>
                      <TableHead className="text-right">المشروع</TableHead>
                      <TableHead className="text-right">التفاصيل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const Icon = ACTION_ICONS[log.action] ?? Edit2;
                      return (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm whitespace-nowrap tabular-nums">
                            {new Date(log.createdAt).toLocaleDateString("en-GB")}
                            <span className="text-muted-foreground mr-1 text-xs">
                              {new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{log.userName ?? "—"}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                              <Icon className="h-3 w-3" />
                              {ACTION_LABELS[log.action] ?? log.action}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{ENTITY_LABELS[log.entityType] ?? log.entityType}</Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{log.entityName ?? "—"}</TableCell>
                          <TableCell className="text-sm max-w-[150px] truncate">{log.projectName ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {log.details ? summarizeDetails(log.details) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {logs.map((log) => {
                  const Icon = ACTION_ICONS[log.action] ?? Edit2;
                  return (
                    <div key={log.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                          <Icon className="h-3 w-3" />
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                        <Badge variant="outline" className="text-xs">{ENTITY_LABELS[log.entityType] ?? log.entityType}</Badge>
                      </div>
                      <div className="text-sm font-medium truncate">{log.entityName ?? "—"}</div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{log.userName ?? "—"}</span>
                        <span className="tabular-nums">
                          {new Date(log.createdAt).toLocaleDateString("en-GB")}{" "}
                          {new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {log.projectName && (
                        <div className="text-xs text-muted-foreground truncate">المشروع: {log.projectName}</div>
                      )}
                      {log.details && (
                        <div className="text-xs text-muted-foreground truncate">التفاصيل: {summarizeDetails(log.details)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function summarizeDetails(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) return "—";
  const FIELD_LABELS: Record<string, string> = {
    name: "الاسم", status: "الحالة", overallProgress: "التقدم",
    actualProgress: "الإنجاز الفعلي", plannedProgress: "الإنجاز المخطط",
    startDate: "تاريخ البدء", expectedEndDate: "تاريخ الانتهاء",
  };
  return keys.map(k => FIELD_LABELS[k] ?? k).join("، ");
}
