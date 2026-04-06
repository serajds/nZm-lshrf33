# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Application: إدارة الإشراف والمتابعة

A full-stack Arabic RTL engineering supervision system for construction projects.

### Artifacts
- **API Server** (`artifacts/api-server`) — Express 5 REST API, port from `$PORT` env (prod: 8080)
- **Web App** (`artifacts/construction-supervision`) — React + Vite, RTL Arabic frontend

### Features
- Full Arabic RTL layout with Noto Kufi Arabic font
- JWT authentication (stored in `localStorage` as `auth_token`)
- Dashboard with project statistics and charts (Recharts)
- Delay calculation uses activity-weighted planned progress (`lib/progress.ts`), falls back to linear time ratio when no activities exist
- Projects management with CRUD operations
- Project detail tabs: Summary, Activities (Gantt), Reports, Files, Deviation Analysis
- **Activities Snapshot per Report**: When a report is created, a JSON snapshot of all project activities (name, progress, status, dates) is saved in `activitiesSnapshot` column. Report views use the snapshot instead of live activities, so editing activities later doesn't change older reports. Legacy reports without a snapshot fall back to live data.
- Owner portal (`/owner/:token`) — public password-protected read-only view with JWT session persistence (avoids re-entering password on refresh)
- Custom slug support for owner links (e.g., `/owner/project-name` instead of UUID); validated server-side (alphanumeric + hyphens/underscores, 2-60 chars, reserved words blocked)
- Excel import for activities: upload an xlsx file with 3 columns (name, start date, end date) to bulk-create activities. Includes downloadable template. Uses `xlsx` library on both server (parsing) and client (template generation). Strict calendar date validation rejects impossible dates like Feb 31.
- Excel export for activities: downloads all project activities as an xlsx file with name, dates, progress, and status columns (Arabic headers)
- Dashboard delay notifications: shows top 10 delayed activities (past planned end date, not completed) with project name, delay days, and progress; clicking navigates to the project's activities page
- Reports date range filter: filter reports by `dateFrom`/`dateTo` query params (YYYY-MM-DD validated) in addition to existing type filter
- Role-based access control with project-level permissions
- User management with roles: admin, project_manager, engineer, owner
- Project team management (add/remove members, assign project roles)
- File uploads via multer (served at `/api/uploads/`)

### Default Credentials (Seed Data)
- **Admin**: username=`admin`, password=`admin123`
- **Engineer**: username=`engineer1`, password=`eng123`
- 3 Arabic sample projects seeded automatically

### Auth Flow & Access Control
- Login → JWT token stored in `localStorage` as `auth_token`
- `setAuthTokenGetter` configured in `main.tsx` to inject token as Bearer header
- Protected routes redirect to `/login` when unauthenticated
- Owner portal uses a separate token in the URL + password verification
- **Role hierarchy**: admin (full system) > project_manager (full project control) > engineer (project read/limited access) > owner (external portal)
- **Project-level access**: non-admin users only see projects they are assigned to via `project_members` table
- **Middleware**: `requireProjectAccess(paramName)` checks DB membership; `requireProjectManager(paramName)` restricts to admin or project manager role
- Admin users bypass all project membership checks
- **User management security**: role validation against allowed enum, duplicate username/email checks (pre-check + DB constraint catch), self-deletion protection, self-role-demotion protection, email normalization (trim + lowercase), NaN ID guard
- **Search security**: LIKE metacharacters (`%`, `_`, `\`) escaped in project search to prevent pattern injection

### DB Schema: project_members
- Links users to projects with a role (`project_manager` or `engineer`)
- Unique constraint on `(project_id, user_id)` prevents duplicate assignments
- Cascading deletes on both project and user FKs
- File: `lib/db/src/schema/project_members.ts`

### Companies & Logos
- Companies management page at `/companies` with CRUD + logo upload
- Company types: owner, contractor, supervisor
- Projects can optionally link to companies via `ownerCompanyId`, `contractorCompanyId`, `supervisorCompanyId`
- Company logos appear in report print preview header (logos strip above the main header)
- Text fields (`ownerEntity`, `contractor`, `supervisorEntity`) remain for backward compatibility
- DB table: `companies` (id, name, type, logo_url, phone, email, address)
- DB columns added to `projects`: `owner_company_id`, `contractor_company_id`, `supervisor_company_id`

### Suspensions & Date Shifting
- Suspensions tab on each project tracks stoppages (official holidays, force majeure, contractor delays)
- `shiftDates` flag on create: optionally shifts activity planned dates and project `expectedEndDate` forward by suspension duration
- Checkbox UI appears only for non-contractor-delay types (official_holiday, force_majeure)
- `datesShifted` boolean column in DB tracks whether shifting was applied; used during delete to decide whether to reverse
- Delete reversal: if `datesShifted=true`, shifts dates back by the same number of days
- Table shows "الترحيل" (shift) column with yes/no indicator per suspension
- Route: `GET/POST/DELETE /api/projects/:id/suspensions`

### API Routes
- `POST /api/auth/login` — login
- `GET /api/auth/me` — current user (requires Bearer token)
- `GET/POST /api/projects` — projects list/create
- `GET/PUT/DELETE /api/projects/:id` — project detail
- `GET /api/projects/:id/summary` — computed summary with activity-weighted planned progress
- `GET /api/projects/:id/company-logos` — get linked company logos
- `GET/POST /api/projects/:id/activities` — Gantt activities
- `GET/POST /api/projects/:id/reports` — periodic reports
- `GET/POST /api/projects/:id/files` — file upload/list
- `POST /api/projects/:id/generate-owner-link` — create owner access token
- `POST /api/owner/verify` — verify owner password (returns ownerJwt for session persistence)
- `GET /api/owner/:token/data` — get owner project data (JWT authenticated, no password needed)
- `GET /api/owner/:token/project` — get project for owner (legacy)
- `GET /api/dashboard/summary` — overall stats
- `GET /api/dashboard/deviations` — deviation analysis
- `GET/POST/PATCH/DELETE /api/projects/:id/members` — project team membership (admin/PM)
- `GET/POST/PUT/DELETE /api/users` — user management (admin only, list accessible to all staff)
- `GET/POST/PATCH/DELETE /api/companies` — companies management with logo upload
