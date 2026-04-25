import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Camera, RotateCcw } from "lucide-react";

interface SelfieCameraDialogProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  title?: string;
}

export function SelfieCameraDialog({ open, onClose, onCapture, title = "التقاط صورة من الموقع" }: SelfieCameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  async function startStream() {
    setError(null);
    setStarting(true);
    stopStream();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("المتصفح لا يدعم الوصول إلى الكاميرا");
      }
      let stream: MediaStream;
      try {
        // Prefer rear camera so the photo captures the actual site, not the user's face.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        // fallback to any available camera
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "تعذّر تشغيل الكاميرا";
      setError(`${msg}. يرجى السماح بالوصول إلى الكاميرا من إعدادات المتصفح.`);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (open) {
      setPreviewUrl(null);
      setPreviewBlob(null);
      startStream();
    } else {
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewBlob(null);
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 720;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const url = URL.createObjectURL(blob);
        setPreviewBlob(blob);
        setPreviewUrl(url);
        stopStream();
      },
      "image/jpeg",
      0.85,
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    startStream();
  }

  function confirm() {
    if (!previewBlob) return;
    const file = new File([previewBlob], `site-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3 border border-destructive/30">
              {error}
            </div>
          ) : null}
          <div className="relative w-full bg-black rounded-md overflow-hidden aspect-square flex items-center justify-center">
            {previewUrl ? (
              <img src={previewUrl} alt="معاينة" className="w-full h-full object-cover" />
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {starting ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                ) : null}
              </>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          {previewUrl ? (
            <>
              <Button variant="secondary" onClick={retake}>
                <RotateCcw className="h-4 w-4 ml-1" /> إعادة الالتقاط
              </Button>
              <Button onClick={confirm}>تأكيد</Button>
            </>
          ) : (
            <Button onClick={capture} disabled={!!error || starting}>
              <Camera className="h-4 w-4 ml-1" /> التقاط
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
