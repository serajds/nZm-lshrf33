import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type ProgressActivity = { id: number; name: string; actualProgress: number };

interface ActivityProgressDialogProps {
  activity: ProgressActivity | null;
  saving: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSave: (progress: number) => Promise<void>;
}

export function ActivityProgressDialog({ activity, saving, onClose, onCloseAutoFocus, onSave }: ActivityProgressDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(activity ? String(activity.actualProgress) : "");
    setError("");
  }, [activity]);

  return (
    <Dialog open={activity !== null} onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-sm" dir="rtl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>تحديد نسبة الإنجاز</DialogTitle>
          <DialogDescription className="break-words">
            {activity?.name} — أدخل نسبة من 0 إلى 100.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={async event => {
          event.preventDefault();
          if (saving) return;
          const progress = Number(value);
          if (!value.trim() || !Number.isFinite(progress) || progress < 0 || progress > 100) {
            setError("أدخل نسبة صحيحة من 0 إلى 100.");
            return;
          }
          setError("");
          await onSave(progress);
        }} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">نسبة الإنجاز (%)</label>
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={value}
              onChange={event => { setValue(event.target.value); setError(""); }}
              onFocus={event => event.target.select()}
              autoFocus
              disabled={saving}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${inputId}-error` : undefined}
              dir="ltr"
            />
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
