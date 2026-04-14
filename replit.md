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
- Delay calculation uses auto-calculated planned progress from activity dates (`lib/progress.ts`): each activity's planned progress = time elapsed since its `plannedStartDate` / total duration. Project planned progress = average of all activities. Falls back to linear time ratio when no activities exist.
- **Auto-calculated `expectedEndDate`**: `recalcExpectedEndDate(projectId)` in `lib/recalc-end-date.ts` computes `expectedEndDate = max(activity.plannedEndDate) + sum(extension.daysAdded)`. Called after every activity create/update/delete/import, extension create/delete, and suspension create/delete with date shifting. If no activities exist, the manual value is preserved.
- Projects management with CRUD operations
- Project detail tabs: Summary, Activities (Gantt), Reports, Files, Deviation Analysis
- **Activities Snapshot per Report**: When a report is created, a JSON snapshot of all project activities (name, progress, status, dates) is saved in `activitiesSnapshot` column. Report views use the snapshot instead of live activities, so editing activities later doesn't change older reports. Legacy reports without a snapshot fall back to live data.
- Owner portal (`/owner/:token`) — public password-protected read-only view with JWT session persistence (avoids re-entering password on refresh)
- Custom slug support for owner links (e.g., `/owner/project-name` instead of UUID); validated server-side (alphanumeric + hyphens/underscores, 2-60 chars, reserved words blocked)
- Excel import for activities: upload an xlsx file with 3 columns (name, start date, end date) to bulk-create activities. Includes downloadable template. Uses `xlsx` library on both server (parsing) and client (template generation). Strict calendar date validation rejects impossible dates like Feb 31.
- Excel export for activities: downloads all project activities as an xlsx file with name, dates, progress, and status columns (Arabic headers)
- Dashboard delay notifications: shows top 10 delayed activities (past planned end date, not completed) with project name, delay days, and progress; clicking navigates to the project's activities page
- **No Schedule mode** (`noSchedule`): Projects can be created as "بدون جدول زمني معتمد" (without approved timeline). Toggle at project creation/edit. When enabled: dates are optional (nullable in DB), delay/deviation calculations are skipped, dashboard shows "بدون جدول" instead of remaining days, deviation page shows informational message, project summary zeroes schedule metrics (daysElapsed, totalDays, delayDays), extensions route safely skips date chain recomputation. All other features (notes, photos, visits, reports) work normally. DB column: `projects.no_schedule` (boolean, default false). Activity `plannedStartDate`/`plannedEndDate` are nullable in DB and marked as optional in forms for noSchedule projects.
- **Auto date tracking**: When updating activity progress: first progress > 0% auto-sets `actualStartDate` to today (and status to "in_progress"); reaching 100% auto-sets `actualEndDate` to today (and status to "completed"). Existing dates are never overwritten. Works for all projects regardless of schedule mode.
- Reports date range filter: filter reports by `dateFrom`/`dateTo` query params (YYYY-MM-DD validated) in addition to existing type filter
- Audit log system: tracks create/update/delete operations on projects, activities, and reports. DB table `audit_log` stores userId, userName, action, entityType, entityId, entityName, projectId, projectName, details (jsonb). Admin-only API endpoint `GET /audit-log` with filters (entityType, action, projectId, dateFrom, dateTo). Frontend page at `/audit-log` with filter controls. Project name is auto-fetched from DB when not provided directly.
- **English numerals only**: All dates/times use `en-GB` locale or `ar-u-nu-latn` (Arabic text with Latin digits). Never use `ar-SA` or `ar` locale without `u-nu-latn` extension.
- Owner portal charts: pie chart for activity status distribution (completed, in progress, delayed, not started), progress summary cards showing planned vs actual vs deviation
- **Owner portal Gantt chart tab**: Visual timeline (Gantt chart) showing planned vs actual bars for each activity, month headers, today marker line, in-progress activity indicators, and summary stats table with activity dates/durations/progress. Safe division guards prevent NaN/Infinity on edge cases (zero-range dates, invalid dates).
- Executive summary PDF: comprehensive print-ready project overview generated from project detail page ("ملخص تنفيذي" button). Includes project info, KPI metrics, activity status breakdown, activity table with per-item deviation. Uses browser print dialog for PDF export.
- Mobile responsive design: all form dialogs use `grid-cols-1 sm:grid-cols-2` / `sm:col-span-2` pattern; tables use `hidden md:block` (desktop) / `md:hidden` (mobile card view) toggle; dashboard KPI cards scale text/padding on mobile
- **Consistent page content patterns**: Shared `LoadingSpinner` and `EmptyState` components (`components/ui/loading-spinner.tsx`). All pages use animated spinner with contextual text for loading states, and icon+title+description for empty states. Table headers use `bg-muted/40` background. Page headers follow colored icon container pattern (`p-2.5 rounded-xl bg-*/10`).
- **Not Found page**: Arabic 404 page with styled card, icon, and return-to-home button
- Role-based access control with project-level permissions
- User management with roles: admin, project_manager, engineer, owner, contractor
- **Contractor role**: restricted access — sidebar shows only dashboard + projects; within projects, can only see timeline (read-only) and forms tab; cannot access extensions, suspensions, reports, files, or deviation analysis
- Project team management (add/remove members, assign project roles)
- **Form Builder System (النماذج)**: Custom form templates with field types: text, textarea, number, date, select (with options), table (dynamic rows), section (header/divider), checklist_qty (checkbox list with quantity). Admins/PMs create templates; all project members can fill and submit forms; admins/PMs can review submissions and mark as reviewed. Print-ready submission viewer with Arabic layout. **Customizable signatures**: templates can include signature blocks for الاستشاري (supervisor), المقاول (contractor), الجهة المالكة (owner) — choose any combination; stored as `signatures` jsonb array in DB. DB tables: `form_templates`, `form_submissions`. Routes: `GET/POST/PUT/DELETE /api/projects/:id/form-templates`, `GET/POST/PUT/DELETE /api/projects/:id/form-submissions`.
- **Public Form Links**: Admins/PMs can generate a public link for any form template. The link allows anyone (without login) to fill and submit the form. DB column: `form_templates.public_token` (unique text, nullable). Public page at `/form/:token`. API: `POST/DELETE /api/projects/:id/form-templates/:templateId/public-link` (auth), `GET /api/public/form/:token` (no auth), `POST /api/public/form/:token/submit` (no auth). Submissions from public links have `submittedById=null` and `submittedByName` set to user-provided name or "مستخدم خارجي".
- **Daily Template Tracking**: Templates can be flagged as "يومي" (daily) via `isDailyReport` toggle. System tracks missing days (gaps between template creation date and today where no submission exists). Alerts shown on submissions tab with skip button (for holidays). `skipped_days` table stores skipped dates with reason. Stats cards on submissions tab show: total, pending review, reviewed, overdue counts.
- **Activity Groups & Drag-and-Drop**: Activities can be organized into colored groups with collapsible headers. Drag-and-drop reordering via `@dnd-kit` with handle-only drag activation. Groups show aggregate progress. Mobile view includes collapsible group sections. API: `GET/POST/PUT/DELETE /api/projects/:id/activity-groups`, `PUT /api/projects/:id/activity-groups/reorder`, `PUT /api/projects/:id/activities/reorder`. DB: `activity_groups` table with `groupId` FK on activities.
- File uploads via multer (served at `/api/uploads/`). Report/project images auto-compressed via sharp (JPEG quality 80, mozjpeg, same dimensions preserved). Company logos are NOT compressed. Non-image files stored as-is.
- **Persistent Cloud Storage**: All uploaded files (images, documents, logos) are stored in Google Cloud Storage via Replit Object Storage. Local filesystem used as cache; cloud used as durable fallback. On startup, existing local files are migrated to GCS. Files served from local first, then cloud. Key files: `artifacts/api-server/src/lib/fileStorage.ts` (upload/download/delete/migrate), `artifacts/api-server/src/lib/objectStorage.ts` (GCS client).

### Default Credentials (Seed Data)
- **Admin**: phone=`0500000001`, password=`admin123`
- **Engineer**: phone=`0500000002`, password=`engineer123`
- 3 Arabic sample projects seeded automatically

### Auth Flow & Access Control
- Login → JWT token stored in `localStorage` as `auth_token`
- `setAuthTokenGetter` configured in `main.tsx` to inject token as Bearer header
- Protected routes redirect to `/login` when unauthenticated
- Owner portal uses a separate token in the URL + password verification
- **Role hierarchy**: admin (full system) > project_manager (full project control) > engineer (project read/limited access) > contractor (forms + timeline only) > owner (external portal)
- **Project-level access**: non-admin users only see projects they are assigned to via `project_members` table
- **Middleware**: `requireProjectAccess(paramName)` checks DB membership; `requireProjectManager(paramName)` restricts to admin or project manager role
- Admin users bypass all project membership checks
- **User management security**: role validation against allowed enum, duplicate phone checks (pre-check + DB constraint catch), self-deletion protection, self-role-demotion protection, NaN ID guard
- **Search security**: LIKE metacharacters (`%`, `_`, `\`) escaped in project search to prevent pattern injection

### DB Schema: project_members & member_group_assignments
- Links users to projects with a role (`project_manager` or `engineer`)
- Unique constraint on `(project_id, user_id)` prevents duplicate assignments
- Cascading deletes on both project and user FKs
- **Group-based permissions**: `member_group_assignments` table links engineers to specific activity groups. When assigned, engineers can only edit activities within those groups — other activities appear as read-only. If no groups assigned, the engineer has full access (backward compatible). Admins and project managers always have full access.
- API: `PUT /api/projects/:id/members/:memberId/groups` — update assigned groups; `GET /api/projects/:id/my-permissions` — get current user's edit permissions (returns `canEditAll`, `assignedGroupIds`).
- Backend enforcement: `PATCH` and `DELETE` activity routes check group permissions before allowing edits.
- Frontend: members table shows "المجموعات" column with group badges; group assignment dialog for engineers; activities page conditionally shows/hides edit controls per activity.
- Files: `lib/db/src/schema/project_members.ts`, `lib/db/src/schema/member_group_assignments.ts`

### Companies & Logos
- Companies management page at `/companies` with CRUD + logo upload
- Company types: owner, contractor, supervisor
- Projects can optionally link to companies via `ownerCompanyId`, `contractorCompanyId`, `supervisorCompanyId`
- Company logos appear in report print preview header (logos strip above the main header)
- Text fields (`ownerEntity`, `contractor`, `supervisorEntity`) remain for backward compatibility
- DB table: `companies` (id, name, type, logo_url, phone, email, address)
- DB columns added to `projects`: `owner_company_id`, `contractor_company_id`, `supervisor_company_id`
- **User-Company linking (many-to-many)**: Users can belong to multiple companies via `user_companies` junction table. Shown as company badges in users table; multi-select checkboxes in user create/edit dialog.
- **Eligible users per project**: `GET /api/projects/:id/eligible-users` returns users who belong to at least one of the project's linked companies (owner/contractor/supervisor). If no companies linked to the project, all users are returned.
- **Project member add dialog**: Uses eligible users endpoint instead of all users — only users from project-linked companies appear in the dropdown.
- **Company display**: Users table shows multiple company badges; project members table shows company names column (supports multiple).

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
- `GET /api/dashboard/summary` — overall stats (includes `delayedActivitiesList`)
- `GET /api/dashboard/deviations` — deviation analysis
- `GET /api/audit-log` — admin-only audit trail with filters (entityType, action, projectId, dateFrom, dateTo)
- `GET/POST/PATCH/DELETE /api/projects/:id/members` — project team membership (admin/PM)
- `GET/POST/PUT/DELETE /api/users` — user management (admin only, list accessible to all staff)
- `GET/POST/PATCH/DELETE /api/companies` — companies management with logo upload
- `GET/POST/PUT/DELETE /api/projects/:id/form-templates` — form template CRUD (create/edit admin/PM only), includes `isDailyReport` flag
- `GET/POST/PUT/DELETE /api/projects/:id/form-submissions` — form submission CRUD
- `GET /api/projects/:id/submission-stats` — returns `{ total, pending, reviewed, overdue }` counts
- `GET /api/projects/:id/daily-gaps` — returns missing days for daily templates (non-contractor only)
- `POST /api/projects/:id/skip-day` — skip a day for a daily template (non-contractor only, validates template ownership)
- `GET /api/owner/:token/test-results` — list files from project's linked OneDrive folder (JWT authenticated)
- `POST/DELETE /api/projects/:id/form-templates/:templateId/public-link` — generate/remove public token for form template (admin/PM)
- `GET /api/public/form/:token` — get form template by public token (no auth)
- `POST /api/public/form/:token/submit` — submit form via public link (no auth)
- `POST /api/backup/create` — create full database backup (admin only), saves JSON to server `backups/` directory
- `GET /api/backup/list` — list all backup files (admin only)
- `GET /api/backup/download/:filename` — download a backup file (admin only)
- `DELETE /api/backup/:filename` — delete a backup file (admin only)

### Database Backup System
- Admin-only backup button in dashboard header opens a modal panel
- Creates a complete JSON snapshot of all 16 database tables with stats
- Backups stored on the server in `backups/` directory with timestamped filenames
- Modal shows list of all backups with date, size, download and delete actions
- Path traversal protection on filename validation
- Route: `artifacts/api-server/src/routes/backup.ts`

### OneDrive Integration (Test Results)
- Each project can have a `onedriveTestResultsFolderId` field linking to a OneDrive folder
- Owner portal has a "نتائج الاختبارات" (Test Results) tab that lists files from the linked OneDrive folder
- Files are fetched live from OneDrive via Microsoft Graph API using Replit's OneDrive connector
- Direct download buttons for each file
- OneDrive client: `artifacts/api-server/src/lib/onedrive.ts` (uses Replit connectors for OAuth token management)
- Test results API route: `artifacts/api-server/src/routes/test-results.ts`
- DB column: `projects.onedrive_test_results_folder_id` (text, nullable)
