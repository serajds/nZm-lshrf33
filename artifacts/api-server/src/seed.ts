import { db } from "@workspace/db";
import { usersTable, projectsTable, activitiesTable, reportsTable } from "@workspace/db";
import { hashPassword } from "./lib/auth";
import { logger } from "./lib/logger";

export async function seed() {
  if (process.env.NODE_ENV !== "development") {
    logger.info("Skipping seed in non-development environment");
    return;
  }
  try {
    const existingUsers = await db.select().from(usersTable).limit(1);
    if (existingUsers.length > 0) {
      logger.info("Database already seeded, skipping...");
      return;
    }

    logger.info("Seeding database...");

    const adminHash = await hashPassword("admin123");
    const engineerHash = await hashPassword("engineer123");

    const [admin] = await db.insert(usersTable).values({
      username: "admin",
      passwordHash: adminHash,
      fullName: "محمد أحمد المدير",
      email: "admin@supervision.sa",
      role: "admin",
    }).returning();

    await db.insert(usersTable).values({
      username: "engineer1",
      passwordHash: engineerHash,
      fullName: "خالد عبدالله المهندس",
      email: "khalid@supervision.sa",
      role: "engineer",
    });

    const today = new Date();
    const addDays = (d: Date, n: number) => {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r.toISOString().split("T")[0];
    };

    const [project1] = await db.insert(projectsTable).values({
      name: "مبنى مجمع الوزارات - المرحلة الثانية",
      location: "الرياض - حي العليا",
      ownerEntity: "وزارة الشؤون البلدية والقروية",
      supervisorEntity: "شركة الاستشارات الهندسية المتقدمة",
      contractor: "مجموعة بن لادن السعودية للمقاولات",
      startDate: addDays(today, -180),
      expectedEndDate: addDays(today, 180),
      status: "active",
      overallProgress: 45,
    }).returning();

    const [project2] = await db.insert(projectsTable).values({
      name: "جسر الملك عبدالله - المقطع الثالث",
      location: "جدة - طريق الكورنيش",
      ownerEntity: "أمانة محافظة جدة",
      supervisorEntity: "مكتب هندسة المنشآت",
      contractor: "شركة المقاولات الدولية",
      startDate: addDays(today, -90),
      expectedEndDate: addDays(today, 270),
      status: "delayed",
      overallProgress: 20,
    }).returning();

    await db.insert(projectsTable).values({
      name: "مستشفى الملك فيصل التخصصي - الجناح الشمالي",
      location: "الدمام - حي الفيصلية",
      ownerEntity: "وزارة الصحة",
      supervisorEntity: "شركة الاستشارات الهندسية المتقدمة",
      contractor: "شركة البناء الحديث",
      startDate: addDays(today, -360),
      expectedEndDate: addDays(today, -30),
      status: "completed",
      overallProgress: 100,
    });

    // Add activities for project 1
    await db.insert(activitiesTable).values([
      {
        projectId: project1.id,
        name: "أعمال الحفر والترابية",
        plannedStartDate: addDays(today, -180),
        plannedEndDate: addDays(today, -120),
        actualStartDate: addDays(today, -178),
        actualEndDate: addDays(today, -118),
        plannedProgress: 100,
        actualProgress: 100,
        status: "completed",
        sortOrder: 1,
      },
      {
        projectId: project1.id,
        name: "أعمال الأساسات والخوازيق",
        plannedStartDate: addDays(today, -120),
        plannedEndDate: addDays(today, -80),
        actualStartDate: addDays(today, -117),
        actualEndDate: addDays(today, -75),
        plannedProgress: 100,
        actualProgress: 100,
        status: "completed",
        sortOrder: 2,
      },
      {
        projectId: project1.id,
        name: "أعمال الهيكل الخرساني",
        plannedStartDate: addDays(today, -80),
        plannedEndDate: addDays(today, 20),
        actualStartDate: addDays(today, -75),
        plannedProgress: 80,
        actualProgress: 65,
        status: "in_progress",
        sortOrder: 3,
      },
      {
        projectId: project1.id,
        name: "أعمال البناء والطابوق",
        plannedStartDate: addDays(today, -10),
        plannedEndDate: addDays(today, 60),
        plannedProgress: 10,
        actualProgress: 5,
        status: "in_progress",
        sortOrder: 4,
      },
      {
        projectId: project1.id,
        name: "أعمال التشطيبات الداخلية",
        plannedStartDate: addDays(today, 60),
        plannedEndDate: addDays(today, 140),
        plannedProgress: 0,
        actualProgress: 0,
        status: "not_started",
        sortOrder: 5,
      },
      {
        projectId: project1.id,
        name: "أعمال الكهرباء والميكانيكا",
        plannedStartDate: addDays(today, 80),
        plannedEndDate: addDays(today, 160),
        plannedProgress: 0,
        actualProgress: 0,
        status: "not_started",
        sortOrder: 6,
      },
    ]);

    // Add activities for project 2
    await db.insert(activitiesTable).values([
      {
        projectId: project2.id,
        name: "أعمال الكوبري والتأسيس",
        plannedStartDate: addDays(today, -90),
        plannedEndDate: addDays(today, -30),
        actualStartDate: addDays(today, -85),
        plannedProgress: 100,
        actualProgress: 55,
        status: "delayed",
        sortOrder: 1,
      },
      {
        projectId: project2.id,
        name: "أعمال الدعامات الرئيسية",
        plannedStartDate: addDays(today, -30),
        plannedEndDate: addDays(today, 90),
        plannedProgress: 30,
        actualProgress: 0,
        status: "not_started",
        sortOrder: 2,
      },
    ]);

    // Add reports
    await db.insert(reportsTable).values([
      {
        projectId: project1.id,
        type: "monthly",
        reportDate: addDays(today, -30),
        periodStart: addDays(today, -60),
        periodEnd: addDays(today, -30),
        workDescription: "تم إنجاز أعمال الهيكل الخرساني للطابق الأرضي والأول بالكامل. كما بدأت أعمال الطابق الثاني وتم إنجاز 30% منها. تم إجراء اختبارات الضغط على الخرسانة وجاءت النتائج مرضية.",
        progressPercentage: 38,
        technicalNotes: "تم ملاحظة بعض التشققات الصغيرة في منطقة الجدار الشرقي، تم معالجتها فوراً من قبل المقاول.",
        recommendations: "يُنصح بزيادة عدد العمالة في مرحلة الهيكل الخرساني لتعويض التأخر الحاصل وإعادة المشروع لجدوله الزمني.",
        imageUrls: [],
        createdById: admin.id,
      },
      {
        projectId: project1.id,
        type: "weekly",
        reportDate: addDays(today, -7),
        periodStart: addDays(today, -14),
        periodEnd: addDays(today, -7),
        workDescription: "استمرت أعمال الهيكل الخرساني في الطابق الثالث. تم صب خرسانة الأعمدة والجسور. تقدمت أعمال البناء والطابوق في الطابق الأرضي.",
        progressPercentage: 43,
        technicalNotes: "جودة الخرسانة المستخدمة مطابقة للمواصفات.",
        recommendations: "مواصلة العمل وفق الجدول الزمني المعتمد.",
        imageUrls: [],
        createdById: admin.id,
      },
    ]);

    logger.info("Database seeded successfully!");
  } catch (error) {
    logger.error({ error }, "Error seeding database");
  }
}
