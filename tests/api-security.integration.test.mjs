import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const enabled = process.env.API_SECURITY_TESTS === "1";

test("project capabilities, private uploads, attendance selfies, and form writes are scoped", {
  skip: !enabled,
  timeout: 60_000,
}, async () => {
  assert.equal(process.env.NODE_ENV, "development", "security fixtures may run only with NODE_ENV=development");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to the development fixture database");
  const configuredDatabase = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  const expectedDatabase = process.env.API_SECURITY_TEST_DB_NAME;
  assert.ok(expectedDatabase, "set API_SECURITY_TEST_DB_NAME to the exact development database name");
  assert.equal(configuredDatabase, expectedDatabase, "refusing to run against an unexpected database");
  assert.doesNotMatch(configuredDatabase, /prod|production|live/i, "refusing a production-named database");

  const [{ default: app }, auth, dbModule, drizzle] = await Promise.all([
    import("../artifacts/api-server/src/app.ts"),
    import("../artifacts/api-server/src/lib/auth.ts"),
    import("../lib/db/src/index.ts"),
    import("../lib/db/node_modules/drizzle-orm/index.js"),
  ]);
  const { db, pool } = dbModule;
  const schema = dbModule;
  const {
    companiesTable,
    attendanceRecordsTable,
    formSubmissionsTable,
    formTemplatesTable,
    projectFilesTable,
    projectMembersTable,
    projectsTable,
    userCompaniesTable,
    usersTable,
  } = schema;
  const { eq, inArray } = drizzle;

  const marker = `security-fixture-${randomUUID()}`;
  const ownerToken = `${marker}-owner`;
  const filename = `${marker}.pdf`;
  const duplicateFilename = `${marker}-duplicate.pdf`;
  const attendanceFilename = `${marker}-selfie.jpg`;
  const attendancePayload = Buffer.from(`${marker}-selfie-payload`);
  const created = { companyId: null, contractorCompanyId: null, userIds: [], projectIds: [], templateId: null, submissionId: null, attendanceRecordId: null };
  const testUpload = Buffer.from(`${marker}-unauthorized-logo`);
  const createdUploadPaths = [];
  const createdLocalFiles = [];
  let server;

  try {
    const [company] = await db.insert(companiesTable).values({
      name: marker,
      type: "owner",
    }).returning({ id: companiesTable.id });
    created.companyId = company.id;
    const [contractorCompany] = await db.insert(companiesTable).values({
      name: `${marker} Contractor Company`,
      type: "contractor",
    }).returning({ id: companiesTable.id });
    created.contractorCompanyId = contractorCompany.id;

    const users = await db.insert(usersTable).values([
      { phone: `${marker}-editor`, passwordHash: "test-only", fullName: `${marker} Editor`, role: "engineer" },
      { phone: `${marker}-viewer`, passwordHash: "test-only", fullName: `${marker} Viewer`, role: "engineer" },
      { phone: `${marker}-author`, passwordHash: "test-only", fullName: `${marker} Author`, role: "engineer" },
      { phone: `${marker}-pm`, passwordHash: "test-only", fullName: `${marker} PM`, role: "project_manager" },
      { phone: `${marker}-contractor`, passwordHash: "test-only", fullName: `${marker} Contractor`, role: "contractor" },
      { phone: `${marker}-stale-contractor-pm`, passwordHash: "test-only", fullName: `${marker} Stale Contractor PM`, role: "contractor" },
      { phone: `${marker}-company-pm`, passwordHash: "test-only", fullName: `${marker} Contractor Company PM`, role: "engineer" },
    ]).returning({ id: usersTable.id, phone: usersTable.phone, role: usersTable.role });
    created.userIds = users.map(user => user.id);
    const [editor, viewer, author, projectManager, contractor, staleContractorPm, contractorCompanyPm] = users;

    const projects = await db.insert(projectsTable).values([
      {
        name: `${marker} Member Project`,
        location: "Fixture",
        ownerEntity: marker,
        supervisorEntity: marker,
        contractor: marker,
        noSchedule: true,
        ownerAccessToken: ownerToken,
        ownerAccessPassword: null,
        ownerCompanyId: company.id,
        contractorCompanyId: contractorCompany.id,
      },
      {
        name: `${marker} Other Project`,
        location: "Fixture",
        ownerEntity: marker,
        supervisorEntity: marker,
        contractor: marker,
        noSchedule: true,
      },
    ]).returning({ id: projectsTable.id });
    created.projectIds = projects.map(project => project.id);
    const [memberProjectId, otherProjectId] = created.projectIds;

    await db.insert(userCompaniesTable).values(created.userIds.map(userId => ({
      userId,
      companyId: company.id,
    })));
    await db.insert(userCompaniesTable).values({
      userId: contractorCompanyPm.id,
      companyId: contractorCompany.id,
    });
    await db.insert(projectMembersTable).values([
      {
        projectId: memberProjectId,
        userId: editor.id,
        role: "engineer",
        tabPermissions: { forms: "edit" },
      },
      {
        projectId: memberProjectId,
        userId: viewer.id,
        role: "engineer",
        tabPermissions: { forms: "view" },
      },
      {
        projectId: memberProjectId,
        userId: contractor.id,
        role: "contractor",
      },
      {
        projectId: memberProjectId,
        userId: staleContractorPm.id,
        role: "project_manager",
      },
      {
        projectId: memberProjectId,
        userId: contractorCompanyPm.id,
        role: "project_manager",
      },
    ]);

    await db.insert(projectFilesTable).values({
      projectId: otherProjectId,
      filename,
      originalName: filename,
      category: "pdf",
      fileUrl: `/api/uploads/${filename}`,
      fileSize: 1,
      mimeType: "application/pdf",
    });
    await db.insert(projectFilesTable).values([
      {
        projectId: memberProjectId,
        filename: duplicateFilename,
        originalName: duplicateFilename,
        category: "pdf",
        fileUrl: `/api/uploads/${duplicateFilename}`,
        fileSize: 1,
        mimeType: "application/pdf",
      },
      {
        projectId: otherProjectId,
        filename: duplicateFilename,
        originalName: duplicateFilename,
        category: "pdf",
        fileUrl: `/api/uploads/${duplicateFilename}`,
        fileSize: 1,
        mimeType: "application/pdf",
      },
    ]);
    const contractorFilename = `${marker}-contractor.pdf`;
    await db.insert(projectFilesTable).values({
      projectId: memberProjectId,
      filename: contractorFilename,
      originalName: contractorFilename,
      category: "pdf",
      fileUrl: `/api/uploads/${contractorFilename}`,
      fileSize: 1,
      mimeType: "application/pdf",
    });
    const [attendanceRecord] = await db.insert(attendanceRecordsTable).values({
      projectId: memberProjectId,
      userId: editor.id,
      type: "check_in",
      selfieFilename: attendanceFilename,
      selfieUrl: `/api/uploads/${attendanceFilename}`,
    }).returning({ id: attendanceRecordsTable.id });
    created.attendanceRecordId = attendanceRecord.id;
    const uploadsDir = path.join(process.cwd(), "uploads");
    const attendanceFilePath = path.join(uploadsDir, attendanceFilename);
    await writeFile(attendanceFilePath, attendancePayload, { flag: "wx" });
    createdLocalFiles.push(attendanceFilePath);
    const [template] = await db.insert(formTemplatesTable).values({
      projectId: memberProjectId,
      name: marker,
      fields: [],
      isDailyReport: true,
    }).returning({ id: formTemplatesTable.id });
    created.templateId = template.id;
    const [submission] = await db.insert(formSubmissionsTable).values({
      projectId: memberProjectId,
      templateId: template.id,
      submittedById: author.id,
      submittedByName: author.phone,
      reportDate: "2026-01-01",
      data: {},
    }).returning({ id: formSubmissionsTable.id });
    created.submissionId = submission.id;

    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const tokenFor = user => auth.signToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
    });
    const editorToken = tokenFor(editor);
    const viewerToken = tokenFor(viewer);
    const projectManagerToken = tokenFor(projectManager);
    const contractorToken = tokenFor(contractor);
    const staleContractorPmToken = tokenFor(staleContractorPm);
    const contractorCompanyPmToken = tokenFor(contractorCompanyPm);

    const memberProjectResponse = await fetch(`${baseUrl}/projects/${memberProjectId}`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.equal(memberProjectResponse.status, 200);
    const memberProject = await memberProjectResponse.json();
    assert.equal(memberProject.ownerAccessToken, undefined);
    assert.equal(memberProject.ownerAccessPassword, undefined);

    const projectListResponse = await fetch(`${baseUrl}/projects?search=${encodeURIComponent(marker)}`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.equal(projectListResponse.status, 200);
    const projectList = await projectListResponse.json();
    assert.ok(projectList.some(project => project.id === memberProjectId));
    assert.ok(projectList.every(project => project.ownerAccessToken === undefined));

    const dashboardResponse = await fetch(`${baseUrl}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.ok(dashboard.recentProjects.some(project => project.name === `${marker} Member Project`));
    assert.ok(dashboard.recentProjects.every(project =>
      project.ownerAccessToken === undefined && project.ownerAccessPassword === undefined
    ));

    const filesBeforeUnauthorizedCompanyPatch = new Set(await readdir(uploadsDir));
    const logoForm = new FormData();
    logoForm.append("logo", new Blob([testUpload], { type: "image/png" }), `${marker}.png`);
    const unauthorizedCompanyPatch = await fetch(`${baseUrl}/companies/${company.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${projectManagerToken}` },
      body: logoForm,
    });
    assert.equal(unauthorizedCompanyPatch.status, 403);
    for (const name of await readdir(uploadsDir)) {
      if (filesBeforeUnauthorizedCompanyPatch.has(name)) continue;
      const filePath = path.join(uploadsDir, name);
      if ((await readFile(filePath)).equals(testUpload)) createdUploadPaths.push(filePath);
    }
    assert.deepEqual(createdUploadPaths, [], "unauthorized company logo uploads must be rejected before disk write");

    const ownerVerifyResponse = await fetch(`${baseUrl}/owner/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ownerToken }),
    });
    assert.equal(ownerVerifyResponse.status, 200);
    const { ownerJwt } = await ownerVerifyResponse.json();
    assert.equal(typeof ownerJwt, "string");

    const ownerCrossProjectUpload = await fetch(
      `${baseUrl}/uploads/${encodeURIComponent(filename)}?token=${encodeURIComponent(ownerJwt)}`,
    );
    assert.notEqual(ownerCrossProjectUpload.status, 200, "owner JWT must not read another project's file");

    const memberCrossProjectUpload = await fetch(`${baseUrl}/uploads/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.notEqual(memberCrossProjectUpload.status, 200, "membership in one project must not grant another project's file");

    const duplicateFilenameResponse = await fetch(`${baseUrl}/uploads/${encodeURIComponent(duplicateFilename)}`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.notEqual(duplicateFilenameResponse.status, 200, "duplicate filenames across projects must fail closed");

    const contractorUpload = await fetch(`${baseUrl}/uploads/${encodeURIComponent(contractorFilename)}`, {
      headers: { Authorization: `Bearer ${contractorToken}` },
    });
    assert.notEqual(contractorUpload.status, 200, "contractor restrictions must also apply to direct file URLs");

    const authorizedSelfie = await fetch(`${baseUrl}/uploads/${encodeURIComponent(attendanceFilename)}`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    assert.equal(authorizedSelfie.status, 200);
    assert.deepEqual(Buffer.from(await authorizedSelfie.arrayBuffer()), attendancePayload);

    const foreignSelfie = await fetch(`${baseUrl}/uploads/${encodeURIComponent(attendanceFilename)}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.notEqual(foreignSelfie.status, 200, "another project member cannot read an employee's attendance selfie");

    for (const [label, token] of [
      ["globally contractor with stale PM membership", staleContractorPmToken],
      ["contractor-company member with stale PM membership", contractorCompanyPmToken],
    ]) {
      const legacyUpload = await fetch(`${baseUrl}/uploads/${encodeURIComponent(attendanceFilename)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.notEqual(legacyUpload.status, 200, `${label} must not read the attachment URL`);

      const photoRoute = await fetch(`${baseUrl}/attendance/records/${created.attendanceRecordId}/photo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(photoRoute.status, 403, `${label} must not receive photo access through the ID route`);
    }

    const deleteOtherSubmission = await fetch(
      `${baseUrl}/projects/${memberProjectId}/form-submissions/${created.submissionId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${editorToken}` },
      },
    );
    assert.equal(deleteOtherSubmission.status, 403);
    const [remainingSubmission] = await db.select({ id: formSubmissionsTable.id })
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.id, created.submissionId));
    assert.ok(remainingSubmission, "a non-owner engineer must not delete another user's submission");

    const skipDay = await fetch(`${baseUrl}/projects/${memberProjectId}/skip-day`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateId: created.templateId,
        date: "2026-01-02",
        reason: marker,
      }),
    });
    assert.equal(skipDay.status, 403, "view-only forms permission must not allow skip-day writes");
  } finally {
    await Promise.all(createdUploadPaths.map(filePath => unlink(filePath).catch(() => {})));
    await Promise.all(createdLocalFiles.map(filePath => unlink(filePath).catch(() => {})));
    if (server) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
    if (created.projectIds.length > 0) {
      await db.delete(projectFilesTable).where(inArray(projectFilesTable.projectId, created.projectIds));
      await db.delete(projectsTable).where(inArray(projectsTable.id, created.projectIds));
    }
    if (created.userIds.length > 0) {
      await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, created.userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, created.userIds));
    }
    if (created.companyId !== null) {
      await db.delete(companiesTable).where(eq(companiesTable.id, created.companyId));
    }
    if (created.contractorCompanyId !== null) {
      await db.delete(companiesTable).where(eq(companiesTable.id, created.contractorCompanyId));
    }
    await pool.end();
  }
});