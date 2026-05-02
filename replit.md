# Overview

This project is a full-stack Arabic RTL engineering supervision system for construction projects, built as a pnpm monorepo using TypeScript. Its primary purpose is to provide comprehensive management and oversight for construction activities, offering features from project planning and progress tracking to reporting, auditing, and team collaboration. The system aims to streamline project management, improve communication, and ensure timely and efficient project delivery in the construction sector.

# User Preferences

I prefer concise and accurate responses. Focus on the core problem and provide direct solutions or explanations. When suggesting code, ensure it adheres to modern TypeScript practices and the existing architectural patterns. I appreciate an iterative development approach where major changes are discussed before implementation. Do not make changes to files outside the specified scope of a task without explicit approval.

# System Architecture

The system is a pnpm monorepo with separate packages for the API server and the web application.

## UI/UX Decisions

- **Language & Layout**: Full Arabic RTL layout with Noto Kufi Arabic font.
- **PWA**: Installable PWA with offline capabilities, manifest, and animated splash screen.
- **Responsiveness**: Mobile-responsive design using `grid-cols` and `hidden md:block` patterns for adaptive layouts.
- **Consistency**: Shared `LoadingSpinner` and `EmptyState` components. Consistent page headers with colored icon containers.
- **Error Handling**: Dedicated Arabic 404 "Not Found" page.
- **Numerals**: All dates/times use `en-GB` locale or `ar-u-nu-latn` (Arabic text with Latin digits) for consistent numeral display.

## Technical Implementations

- **Monorepo**: pnpm workspaces for managing multiple packages.
- **Backend**: Node.js 24, Express 5 REST API.
- **Frontend**: React + Vite, built for RTL Arabic.
- **Database**: PostgreSQL with Drizzle ORM.
- **Type Safety & Validation**: TypeScript 5.9, Zod (`zod/v4`), `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build Tool**: esbuild for CJS bundles.
- **Authentication**: JWT stored in `localStorage` for session management. Owner portal uses a separate token + password verification.
- **Authorization**: Role-based access control (Admin, Project Manager, Engineer, Contractor, Owner) with project-level permissions enforced via `project_members` table and middleware. Admin users bypass membership checks. Group-based permissions allow engineers restricted access to specific activity groups. Per-user, per-project tab permissions (`project_members.tab_permissions` jsonb) let PMs/admins set each of the 9 project tabs (overview, activities, extensions, suspensions, reports, forms, attendance, files, deviation) to `hidden` / `view` / `edit` for individual members; falls back to role defaults when not overridden. Backend enforces via `requireTabEdit(tabKey)` middleware on write routes; frontend hides tabs and disables edit affordances accordingly.
- **File Management**: Uploads via `multer`, images compressed with `sharp`. Files are stored persistently in Google Cloud Storage via Replit Object Storage, with local filesystem caching.
- **Offline Capabilities**: Offline-first attendance system using IndexedDB for queuing requests and auto-flushing when online. Implements idempotency on the backend for queued submissions.
- **Notifications**: Web Push notifications for key events (attendance, project extensions/suspensions) using VAPID keys. Includes foreground geofence arrival reminders with `watchPosition` and audio/visual alerts.
- **Backup System**: Admin-only database backup system creating JSON snapshots of all tables, stored locally on the server with download/delete functionality.
- **Performance**: Express API uses gzip `compression` middleware (threshold 1KB) — list payloads (activities/members/files/reports) shrink 5-10x. The `/my-permissions` query (used by every project tab via `useTabAccess` and `ProjectNav`) is cached in React Query for 10 minutes (`staleTime`) with `refetchOnMount: false`, eliminating spinner flashes on tab switches. Global default `staleTime` is 2 min; `refetchOnWindowFocus` is disabled. **Backend**: `/dashboard/summary` and `/projects/:id/summary` parallelize their independent DB reads via `Promise.all` (was 5-7 serial round-trips → now one). **Client**: project overview page uses `staleTime: 5 min` for rarely-changing reads (extensions, summary-widgets, form-templates) and shares the `form-templates` cache key with the forms tab to avoid duplicate fetches when switching tabs. Attendance polling reduced from 30s → 60s and pauses entirely when the tab is in the background (`refetchIntervalInBackground: false`). **Anti-waterfall**: the project page (`/projects/:id`) primes the cache for ALL queries its children need (`my-permissions`, `members`, `eligible-users`, `activity-groups`, `attendance/my-status`) at the very top of the component — without this, queries fired one-by-one as each lazy-mounted child woke up, producing a measured 4-second waterfall in dev mode. With the priming, every request fires in the same micro-task and React Query dedupes when the children mount. **Workspace pre-bundling**: `@workspace/api-client-react` is a 180 KB orval-generated package imported by 19 different files. By default Vite skips pre-bundling for workspace packages, so every cold page load forced the browser to re-parse 5,441 lines of TypeScript on the fly. Adding `@workspace/api-client-react` to `optimizeDeps.include` in `vite.config.ts` makes esbuild pre-bundle it once at startup.

**Eager-load the entry pages, not just the login** (the bug that was actually making the app feel "broken"): `AppLayout`, `Dashboard`, `Projects`, and `ProjectDetails` were all `lazy()` imports. `AppLayout` in particular was rendered in `ProtectedRoute` and `HomeRoute` *without a surrounding `<Suspense>` boundary* — the inner `<Suspense>` was around the page Component, not around AppLayout itself. In React 18 a lazy component that suspends with no Suspense above it throws to the nearest error boundary; ours (`RouteErrorBoundary`) caught the empty rejection (visible in browser console as `[RouteErrorBoundary] {}`) and triggered "React will try to recreate this component tree from scratch". This rebuild happened on every cold authenticated load — the user perceived it as "the page locks up and reloads". Eager-loading these four (which are needed on virtually every authenticated paint) removes the suspension entirely. Heavy/rarely-visited pages (`activities`, `reports`, `files`, `deviation`, `extensions`, `suspensions`, `forms`, `attendance`, `users`, `companies`, `audit-log`, `owner`, `public-form`) — most of which pull in `xlsx`, `recharts`, `leaflet`, or `react-pdf` — stay lazy, so the initial bundle is still well under the original "everything in one file" size.

## Feature Specifications

- **Projects**: CRUD operations, auto-calculated `expectedEndDate` based on activity dates and extensions/suspensions. "No Schedule" mode for projects without approved timelines, allowing optional dates and skipping date-related calculations.
- **Activities**: CRUD, Excel import/export, drag-and-drop reordering with activity groups. Automatic `actualStartDate` and `actualEndDate` tracking based on progress updates.
- **Reports**: Periodic reports with activity snapshots (JSON) to preserve historical data. Date range filtering for reports.
- **Dashboard**: Project statistics, charts (Recharts), and delay notifications for top 10 delayed activities.
- **Owner Portal**: Public, password-protected read-only view for project owners, including customizable slugs, activity status pie charts, progress summary cards, and a Gantt chart with planned vs. actual timelines.
- **Form Builder**: Custom form templates with various field types (text, number, select, table, checklist_qty). Supports customizable signatures (supervisor, contractor, owner). Public links for forms allow unauthenticated submissions. Daily templates track missing submissions and allow skipping days.
- **Audit Log**: Tracks create/update/delete operations on key entities (projects, activities, reports) with detailed JSON logs, accessible via an admin-only API and frontend page with filtering.
- **Companies**: Management of companies (owner, contractor, supervisor) with logo uploads. Projects can link to companies. Users can belong to multiple companies, enabling project member filtering based on linked company affiliations.
- **Suspensions**: Tracks project stoppages, with optional date shifting for planned activity dates and project `expectedEndDate`.
- **Executive Summary PDF**: Print-ready project overview generated from the project detail page.

# External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment (version 24).
- **TypeScript**: Language (version 5.9).
- **Express**: API framework (version 5).
- **PostgreSQL**: Database.
- **Drizzle ORM**: Object Relational Mapper.
- **Zod**: Schema validation.
- **Orval**: OpenAPI spec code generation.
- **esbuild**: JavaScript bundler.
- **Recharts**: Charting library.
- **`vite-plugin-pwa`**: PWA functionality.
- **`localStorage`**: Client-side storage for JWT.
- **`xlsx`**: Excel file parsing and generation.
- **`multer`**: Node.js middleware for handling `multipart/form-data`.
- **`sharp`**: Image processing (compression).
- **Replit Object Storage (Google Cloud Storage)**: Persistent file storage.
- **IndexedDB**: Browser-side storage for offline attendance.
- **Web Push API**: Browser notifications.
- **Microsoft Graph API (via Replit OneDrive connector)**: OneDrive integration for test results.
- **`@dnd-kit`**: Drag-and-drop functionality.