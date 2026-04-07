import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  text?: string;
  className?: string;
}

export function LoadingSpinner({ text = "جاري التحميل...", className = "" }: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 gap-3 ${className}`}>
      <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/60">
        {icon}
      </div>
      <div>
        <p className="text-base font-semibold text-muted-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground/70 mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}
