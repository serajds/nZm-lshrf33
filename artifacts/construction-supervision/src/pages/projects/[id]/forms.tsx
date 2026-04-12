import { useState, useCallback, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useGetProject } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, ArrowRight, FileText, Trash2, Edit2, Eye, Printer,
  GripVertical, Type, Hash, Calendar, List, Table, Heading,
  AlignLeft, Send, ClipboardCheck, ChevronDown, ChevronUp, X,
  Download, Upload,
} from "lucide-react";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { fmtDate } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "table" | "section";

interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  columns?: { key: string; label: string }[];
  defaultRows?: string[][];
}

interface FormTemplate {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

interface FormSubmission {
  id: number;
  templateId: number;
  projectId: number;
  data: Record<string, unknown>;
  submittedById: number | null;
  submittedByName: string | null;
  status: string;
  reportDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const fieldTypeLabels: Record<FieldType, string> = {
  text: "نص قصير",
  textarea: "نص طويل",
  number: "رقم",
  date: "تاريخ",
  select: "قائمة اختيار",
  table: "جدول",
  section: "عنوان قسم",
};

const fieldTypeIcons: Record<FieldType, typeof Type> = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  date: Calendar,
  select: List,
  table: Table,
  section: Heading,
};

function genId() {
  return "f_" + Math.random().toString(36).slice(2, 9);
}

function TemplateBuilder({
  template,
  onSave,
  onCancel,
}: {
  template?: FormTemplate | null;
  onSave: (data: { name: string; description: string; fields: FormField[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [fields, setFields] = useState<FormField[]>(template?.fields || []);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const addField = (type: FieldType) => {
    const newField: FormField = {
      id: genId(),
      type,
      label: "",
      required: type !== "section",
    };
    if (type === "select") newField.options = [""];
    if (type === "table") {
      newField.columns = [{ key: "col1", label: "العمود 1" }, { key: "col2", label: "العمود 2" }];
    }
    setFields([...fields, newField]);
    setEditingFieldIdx(fields.length);
  };

  const updateField = (idx: number, updates: Partial<FormField>) => {
    const copy = [...fields];
    copy[idx] = { ...copy[idx], ...updates };
    setFields(copy);
  };

  const removeField = (idx: number) => {
    setFields(fields.filter((_, i) => i !== idx));
    if (editingFieldIdx === idx) setEditingFieldIdx(null);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setFields(copy);
    setEditingFieldIdx(newIdx);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const validFields = fields.filter(f => f.label.trim() || f.type === "section");
    onSave({ name: name.trim(), description: description.trim(), fields: validFields });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Label>اسم النموذج *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: تقرير العمل اليومي" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>وصف النموذج</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="وصف اختياري للنموذج..." className="mt-1 min-h-16" />
        </div>
      </div>

      <div>
        <Label className="text-base font-semibold">الحقول</Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">أضف الحقول التي تريدها في النموذج</p>

        <div className="flex flex-wrap gap-2 mb-4">
          {(Object.keys(fieldTypeLabels) as FieldType[]).map(type => {
            const Icon = fieldTypeIcons[type];
            return (
              <Button key={type} variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => addField(type)}>
                <Icon className="h-3.5 w-3.5" />
                {fieldTypeLabels[type]}
              </Button>
            );
          })}
        </div>

        {fields.length === 0 && (
          <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">اضغط على أحد أنواع الحقول أعلاه لإضافته</p>
          </div>
        )}

        <div className="space-y-2">
          {fields.map((field, idx) => {
            const Icon = fieldTypeIcons[field.type];
            const isEditing = editingFieldIdx === idx;

            return (
              <div key={field.id} className={`border rounded-lg transition-colors ${isEditing ? "border-primary bg-primary/5" : "bg-card"}`}>
                <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setEditingFieldIdx(isEditing ? null : idx)}>
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">
                    {field.label || <span className="text-muted-foreground italic">بدون عنوان</span>}
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{fieldTypeLabels[field.type]}</Badge>
                  {field.required && <span className="text-destructive text-xs">*</span>}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); moveField(idx, -1); }} disabled={idx === 0}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); moveField(idx, 1); }} disabled={idx === fields.length - 1}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); removeField(idx); }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="px-4 pb-4 pt-2 border-t space-y-3">
                    <div>
                      <Label className="text-xs">عنوان الحقل</Label>
                      <Input value={field.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder="عنوان الحقل" className="mt-1" />
                    </div>

                    {field.type !== "section" && (
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={field.required ?? false} onChange={e => updateField(idx, { required: e.target.checked })} className="rounded" />
                          مطلوب
                        </label>
                        {(field.type === "text" || field.type === "textarea") && (
                          <div className="flex-1">
                            <Input value={field.placeholder || ""} onChange={e => updateField(idx, { placeholder: e.target.value })} placeholder="نص توضيحي (اختياري)" className="text-xs" />
                          </div>
                        )}
                      </div>
                    )}

                    {field.type === "select" && (
                      <div>
                        <Label className="text-xs">الخيارات</Label>
                        <div className="space-y-1.5 mt-1">
                          {(field.options || []).map((opt, oi) => (
                            <div key={oi} className="flex gap-1.5">
                              <Input
                                value={opt}
                                onChange={e => {
                                  const newOpts = [...(field.options || [])];
                                  newOpts[oi] = e.target.value;
                                  updateField(idx, { options: newOpts });
                                }}
                                placeholder={`خيار ${oi + 1}`}
                                className="text-sm"
                              />
                              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                                const newOpts = (field.options || []).filter((_, i) => i !== oi);
                                updateField(idx, { options: newOpts });
                              }}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => updateField(idx, { options: [...(field.options || []), ""] })}>
                            + إضافة خيار
                          </Button>
                        </div>
                      </div>
                    )}

                    {field.type === "table" && (
                      <div>
                        <Label className="text-xs">أعمدة الجدول</Label>
                        <div className="space-y-1.5 mt-1">
                          {(field.columns || []).map((col, ci) => (
                            <div key={ci} className="flex gap-1.5">
                              <Input
                                value={col.label}
                                onChange={e => {
                                  const newCols = [...(field.columns || [])];
                                  newCols[ci] = { ...newCols[ci], label: e.target.value };
                                  updateField(idx, { columns: newCols });
                                }}
                                placeholder={`عمود ${ci + 1}`}
                                className="text-sm"
                              />
                              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                                const newCols = (field.columns || []).filter((_, i) => i !== ci);
                                updateField(idx, { columns: newCols });
                              }} disabled={(field.columns || []).length <= 1}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                            const newKey = `col${(field.columns || []).length + 1}`;
                            updateField(idx, { columns: [...(field.columns || []), { key: newKey, label: "" }] });
                          }}>
                            + إضافة عمود
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {fields.length > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 mb-3"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="h-4 w-4" />
            {showPreview ? "إخفاء المعاينة" : "معاينة النموذج"}
          </Button>

          {showPreview && (
            <Card className="border-2 border-dashed border-primary/30">
              <CardContent className="p-5 space-y-4">
                <div className="text-center border-b pb-3">
                  <h2 className="font-bold text-lg">{name || "بدون عنوان"}</h2>
                  {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
                {fields.map(field => {
                  if (field.type === "section") {
                    return (
                      <div key={field.id} className="border-b pb-1 pt-2">
                        <h3 className="font-semibold">{field.label || "عنوان القسم"}</h3>
                      </div>
                    );
                  }
                  return (
                    <div key={field.id}>
                      <Label className="text-sm">
                        {field.label || "بدون عنوان"}
                        {field.required && <span className="text-destructive mr-1">*</span>}
                      </Label>
                      {field.type === "text" && <Input disabled placeholder={field.placeholder || ""} className="mt-1" />}
                      {field.type === "textarea" && <Textarea disabled placeholder={field.placeholder || ""} className="mt-1 min-h-16" />}
                      {field.type === "number" && <Input type="number" disabled className="mt-1" />}
                      {field.type === "date" && <Input type="date" disabled className="mt-1" />}
                      {field.type === "select" && (
                        <Select disabled>
                          <SelectTrigger className="mt-1" dir="rtl"><SelectValue placeholder="اختر..." /></SelectTrigger>
                        </Select>
                      )}
                      {field.type === "table" && field.columns && (
                        <div className="mt-1 border rounded overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/40">
                                <th className="px-3 py-1.5 text-right font-medium text-xs w-10">#</th>
                                {field.columns.map((col, ci) => (
                                  <th key={ci} className="px-3 py-1.5 text-right font-medium text-xs">{col.label || `عمود ${ci + 1}`}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t">
                                <td className="px-3 py-1 text-muted-foreground text-xs">1</td>
                                {field.columns.map((_, ci) => (
                                  <td key={ci} className="px-1 py-1"><Input disabled className="h-7 text-xs" /></td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button onClick={handleSave} disabled={!name.trim()}>
          {template ? "حفظ التغييرات" : "إنشاء النموذج"}
        </Button>
      </div>
    </div>
  );
}

const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const AUTO_FILL_MAP: Record<string, string> = {
  project_name: "name",
  owner_entity: "ownerEntity",
  contractor_name: "contractor",
  consultant_name: "supervisorEntity",
};

function buildAutoFillData(project: Record<string, unknown> | undefined, reportDate: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (project) {
    for (const [fieldId, projectKey] of Object.entries(AUTO_FILL_MAP)) {
      const val = project[projectKey];
      if (val) result[fieldId] = val;
    }
  }
  if (reportDate) {
    const d = new Date(reportDate + "T00:00:00");
    if (!isNaN(d.getTime())) {
      result.day_name = DAY_NAMES_AR[d.getDay()];
    }
  }
  return result;
}

function FormFiller({
  template,
  submission,
  project,
  onSubmit,
  onCancel,
}: {
  template: FormTemplate;
  submission?: FormSubmission | null;
  project?: Record<string, unknown>;
  onSubmit: (data: { data: Record<string, unknown>; reportDate: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const initialDate = submission?.reportDate || today;
  const isNew = !submission;

  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (submission?.data) return submission.data as Record<string, unknown>;
    return buildAutoFillData(project, initialDate);
  });
  const [reportDate, setReportDate] = useState(initialDate);
  const [notes, setNotes] = useState(submission?.notes || "");

  useEffect(() => {
    if (!isNew) return;
    const autoFill = buildAutoFillData(project, reportDate);
    setFormData(prev => {
      const merged = { ...prev };
      for (const [key, val] of Object.entries(autoFill)) {
        if (!merged[key] || merged[key] === "") {
          merged[key] = val;
        }
      }
      if (autoFill.day_name) merged.day_name = autoFill.day_name;
      return merged;
    });
  }, [project, reportDate]);

  const updateValue = (fieldId: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  const getTableRows = (fieldId: string, columns: { key: string; label: string }[]): string[][] => {
    const existing = formData[fieldId] as string[][] | undefined;
    if (existing && Array.isArray(existing) && existing.length > 0) return existing;
    return [columns.map(() => "")];
  };

  const updateTableRow = (fieldId: string, rowIdx: number, colIdx: number, value: string, columns: { key: string; label: string }[]) => {
    const rows = [...getTableRows(fieldId, columns)];
    rows[rowIdx] = [...rows[rowIdx]];
    rows[rowIdx][colIdx] = value;
    updateValue(fieldId, rows);
  };

  const addTableRow = (fieldId: string, columns: { key: string; label: string }[]) => {
    const rows = [...getTableRows(fieldId, columns), columns.map(() => "")];
    updateValue(fieldId, rows);
  };

  const removeTableRow = (fieldId: string, rowIdx: number, columns: { key: string; label: string }[]) => {
    const rows = getTableRows(fieldId, columns).filter((_, i) => i !== rowIdx);
    updateValue(fieldId, rows.length > 0 ? rows : [columns.map(() => "")]);
  };

  const handleSubmit = () => {
    for (const field of template.fields) {
      if (field.required && field.type !== "section") {
        const val = formData[field.id];
        if (val === undefined || val === null || val === "") {
          return;
        }
      }
    }
    onSubmit({ data: formData, reportDate, notes });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>تاريخ التقرير *</Label>
          <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div className="space-y-5">
        {template.fields.map(field => {
          if (field.type === "section") {
            return (
              <div key={field.id} className="border-b pb-1 pt-3">
                <h3 className="font-semibold text-base">{field.label}</h3>
              </div>
            );
          }

          return (
            <div key={field.id}>
              <Label className="text-sm">
                {field.label}
                {field.required && <span className="text-destructive mr-1">*</span>}
              </Label>

              {field.type === "text" && (
                <Input
                  value={(formData[field.id] as string) || ""}
                  onChange={e => updateValue(field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  className="mt-1"
                />
              )}

              {field.type === "textarea" && (
                <Textarea
                  value={(formData[field.id] as string) || ""}
                  onChange={e => updateValue(field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  className="mt-1 min-h-20"
                />
              )}

              {field.type === "number" && (
                <Input
                  type="number"
                  value={(formData[field.id] as string) || ""}
                  onChange={e => updateValue(field.id, e.target.value)}
                  className="mt-1"
                />
              )}

              {field.type === "date" && (
                <Input
                  type="date"
                  value={(formData[field.id] as string) || ""}
                  onChange={e => updateValue(field.id, e.target.value)}
                  className="mt-1"
                />
              )}

              {field.type === "select" && (
                <Select
                  value={(formData[field.id] as string) || ""}
                  onValueChange={v => updateValue(field.id, v)}
                >
                  <SelectTrigger className="mt-1" dir="rtl">
                    <SelectValue placeholder="اختر..." />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {(field.options || []).filter(o => o.trim()).map((opt, i) => (
                      <SelectItem key={i} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {field.type === "table" && field.columns && (
                <div className="mt-2 border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="px-3 py-2 text-right font-medium text-xs w-10">#</th>
                        {field.columns.map((col, ci) => (
                          <th key={ci} className="px-3 py-2 text-right font-medium text-xs">{col.label}</th>
                        ))}
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTableRows(field.id, field.columns).map((row, ri) => (
                        <tr key={ri} className="border-t">
                          <td className="px-3 py-1 text-muted-foreground text-xs">{ri + 1}</td>
                          {field.columns!.map((_, ci) => (
                            <td key={ci} className="px-1 py-1">
                              <Input
                                value={row[ci] || ""}
                                onChange={e => updateTableRow(field.id, ri, ci, e.target.value, field.columns!)}
                                className="h-8 text-xs"
                              />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTableRow(field.id, ri, field.columns!)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-2 border-t">
                    <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => addTableRow(field.id, field.columns!)}>
                      <Plus className="h-3 w-3" /> إضافة صف
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <Label>ملاحظات إضافية</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات اختيارية..." className="mt-1 min-h-16" />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button onClick={handleSubmit} className="gap-2">
          <Send className="h-4 w-4" />
          {submission ? "تحديث" : "إرسال"}
        </Button>
      </div>
    </div>
  );
}

function SubmissionViewer({
  submission,
  template,
  project,
  onClose,
}: {
  submission: FormSubmission;
  template: FormTemplate;
  project: { name?: string } | undefined;
  onClose: () => void;
}) {
  const data = submission.data as Record<string, unknown>;

  const esc = (s: string | null | undefined) =>
    (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    let fieldsHtml = "";
    for (const field of template.fields) {
      if (field.type === "section") {
        fieldsHtml += `<tr><td colspan="2" style="background:#eef2f7;padding:3px 6px;font-weight:700;font-size:10px;border-top:1px solid #bbb;letter-spacing:0.3px;">${esc(field.label)}</td></tr>`;
        continue;
      }

      const value = data[field.id];
      const isEmpty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
      if (isEmpty) continue;

      let displayValue = "";

      if (field.type === "table" && Array.isArray(value)) {
        const rows = (value as string[][]).filter(row => row.some(cell => cell && cell.trim()));
        if (rows.length === 0) continue;
        let tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:9px;"><thead><tr>`;
        (field.columns || []).forEach(col => {
          tableHtml += `<th style="border:1px solid #ccc;padding:2px 4px;background:#f0f0f0;text-align:right;font-size:8px;">${esc(col.label)}</th>`;
        });
        tableHtml += `</tr></thead><tbody>`;
        rows.forEach(row => {
          tableHtml += `<tr>`;
          row.forEach(cell => {
            tableHtml += `<td style="border:1px solid #ccc;padding:2px 4px;font-size:9px;">${esc(cell)}</td>`;
          });
          tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table>`;
        displayValue = tableHtml;
      } else if (field.type === "textarea") {
        displayValue = `<span style="white-space:pre-wrap;font-size:9px;">${esc(value as string)}</span>`;
      } else {
        displayValue = `<span style="font-size:9px;">${esc(value as string)}</span>`;
      }

      fieldsHtml += `<tr><td style="padding:2px 5px;font-weight:600;vertical-align:top;width:120px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;">${esc(field.label)}</td><td style="padding:2px 5px;border-bottom:1px solid #eee;">${displayValue}</td></tr>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(template.name)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;600;700&display=swap');
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Noto Kufi Arabic', sans-serif; padding: 6px; color: #333; direction: rtl; font-size: 9px; line-height: 1.3; }
.header { text-align: center; margin-bottom: 6px; border-bottom: 2px solid #2563eb; padding-bottom: 4px; }
.header h1 { font-size: 13px; color: #1e40af; margin-bottom: 1px; }
.header p { font-size: 10px; color: #666; }
.meta { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 9px; background: #f8fafc; padding: 3px 8px; border-radius: 3px; }
table.fields { width: 100%; border-collapse: collapse; border: 1px solid #ccc; }
.notes-box { margin-top: 4px; padding: 3px 6px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 3px; font-size: 9px; }
.footer { margin-top: 10px; display: flex; justify-content: space-between; font-size: 9px; }
.sig-box { width: 45%; border-top: 1px solid #999; padding-top: 4px; text-align: center; }
.sig-box p { margin-bottom: 2px; }
@media print { body { padding: 0; } }
</style></head><body>
<div class="header">
  <h1>${esc(template.name)}</h1>
  <p>${esc(project?.name)}</p>
</div>
<div class="meta">
  <span>التاريخ: ${esc(fmtDate(submission.reportDate))}</span>
  <span>الحالة: ${submission.status === "reviewed" ? "تمت المراجعة" : submission.status === "submitted" ? "مرسل" : "مسودة"}</span>
</div>
<table class="fields">${fieldsHtml}</table>
${submission.notes ? `<div class="notes-box"><strong>ملاحظات:</strong> ${esc(submission.notes)}</div>` : ""}
<div class="footer">
  <div class="sig-box"><p>اعتماد</p><p>التوقيع: ___________</p></div>
</div>
</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{template.name}</h3>
          <p className="text-sm text-muted-foreground">
            {fmtDate(submission.reportDate)} — {submission.submittedByName || "مجهول"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> طباعة
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {template.fields.map(field => {
          if (field.type === "section") {
            return (
              <div key={field.id} className="border-b pb-1 pt-3">
                <h3 className="font-semibold text-base">{field.label}</h3>
              </div>
            );
          }

          const value = data[field.id];

          return (
            <div key={field.id} className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2 border-b border-dashed">
              <div className="font-medium text-sm text-muted-foreground">{field.label}</div>
              <div className="sm:col-span-2 text-sm">
                {field.type === "table" && Array.isArray(value) ? (
                  <div className="border rounded overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40">
                          {(field.columns || []).map((col, ci) => (
                            <th key={ci} className="px-3 py-1.5 text-right font-medium">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(value as string[][]).map((row, ri) => (
                          <tr key={ri} className="border-t">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5">{cell || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span>{(value as string) || "—"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {submission.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <Label className="text-xs text-amber-700">ملاحظات</Label>
          <p className="text-sm mt-1">{submission.notes}</p>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t">
        <Button variant="outline" onClick={onClose}>إغلاق</Button>
      </div>
    </div>
  );
}

export default function ProjectForms() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  usePageTitle("النماذج");

  const [activeTab, setActiveTab] = useState<"templates" | "submissions">("templates");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(null);
  const [fillerOpen, setFillerOpen] = useState(false);
  const [fillingTemplate, setFillingTemplate] = useState<FormTemplate | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<FormSubmission | null>(null);
  const [viewingSubmission, setViewingSubmission] = useState<FormSubmission | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<FormTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });

  const isAdminOrPM = user?.role === "admin" || user?.role === "project_manager";
  const isContractor = user?.role === "contractor";

  const { data: templates = [], isLoading: templatesLoading } = useQuery<FormTemplate[]>({
    queryKey: [`/api/projects/${projectId}/form-templates`],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/projects/${projectId}/form-templates`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  const { data: submissions = [], isLoading: submissionsLoading } = useQuery<FormSubmission[]>({
    queryKey: [`/api/projects/${projectId}/form-submissions`],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/projects/${projectId}/form-submissions`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/form-templates`] });
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/form-submissions`] });
  }, [queryClient, projectId]);

  const handleSaveTemplate = async (data: { name: string; description: string; fields: FormField[] }) => {
    const url = editingTemplate
      ? `${API_BASE}/projects/${projectId}/form-templates/${editingTemplate.id}`
      : `${API_BASE}/projects/${projectId}/form-templates`;
    const method = editingTemplate ? "PUT" : "POST";

    const r = await authFetch(url, { method, body: JSON.stringify(data) });
    if (r.ok) {
      toast({ title: editingTemplate ? "تم تحديث النموذج" : "تم إنشاء النموذج" });
      invalidate();
      setBuilderOpen(false);
      setEditingTemplate(null);
    } else {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deletingTemplateId) return;
    const r = await authFetch(`${API_BASE}/projects/${projectId}/form-templates/${deletingTemplateId}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "تم حذف النموذج" });
      invalidate();
    } else {
      toast({ variant: "destructive", title: "فشل الحذف" });
    }
    setDeletingTemplateId(null);
  };

  const handleSubmitForm = async (data: { data: Record<string, unknown>; reportDate: string; notes: string }) => {
    if (!fillingTemplate) return;

    const url = editingSubmission
      ? `${API_BASE}/projects/${projectId}/form-submissions/${editingSubmission.id}`
      : `${API_BASE}/projects/${projectId}/form-submissions`;
    const method = editingSubmission ? "PUT" : "POST";

    const body = editingSubmission
      ? { data: data.data, reportDate: data.reportDate, notes: data.notes }
      : { templateId: fillingTemplate.id, data: data.data, reportDate: data.reportDate, notes: data.notes };

    const r = await authFetch(url, { method, body: JSON.stringify(body) });
    if (r.ok) {
      toast({ title: editingSubmission ? "تم تحديث التعبئة" : "تم إرسال النموذج" });
      invalidate();
      setFillerOpen(false);
      setFillingTemplate(null);
      setEditingSubmission(null);
    } else {
      toast({ variant: "destructive", title: "فشل الإرسال" });
    }
  };

  const handleDeleteSubmission = async () => {
    if (!deletingSubmissionId) return;
    const r = await authFetch(`${API_BASE}/projects/${projectId}/form-submissions/${deletingSubmissionId}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "تم حذف التعبئة" });
      invalidate();
    } else {
      toast({ variant: "destructive", title: "فشل الحذف" });
    }
    setDeletingSubmissionId(null);
  };

  const handleMarkReviewed = async (submissionId: number) => {
    const r = await authFetch(`${API_BASE}/projects/${projectId}/form-submissions/${submissionId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "reviewed" }),
    });
    if (r.ok) {
      toast({ title: "تم تحديث الحالة" });
      invalidate();
    }
  };

  const handleExportTemplate = (t: FormTemplate) => {
    const exportData = { name: t.name, description: t.description, fields: t.fields };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.name.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "تم تصدير النموذج" });
  };

  const handleImportTemplate = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.name || !Array.isArray(data.fields)) {
          toast({ variant: "destructive", title: "ملف غير صالح", description: "يجب أن يحتوي على اسم النموذج والحقول" });
          return;
        }
        const r = await authFetch(`${API_BASE}/projects/${projectId}/form-templates`, {
          method: "POST",
          body: JSON.stringify({ name: data.name, description: data.description || "", fields: data.fields }),
        });
        if (r.ok) {
          toast({ title: "تم استيراد النموذج بنجاح" });
          invalidate();
        } else {
          toast({ variant: "destructive", title: "فشل استيراد النموذج" });
        }
      } catch {
        toast({ variant: "destructive", title: "ملف غير صالح", description: "تأكد من أن الملف بصيغة JSON صحيحة" });
      }
    };
    input.click();
  };

  const getTemplateName = (templateId: number) => {
    return templates.find(t => t.id === templateId)?.name || "نموذج محذوف";
  };

  const getTemplateForSubmission = (templateId: number) => {
    return templates.find(t => t.id === templateId) || null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">النماذج</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === "templates" ? "default" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => setActiveTab("templates")}
        >
          <FileText className="h-4 w-4" />
          قوالب النماذج
          {templates.length > 0 && <Badge variant="secondary" className="mr-1 text-xs">{templates.length}</Badge>}
        </Button>
        <Button
          variant={activeTab === "submissions" ? "default" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => setActiveTab("submissions")}
        >
          <ClipboardCheck className="h-4 w-4" />
          التعبئات المرسلة
          {submissions.length > 0 && <Badge variant="secondary" className="mr-1 text-xs">{submissions.length}</Badge>}
        </Button>
      </div>

      {activeTab === "templates" && (
        <div className="space-y-4">
          {isAdminOrPM && (
            <div className="flex gap-2 flex-wrap">
              <Button className="gap-2" onClick={() => { setEditingTemplate(null); setBuilderOpen(true); }}>
                <Plus className="h-4 w-4" /> إنشاء نموذج جديد
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleImportTemplate}>
                <Upload className="h-4 w-4" /> استيراد نموذج
              </Button>
            </div>
          )}

          {templatesLoading ? (
            <LoadingSpinner text="جاري تحميل النماذج..." />
          ) : templates.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6 text-muted-foreground" />}
              title="لا توجد نماذج"
              description={isAdminOrPM ? "أنشئ نموذجاً جديداً لبدء جمع البيانات" : "لم يتم إنشاء أي نماذج لهذا المشروع بعد"}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {templates.map(t => (
                <Card key={t.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-sm">{t.name}</h3>
                        {t.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>}
                      </div>
                      <Badge variant={t.isActive ? "default" : "secondary"} className="text-[10px] shrink-0">
                        {t.isActive ? "فعال" : "معطل"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <span>{t.fields.length} حقل</span>
                      <span>•</span>
                      <span>{submissions.filter(s => s.templateId === t.id).length} تعبئة</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1 text-xs flex-1"
                        onClick={() => { setFillingTemplate(t); setEditingSubmission(null); setFillerOpen(true); }}
                      >
                        <Send className="h-3 w-3" /> تعبئة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        title="تصدير النموذج"
                        onClick={() => handleExportTemplate(t)}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      {isAdminOrPM && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => { setEditingTemplate(t); setBuilderOpen(true); }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-destructive hover:text-destructive"
                            onClick={() => setDeletingTemplateId(t.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "submissions" && (
        <div className="space-y-4">
          {submissionsLoading ? (
            <LoadingSpinner text="جاري تحميل التعبئات..." />
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="h-6 w-6 text-muted-foreground" />}
              title="لا توجد تعبئات"
              description="لم يتم إرسال أي تعبئات بعد"
            />
          ) : (
            <div className="space-y-2">
              <div className="hidden md:block">
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="px-4 py-2.5 text-right font-medium">النموذج</th>
                        <th className="px-4 py-2.5 text-right font-medium">التاريخ</th>
                        <th className="px-4 py-2.5 text-right font-medium">مقدم من</th>
                        <th className="px-4 py-2.5 text-right font-medium">الحالة</th>
                        <th className="px-4 py-2.5 text-right font-medium w-32">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map(s => (
                        <tr key={s.id} className="border-t hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{getTemplateName(s.templateId)}</td>
                          <td className="px-4 py-2.5" dir="ltr">{fmtDate(s.reportDate)}</td>
                          <td className="px-4 py-2.5">{s.submittedByName || "—"}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant={s.status === "reviewed" ? "default" : s.status === "submitted" ? "secondary" : "outline"} className="text-[10px]">
                              {s.status === "reviewed" ? "تمت المراجعة" : s.status === "submitted" ? "مرسل" : "مسودة"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  const tmpl = getTemplateForSubmission(s.templateId);
                                  if (tmpl) { setViewingSubmission(s); setViewingTemplate(tmpl); }
                                }}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {(isAdminOrPM || (s.submittedById === user?.id && !isContractor)) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    const tmpl = getTemplateForSubmission(s.templateId);
                                    if (tmpl) { setFillingTemplate(tmpl); setEditingSubmission(s); setFillerOpen(true); }
                                  }}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {isAdminOrPM && s.status !== "reviewed" && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600" onClick={() => handleMarkReviewed(s.id)}>
                                  <ClipboardCheck className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {(isAdminOrPM || (s.submittedById === user?.id && !isContractor)) && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingSubmissionId(s.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="md:hidden space-y-2">
                {submissions.map(s => (
                  <Card key={s.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">{getTemplateName(s.templateId)}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(s.reportDate)} — {s.submittedByName || "—"}</p>
                        </div>
                        <Badge variant={s.status === "reviewed" ? "default" : "secondary"} className="text-[10px]">
                          {s.status === "reviewed" ? "تمت المراجعة" : "مرسل"}
                        </Badge>
                      </div>
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" className="text-xs gap-1 flex-1" onClick={() => {
                          const tmpl = getTemplateForSubmission(s.templateId);
                          if (tmpl) { setViewingSubmission(s); setViewingTemplate(tmpl); }
                        }}>
                          <Eye className="h-3 w-3" /> عرض
                        </Button>
                        {(isAdminOrPM || (s.submittedById === user?.id && !isContractor)) && (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                            const tmpl = getTemplateForSubmission(s.templateId);
                            if (tmpl) { setFillingTemplate(tmpl); setEditingSubmission(s); setFillerOpen(true); }
                          }}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={builderOpen} onOpenChange={open => { if (!open) { setBuilderOpen(false); setEditingTemplate(null); } }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "تعديل النموذج" : "إنشاء نموذج جديد"}</DialogTitle>
          </DialogHeader>
          <TemplateBuilder
            template={editingTemplate}
            onSave={handleSaveTemplate}
            onCancel={() => { setBuilderOpen(false); setEditingTemplate(null); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={fillerOpen} onOpenChange={open => { if (!open) { setFillerOpen(false); setFillingTemplate(null); setEditingSubmission(null); } }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{fillingTemplate?.name || "تعبئة النموذج"}</DialogTitle>
          </DialogHeader>
          {fillingTemplate && (
            <FormFiller
              template={fillingTemplate}
              submission={editingSubmission}
              project={project as Record<string, unknown> | undefined}
              onSubmit={handleSubmitForm}
              onCancel={() => { setFillerOpen(false); setFillingTemplate(null); setEditingSubmission(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingSubmission} onOpenChange={open => { if (!open) { setViewingSubmission(null); setViewingTemplate(null); } }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>عرض التعبئة</DialogTitle>
          </DialogHeader>
          {viewingSubmission && viewingTemplate && (
            <SubmissionViewer
              submission={viewingSubmission}
              template={viewingTemplate}
              project={project}
              onClose={() => { setViewingSubmission(null); setViewingTemplate(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingTemplateId} onOpenChange={() => setDeletingTemplateId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف النموذج</AlertDialogTitle>
            <AlertDialogDescription>سيتم حذف النموذج وجميع التعبئات المرتبطة به. لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTemplate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingSubmissionId} onOpenChange={() => setDeletingSubmissionId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التعبئة</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذه التعبئة؟</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSubmission} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
