import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import jwt from "jsonwebtoken";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyToken } from "./lib/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const uploadsDir = path.join(process.cwd(), "uploads");

app.use("/api/uploads", (req: Request, res: Response, next: NextFunction) => {
  const reqPath = decodeURIComponent(req.path).replace(/^\//, "");
  if (reqPath.startsWith("logo-")) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const tokenParam = typeof req.query.token === "string" ? req.query.token : null;
    if (tokenParam) {
      if (verifyToken(tokenParam)) return next();
      try {
        const ownerSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-owner-secret-key-change-in-prod";
        const decoded = jwt.verify(tokenParam, ownerSecret) as any;
        if (decoded.ownerToken && decoded.projectId) return next();
      } catch {}
    }
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const token = authHeader.slice(7);
  if (verifyToken(token)) return next();
  try {
    const ownerSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-owner-secret-key-change-in-prod";
    const decoded = jwt.verify(token, ownerSecret) as any;
    if (decoded.ownerToken && decoded.projectId) return next();
  } catch {}
  res.status(401).json({ error: "رمز الدخول غير صالح" });
}, (req: Request, res: Response, next: NextFunction) => {
  express.static(uploadsDir)(req, res, next);
});

app.use("/api", router);

export default app;
