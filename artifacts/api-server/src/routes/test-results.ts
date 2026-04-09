import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { getUncachableOneDriveClient } from "../lib/onedrive";

const router: IRouter = Router();
const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.SESSION_SECRET ||
  "dev-owner-secret-key-change-in-prod";

router.get(
  "/owner/:token/test-results",
  async (req, res): Promise<void> => {
    const { token } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }

    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as {
        ownerToken: string;
        projectId: number;
      };
      if (decoded.ownerToken !== token) {
        res.status(401).json({ error: "غير مصرح" });
        return;
      }
    } catch {
      res.status(401).json({ error: "انتهت صلاحية الجلسة" });
      return;
    }

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.ownerAccessToken, token));

    if (!project) {
      res.status(404).json({ error: "المشروع غير موجود" });
      return;
    }

    const folderId = project.onedriveTestResultsFolderId;
    if (!folderId) {
      res.json({ files: [], folderLinked: false });
      return;
    }

    try {
      const client = await getUncachableOneDriveClient();
      const result = await client
        .api(`/me/drive/items/${folderId}/children`)
        .select("id,name,size,lastModifiedDateTime,file,webUrl,@microsoft.graph.downloadUrl")
        .get();

      const files = (result.value || [])
        .filter((item: any) => item.file)
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          size: item.size,
          lastModified: item.lastModifiedDateTime,
          mimeType: item.file?.mimeType || "application/octet-stream",
          downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
          webUrl: item.webUrl,
        }));

      res.json({ files, folderLinked: true });
    } catch (err: any) {
      console.error("OneDrive API error:", err?.message || err);
      if (err?.statusCode === 404 || err?.code === "itemNotFound") {
        res.status(404).json({ error: "مجلد OneDrive غير موجود" });
        return;
      }
      res.status(500).json({ error: "حدث خطأ أثناء جلب الملفات من OneDrive" });
    }
  },
);

export default router;
