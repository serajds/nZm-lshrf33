import { toast as sonnerToast } from "sonner";

type ToastOptions = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

function toast({ title, description, variant }: ToastOptions) {
  if (variant === "destructive") {
    sonnerToast.error(title, { description, duration: 4000 });
  } else {
    sonnerToast.success(title, { description, duration: 3000 });
  }
}

function useToast() {
  return { toast };
}

export { useToast, toast };
