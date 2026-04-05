import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, reportsTable, activitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

router.get("/projects/:projectId/reports/export-pdf", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.projectId, projectId))
    .orderBy(reportsTable.reportDate);

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder);

  const doc = new PDFDocument({ 
    margin: 50, 
    size: "A4",
    info: {
      Title: `تقارير المشروع - ${project.name}`,
      Author: "نظام الإشراف الهندسي",
    }
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="project-${projectId}-reports.pdf"`);
  doc.pipe(res);

  const centerX = doc.page.width / 2;

  doc.fontSize(20).text(`نظام الإشراف الهندسي`, { align: "center" });
  doc.fontSize(16).text(`تقارير المشروع`, { align: "center" });
  doc.moveDown(0.5);

  doc.fontSize(14).text(`${project.name}`, { align: "center" });
  doc.fontSize(10).text(`الموقع: ${project.location}  |  المقاول: ${project.contractor}`, { align: "center" });
  doc.moveDown(0.5);

  const today = new Date().toLocaleDateString("en-SA");
  doc.fontSize(9).text(`تاريخ الإصدار: ${today}  |  نسبة الإنجاز الكلية: ${project.overallProgress}%`, { align: "center" });

  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown();

  if (activities.length > 0) {
    doc.fontSize(13).text("ملخص الأنشطة", { underline: true });
    doc.moveDown(0.3);

    activities.forEach((act, i) => {
      doc.fontSize(10).text(
        `${i + 1}. ${act.name}  |  المخطط: ${act.plannedProgress}%  |  الفعلي: ${act.actualProgress}%`,
        { indent: 10 }
      );
    });
    doc.moveDown();
  }

  if (reports.length === 0) {
    doc.fontSize(11).text("لا توجد تقارير مسجلة لهذا المشروع.", { align: "center" });
  } else {
    doc.fontSize(13).text(`التقارير الدورية (${reports.length})`, { underline: true });
    doc.moveDown(0.5);

    reports.forEach((report, idx) => {
      if (doc.y > doc.page.height - 150) {
        doc.addPage();
      }

      const typeLabel = report.type === "weekly" ? "أسبوعي" : "شهري";
      const dateStr = new Date(report.reportDate).toLocaleDateString("en-SA");

      doc.fontSize(12).text(`تقرير ${typeLabel} - ${dateStr}`, { underline: true });
      doc.fontSize(10).text(`نسبة الإنجاز للفترة: ${report.progressPercentage}%`);
      doc.moveDown(0.2);

      doc.fontSize(10).text("وصف الأعمال المنجزة:", { continued: false });
      doc.fontSize(9).text(report.workDescription || "-", { indent: 15 });
      doc.moveDown(0.2);

      if (report.technicalNotes) {
        doc.fontSize(10).text("ملاحظات فنية:", { continued: false });
        doc.fontSize(9).text(report.technicalNotes, { indent: 15 });
        doc.moveDown(0.2);
      }

      if (report.recommendations) {
        doc.fontSize(10).text("التوصيات:", { continued: false });
        doc.fontSize(9).text(report.recommendations, { indent: 15 });
        doc.moveDown(0.2);
      }

      if (report.imageUrls && report.imageUrls.length > 0) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        const validImages: string[] = [];

        for (const imgUrl of report.imageUrls) {
          try {
            const filename = path.basename(imgUrl.split("?")[0]);
            const imgPath = path.join(uploadsDir, filename);
            if (fs.existsSync(imgPath)) {
              validImages.push(imgPath);
            }
          } catch {
            // skip invalid image path
          }
        }

        if (validImages.length > 0) {
          doc.moveDown(0.3);
          doc.fontSize(10).text("صور الموقع:", { continued: false });
          doc.moveDown(0.2);

          const imgSize = 150;
          const gapX = 15;
          const leftMargin = 50;
          const imgsPerRow = 3;

          for (let imgIdx = 0; imgIdx < validImages.length; imgIdx++) {
            const col = imgIdx % imgsPerRow;
            const x = leftMargin + col * (imgSize + gapX);
            const y = doc.y;

            if (y + imgSize > doc.page.height - 80) {
              doc.addPage();
            }

            const currentY = doc.y;
            try {
              doc.image(validImages[imgIdx], x, currentY, {
                fit: [imgSize, imgSize],
              });
            } catch {
              // skip image that can't be embedded
            }

            if (col === imgsPerRow - 1 || imgIdx === validImages.length - 1) {
              doc.y = currentY + imgSize + 8;
              doc.x = leftMargin;
            }
          }

          doc.moveDown(0.3);
        }
      }

      if (idx < reports.length - 1) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);
      }
    });
  }

  doc.end();
});

export default router;
