import type { Response } from "express";
import { ImageProcessingError } from "./image-processing";

export function sendImageUploadError(res: Response, error: unknown): void {
  if (res.destroyed || res.headersSent) return;
  const code = error instanceof ImageProcessingError ? error.code : "image_upload_failed";
  const retryable = error instanceof ImageProcessingError && error.retryable;
  const busy = ["principal_image_busy", "image_capacity_busy", "processing_busy", "image_in_progress"].includes(code);
  const large = ["source_size_limit", "pixel_limit", "quality_preserving_output_too_large"].includes(code);
  const qualityLimit = code === "quality_preserving_output_too_large";
  const invalid = ["invalid_or_unsupported_image", "unsupported_format", "animated_image", "invalid_svg",
    "invalid_image_packet", "invalid_prepared_image", "invalid_image_identity"].includes(code);
  const status = busy ? 429 : large ? 413 : invalid ? 415 : code === "cancelled" ? 499
    : code === "idempotency_content_conflict" ? 409 : code === "image_reference_removed" ? 410
      : retryable || code === "image_storage_unconfigured" ? 503 : 500;
  const message = busy ? "النظام يعالج صورًا أخرى الآن. أعد المحاولة بعد لحظات."
    : qualityLimit ? "تعذر حفظ تفاصيل الصورة ضمن الجودة المختارة. اختر مستوى جودة أعلى أو صورة مناسبة للحد الآمن."
      : large ? "تجاوزت الصورة حدود الحجم أو الدقة الآمنة. جرّب نسخة أصغر."
      : invalid ? "الصورة غير صالحة أو متحركة أو غير مدعومة. استخدم JPG أو PNG أو WebP أو SVG صالحًا أو GIF ثابتًا."
        : code === "cancelled" ? "أُلغي رفع الصورة."
          : code === "idempotency_content_conflict" ? "تغير محتوى الصورة أثناء إعادة المحاولة. اختر الصورة من جديد."
            : "تعذّر تأكيد حفظ الصورة. لم يُعلن اكتمال الرفع؛ أعد المحاولة.";
  if (retryable || busy) res.setHeader("Retry-After", "2");
  res.status(status).json({ error: message, code, retryable: retryable || busy });
}
