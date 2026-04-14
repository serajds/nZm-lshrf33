import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, X, Send, FileText, CheckCircle, Loader2,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checklist_qty" | "table" | "section";

interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  columns?: { key: string; label: string }[];
}

interface PublicTemplate {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  projectName: string;
}

export default function PublicForm() {
  const params = useParams();
  const token = params.token || "";
  const { toast } = useToast();

  const [template, setTemplate] = useState<PublicTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [reportDate, setReportDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [submitterName, setSubmitterName] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/public/form/${token}`)
      .then(async r => {
        if (!r.ok) {
          setError("هذا الرابط غير صالح أو تم تعطيله");
          return;
        }
        const data = await r.json();
        setTemplate(data);
      })
      .catch(() => setError("حدث خطأ في تحميل النموذج"))
      .finally(() => setLoading(false));
  }, [token]);

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

  const handleSubmit = async () => {
    if (!template) return;

    for (const field of template.fields) {
      if (field.required && field.type !== "section") {
        const val = formData[field.id];
        if (val === undefined || val === null || val === "") {
          toast({ variant: "destructive", title: "يرجى تعبئة جميع الحقول المطلوبة" });
          return;
        }
      }
    }

    if (!reportDate) {
      toast({ variant: "destructive", title: "يرجى اختيار التاريخ" });
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/public/form/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: formData,
          reportDate,
          notes,
          submitterName: submitterName.trim() || "مستخدم خارجي",
        }),
      });

      if (r.ok) {
        setSubmitted(true);
      } else {
        toast({ variant: "destructive", title: "فشل إرسال النموذج" });
      }
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ في الإرسال" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
          <p className="text-sm text-muted-foreground">جاري تحميل النموذج...</p>
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <X className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">رابط غير صالح</h2>
            <p className="text-sm text-muted-foreground">{error || "هذا الرابط غير صالح أو تم تعطيله"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">تم الإرسال بنجاح</h2>
            <p className="text-sm text-muted-foreground">شكراً لك، تم استلام النموذج بنجاح</p>
            <Button
              variant="outline"
              onClick={() => {
                setSubmitted(false);
                setFormData({});
                setNotes("");
                setReportDate(new Date().toISOString().split("T")[0]);
                setSubmitterName("");
              }}
            >
              تعبئة نموذج جديد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Noto Kufi Arabic', sans-serif; }
      `}</style>
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-blue-500/10 shrink-0">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-800">{template.name}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">{template.projectName}</p>
                {template.description && (
                  <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>الاسم <span className="text-xs text-muted-foreground">(اختياري)</span></Label>
                <Input
                  value={submitterName}
                  onChange={e => setSubmitterName(e.target.value)}
                  placeholder="أدخل اسمك"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>تاريخ التقرير *</Label>
                <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            <div className="space-y-5 pt-2">
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

                    {field.type === "checklist_qty" && (() => {
                      const checklistData = (formData[field.id] as Record<string, number>) || {};
                      return (
                        <div className="mt-2 space-y-2">
                          {(field.options || []).filter(o => o.trim()).map((opt, i) => {
                            const isChecked = checklistData[opt] !== undefined;
                            return (
                              <div key={i} className="flex items-center gap-3 p-2 rounded-lg border bg-background hover:bg-muted/30 transition-colors">
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const updated = { ...checklistData };
                                    if (checked) {
                                      updated[opt] = 0;
                                    } else {
                                      delete updated[opt];
                                    }
                                    updateValue(field.id, Object.keys(updated).length > 0 ? updated : undefined);
                                  }}
                                />
                                <span className="text-sm flex-1">{opt}</span>
                                {isChecked && (
                                  <Input
                                    type="number"
                                    min="0"
                                    value={checklistData[opt] || ""}
                                    onChange={e => {
                                      const updated = { ...checklistData };
                                      updated[opt] = parseInt(e.target.value) || 0;
                                      updateValue(field.id, updated);
                                    }}
                                    placeholder="العدد"
                                    className="w-20 h-8 text-xs text-center"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

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

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSubmit} disabled={submitting} className="gap-2 min-w-32">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? "جاري الإرسال..." : "إرسال النموذج"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-4">
          نظام إدارة الإشراف والمتابعة
        </p>
      </div>
    </div>
  );
}
