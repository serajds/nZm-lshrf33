import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import {
  db,
  pool,
  companiesTable,
  projectMembersTable,
  projectsTable,
  userCompaniesTable,
  usersTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { signToken } from "../src/lib/auth";
import companiesRouter from "../src/routes/companies";

if (process.env.NODE_ENV !== "development" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  let server: Server | undefined;
  const userIds: number[] = [];
  const companyIds: number[] = [];
  const projectIds: number[] = [];

  try {
    const suffix = `company-access-${Date.now()}`;
    const createdUsers = await db.insert(usersTable).values([
      { phone: `${suffix}-admin`, passwordHash: "integration-test", fullName: "Company Test Admin", role: "admin" },
      { phone: `${suffix}-pm`, passwordHash: "integration-test", fullName: "Company Test PM", role: "project_manager" },
      { phone: `${suffix}-engineer`, passwordHash: "integration-test", fullName: "Company Test Engineer", role: "engineer" },
      { phone: `${suffix}-viewer`, passwordHash: "integration-test", fullName: "Company Test Viewer", role: "engineer" },
      { phone: `${suffix}-contractor`, passwordHash: "integration-test", fullName: "Company Test Contractor", role: "contractor" },
    ]).returning();
    userIds.push(...createdUsers.map(user => user.id));
    const [admin, pm, engineer, viewer, contractor] = createdUsers;
    const [linkedEngineer] = await db.insert(usersTable).values({
      phone: `${suffix}-linked-engineer`, passwordHash: "integration-test",
      fullName: "Contractor-company engineer", role: "engineer",
    }).returning();
    userIds.push(linkedEngineer.id);

    const [ownedCompany, memberOwnerCompany, memberContractorCompany, memberSupervisorCompany, foreignCompany] =
      await db.insert(companiesTable).values([
        { name: `${suffix} PM-owned`, type: "contractor", createdById: pm.id, email: "private@example.test", address: "private address" },
        { name: `${suffix} member-owner`, type: "owner", email: "private@example.test", address: "private address" },
        { name: `${suffix} member-contractor`, type: "contractor", email: "private@example.test", address: "private address" },
        { name: `${suffix} member-supervisor`, type: "supervisor", email: "private@example.test", address: "private address" },
        { name: `${suffix} foreign`, type: "contractor", email: "private@example.test", address: "private address" },
      ]).returning();
    companyIds.push(ownedCompany.id, memberOwnerCompany.id, memberContractorCompany.id, memberSupervisorCompany.id, foreignCompany.id);

    const projectBase = {
      location: "test",
      ownerEntity: "test",
      supervisorEntity: "test",
      contractor: "test",
      noSchedule: true,
    };
    const [memberProject, foreignProject] = await db.insert(projectsTable).values([
      {
        ...projectBase, name: `${suffix} member project`,
        ownerCompanyId: memberOwnerCompany.id,
        contractorCompanyId: memberContractorCompany.id,
        supervisorCompanyId: memberSupervisorCompany.id,
      },
      {
        ...projectBase, name: `${suffix} foreign project`,
        contractorCompanyId: foreignCompany.id,
      },
    ]).returning();
    projectIds.push(memberProject.id, foreignProject.id);

    await db.insert(projectMembersTable).values([
      { projectId: memberProject.id, userId: engineer.id, role: "engineer" },
      { projectId: memberProject.id, userId: viewer.id, role: "viewer" },
      { projectId: memberProject.id, userId: contractor.id, role: "contractor" },
      { projectId: memberProject.id, userId: linkedEngineer.id, role: "engineer" },
    ]);
    await db.insert(userCompaniesTable).values([
      { userId: contractor.id, companyId: memberContractorCompany.id },
      { userId: linkedEngineer.id, companyId: memberContractorCompany.id },
    ]);

    const app = express();
    app.use(express.json());
    app.use(companiesRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no port");

    const request = (user: typeof admin, path: string, init?: RequestInit) => fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${signToken({ userId: user.id, phone: user.phone, role: user.role })}`,
          ...(init?.headers ?? {}),
        },
      },
    );
    const idsIn = async (user: typeof engineer) => {
      const response = await request(user, "/companies");
      assert.equal(response.status, 200);
      return response.json() as Promise<Array<Record<string, unknown> & { id: number }>>;
    };

    const engineerCompanies = await idsIn(engineer);
    assert.deepEqual(
      engineerCompanies.map(company => company.id).sort((a, b) => a - b),
      [memberOwnerCompany.id, memberContractorCompany.id, memberSupervisorCompany.id].sort((a, b) => a - b),
    );
    for (const company of engineerCompanies) {
      assert.deepEqual(Object.keys(company).sort(), ["id", "logoUrl", "name", "type"]);
      assert.equal("email" in company, false);
      assert.equal("address" in company, false);
    }
    assert.deepEqual(
      (await idsIn(viewer)).map(company => company.id).sort((a, b) => a - b),
      engineerCompanies.map(company => company.id).sort((a, b) => a - b),
    );
    assert.deepEqual(
      (await idsIn(contractor)).map(company => company.id),
      [memberContractorCompany.id],
    );
    assert.deepEqual(
      (await idsIn(linkedEngineer)).map(company => company.id),
      [memberContractorCompany.id],
    );
    assert.equal((await request(linkedEngineer, `/companies/${memberOwnerCompany.id}`)).status, 404);

    assert.equal((await request(engineer, `/companies/${foreignCompany.id}`)).status, 404);
    assert.equal((await request(engineer, `/companies/${memberContractorCompany.id}`)).status, 200);
    assert.equal((await request(pm, `/companies/${foreignCompany.id}`)).status, 404);
    assert.equal((await request(pm, `/companies/${ownedCompany.id}`)).status, 200);
    assert.equal((await request(engineer, "/companies/1junk")).status, 400);

    const adminCompany = await request(admin, `/companies/${foreignCompany.id}`);
    assert.equal(adminCompany.status, 200);
    assert.equal("email" in await adminCompany.json(), true);
    const adminCompanyIds = (await idsIn(admin)).map(company => company.id);
    assert.ok(companyIds.every(id => adminCompanyIds.includes(id)));

    const invalidType = await request(pm, "/companies", {
      method: "POST",
      body: JSON.stringify({ name: `${suffix} invalid`, type: "administrator" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(invalidType.status, 400);
    assert.equal((await request(pm, `/companies/${ownedCompany.id}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "owner" }),
      headers: { "content-type": "application/json" },
    })).status, 403);
    assert.equal((await request(pm, `/companies/${ownedCompany.id}`, {
      method: "PATCH",
      body: JSON.stringify({ type: ownedCompany.type }),
      headers: { "content-type": "application/json" },
    })).status, 200);
    assert.equal((await request(engineer, `/companies/${memberContractorCompany.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "not allowed" }),
      headers: { "content-type": "application/json" },
    })).status, 403);

    console.log("Company directory role scoping, project-member visibility, PII minimization and type validation passed");
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
    if (userIds.length > 0) await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, userIds));
    if (projectIds.length > 0) await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, projectIds));
    if (projectIds.length > 0) await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    if (companyIds.length > 0) await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
    if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});