import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { getUncachableOneDriveClient } from "../lib/onedrive";
import { requireAdmin } from "../middlewares/auth";

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

    const rootFolderId = project.onedriveTestResultsFolderId;
    if (!rootFolderId) {
      res.json({ files: [], folders: [], folderLinked: false });
      return;
    }

    const subfolderId = typeof req.query.subfolderId === "string" ? req.query.subfolderId : null;
    const targetFolderId = subfolderId || rootFolderId;

    try {
      const client = await getUncachableOneDriveClient();

      if (subfolderId) {
        let currentId = subfolderId;
        let isChild = false;
        for (let i = 0; i < 10; i++) {
          if (currentId === rootFolderId) { isChild = true; break; }
          try {
            const item = await client.api(`/me/drive/items/${currentId}`).select("parentReference").get();
            currentId = item.parentReference?.id;
            if (!currentId) break;
          } catch { break; }
        }
        if (!isChild) {
          res.status(403).json({ error: "المجلد المطلوب خارج نطاق المشروع" });
          return;
        }
      }

      const result = await client
        .api(`/me/drive/items/${targetFolderId}/children`)
        .select("id,name,size,lastModifiedDateTime,file,folder,webUrl,@microsoft.graph.downloadUrl")
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

      const folders = (result.value || [])
        .filter((item: any) => item.folder)
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          childCount: item.folder?.childCount ?? 0,
          lastModified: item.lastModifiedDateTime,
        }));

      res.json({
        files,
        folders,
        folderLinked: true,
        currentFolderId: targetFolderId,
        isRoot: targetFolderId === rootFolderId,
      });
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

router.get(
  "/owner/:token/test-results/download/:fileId",
  async (req, res): Promise<void> => {
    const { token, fileId } = req.params;
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

    if (!project || !project.onedriveTestResultsFolderId) {
      res.status(404).json({ error: "المشروع أو المجلد غير موجود" });
      return;
    }

    try {
      const client = await getUncachableOneDriveClient();

      const fileMeta = await client
        .api(`/me/drive/items/${fileId}`)
        .select("name,file,parentReference")
        .get();

      const rootFolderId = project.onedriveTestResultsFolderId;
      let parentId = fileMeta.parentReference?.id;
      let belongsToProject = false;
      for (let i = 0; i < 10; i++) {
        if (!parentId) break;
        if (parentId === rootFolderId) { belongsToProject = true; break; }
        try {
          const parent = await client.api(`/me/drive/items/${parentId}`).select("parentReference").get();
          parentId = parent.parentReference?.id;
        } catch { break; }
      }
      if (!belongsToProject) {
        res.status(403).json({ error: "الملف لا ينتمي لمجلد المشروع" });
        return;
      }

      const downloadUrl = (await client
        .api(`/me/drive/items/${fileId}`)
        .select("@microsoft.graph.downloadUrl")
        .get())["@microsoft.graph.downloadUrl"];

      if (!downloadUrl) {
        res.status(404).json({ error: "رابط التحميل غير متوفر" });
        return;
      }

      const fileResponse = await fetch(downloadUrl);
      if (!fileResponse.ok || !fileResponse.body) {
        res.status(502).json({ error: "فشل تحميل الملف من OneDrive" });
        return;
      }

      const fileName = encodeURIComponent(fileMeta.name || "file");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`);
      res.setHeader("Content-Type", fileMeta.file?.mimeType || "application/octet-stream");

      const reader = fileResponse.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } catch (err: any) {
      console.error("Download proxy error:", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: "حدث خطأ أثناء تحميل الملف" });
      }
    }
  },
);

router.get(
  "/onedrive/browse",
  requireAdmin,
  async (req, res): Promise<void> => {
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : null;

    try {
      const client = await getUncachableOneDriveClient();
      const path = folderId
        ? `/me/drive/items/${folderId}/children`
        : "/me/drive/root/children";

      const result = await client
        .api(path)
        .select("id,name,folder,file,size,lastModifiedDateTime,parentReference")
        .get();

      const items = (result.value || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        isFolder: !!item.folder,
        childCount: item.folder?.childCount ?? 0,
        size: item.size,
        lastModified: item.lastModifiedDateTime,
      }));

      let parentId: string | null = null;
      if (folderId) {
        try {
          const current = await client
            .api(`/me/drive/items/${folderId}`)
            .select("parentReference")
            .get();
          parentId = current.parentReference?.id || null;
        } catch {}
      }

      res.json({ items, parentId, currentFolderId: folderId || "root" });
    } catch (err: any) {
      console.error("OneDrive browse error:", err?.message || err);
      res.status(500).json({ error: "حدث خطأ أثناء تصفح OneDrive" });
    }
  },
);

export default router;
