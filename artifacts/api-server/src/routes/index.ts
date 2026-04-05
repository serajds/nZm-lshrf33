import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import activitiesRouter from "./activities";
import reportsRouter from "./reports";
import filesRouter from "./files";
import usersRouter from "./users";
import ownerRouter from "./owner";
import dashboardRouter from "./dashboard";
import pdfRouter from "./pdf";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(activitiesRouter);
router.use(pdfRouter);
router.use(reportsRouter);
router.use(filesRouter);
router.use(usersRouter);
router.use(ownerRouter);
router.use(dashboardRouter);

export default router;
