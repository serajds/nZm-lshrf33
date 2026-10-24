import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { parseActivityWeight } from "@/lib/activity-weight";

interface ActivityWeightDialogProps {
  activity: { id: number; name: string; weight?: number | null } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (weight: number) => Promise<void>;
}

export function ActivityWeightDialog({ activity, saving, onClose, onSave }: ActivityWeightDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(activity ? String(activity.weight ?? 1) : "");
    setError("");
  }, [activity]);

  return (
    <Dialog open={activity !== null} onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle>تحديد الوزن النوعي</DialogTitle>
          <DialogDescription className="break-words">
            {activity?.name} — وزن نسبي يحدد مساهمة البند في حساب إنجاز المشروع، ولا يغيّر نسبة إنجاز البند.
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          if (saving) return;
          const weight = parseActivityWeight(value);
          if (weight === null) {
            setError("أدخل وزناً من 0.01 إلى 100.");
            return;
          }
          setError("");
          await onSave(weight);
        }}>
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">الوزن النوعي (النسبي)</label>
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={100}
              step="any"
              value={value}
              onChange={event => { setValue(event.target.value); setError(""); }}
              onFocus={event => event.target.select()}
              autoFocus
              disabled={saving}
              dir="ltr"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
            />
            <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
              من 0.01 إلى 100. لا يشترط أن يكون مجموع أوزان البنود 100.
            </p>
            {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
