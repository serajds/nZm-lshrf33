import type { RequestHandler } from "express";

const REPORT_SHARE_UPLOAD_PATH = "/api/public/report-image-shares/upload";

export function createReportShareUploadAdmission(): RequestHandler {
  let occupied = false;

  return (req, res, next) => {
    const requestPath = req.originalUrl.split("?")[0];
    if (req.method !== "POST" || requestPath !== REPORT_SHARE_UPLOAD_PATH) {
      next();
      return;
    }

    if (occupied) {
      res.setHeader("Retry-After", "2");
      res.status(429).json({
        error: "النظام يعالج صورة أخرى الآن. ستتم إعادة المحاولة تلقائيًا.",
        retryable: true,
      });
      return;
    }

    occupied = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      occupied = false;
    };

    res.once("finish", release);
    res.once("close", release);
    req.once("aborted", release);
    next();
  };
}
