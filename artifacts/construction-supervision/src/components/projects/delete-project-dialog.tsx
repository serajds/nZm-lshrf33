import { useEffect, useState, type MouseEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PortfolioProject } from "./types";

const createDeleteChallenge = () => {
  const firstNumber = Math.floor(Math.random() * 16) + 12;
  const secondNumber = Math.floor(Math.random() * 12) + 5;
  return { firstNumber, secondNumber, answer: firstNumber + secondNumber };
};

export const normalizeArabicDigits = (value: string) => value
  .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

interface Props {
  project: PortfolioProject | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (project: PortfolioProject) => void;
}

export function DeleteProjectDialog({ project: deletingProject, pending, onClose, onConfirm }: Props) {
  const [deleteChallenge, setDeleteChallenge] = useState(createDeleteChallenge);
  const [deleteAnswer, setDeleteAnswer] = useState("");
  useEffect(() => {
    if (deletingProject) { setDeleteChallenge(createDeleteChallenge()); setDeleteAnswer(""); }
  }, [deletingProject?.id]);
  const setDeletingProject = (_: null) => onClose();
  const isDeleteAnswerCorrect = Number(normalizeArabicDigits(deleteAnswer.trim())) === deleteChallenge.answer;
  const deleteProject = { isPending: pending };
  const confirmDelete = (e: MouseEvent) => {
    e.preventDefault();
    if (deletingProject && isDeleteAnswerCorrect) onConfirm(deletingProject);
  };
  const hasChildren = deletingProject?.portfolioRelation === "main";

  return (
<AlertDialog open={!!deletingProject} onOpenChange={(open) => {
  if (!open) {
    setDeletingProject(null);
    setDeleteAnswer("");
  }
}}>
  <AlertDialogContent dir="rtl">
    <AlertDialogHeader>
      <AlertDialogTitle className="flex items-center gap-2 text-destructive">
        <TriangleAlert className="h-5 w-5" />
        تحذير شديد: حذف نهائي للمشروع
      </AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6 text-foreground">
            سيُحذف مشروع <strong>«{deletingProject?.name}»</strong> نهائياً، بما في ذلك الأنشطة والتقارير والملفات والأعضاء والبيانات المرتبطة به.
            {hasChildren && <span className="mt-2 block font-semibold">لا يمكن حذف هذا الرئيسي قبل فك ارتباط مشاريعه الفرعية. لن تُحذف المشاريع التابعة ضمنياً.</span>}
<strong className="mt-2 block text-destructive">لا يمكن التراجع عن هذا الإجراء أو استعادة البيانات بعد الحذف.</strong>
          </div>
          <div className="rounded-lg border bg-muted/40 p-4">
            <label htmlFor="delete-project-math" className="mb-2 block text-sm font-semibold text-foreground">
              للتأكيد، أجب عن المسألة التالية:
            </label>
            <p className="mb-3 text-lg font-bold text-foreground" dir="ltr">
              {deleteChallenge.firstNumber} + {deleteChallenge.secondNumber} = ?
            </p>
            <Input
              id="delete-project-math"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={deleteAnswer}
              onChange={(event) => setDeleteAnswer(event.target.value)}
              placeholder="اكتب الناتج"
              className="bg-background"
              aria-describedby="delete-project-math-help"
            />
            <p id="delete-project-math-help" className="mt-2 text-xs text-muted-foreground">
              لن يتفعّل الحذف إلا بعد إدخال الإجابة الصحيحة.
            </p>
          </div>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter className="flex-row-reverse gap-2">
      <AlertDialogCancel>إلغاء</AlertDialogCancel>
      <AlertDialogAction 
        onClick={confirmDelete}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        disabled={deleteProject.isPending || !isDeleteAnswerCorrect}
      >
        {deleteProject.isPending ? "جاري الحذف..." : "حذف المشروع"}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

  );
}
