# Overview

This project is a full-stack Arabic RTL engineering supervision system for construction projects, built as a pnpm monorepo using TypeScript. It provides comprehensive management and oversight for construction activities, including project planning, progress tracking, reporting, auditing, and team collaboration. The system aims to streamline project management, improve communication, and ensure timely and efficient project delivery in the construction sector.

# User Preferences

I prefer concise and accurate responses. Focus on the core problem and provide direct solutions or explanations. When suggesting code, ensure it adheres to modern TypeScript practices and the existing architectural patterns. I appreciate an iterative development approach where major changes are discussed before implementation. Do not make changes to files outside the specified scope of a task without explicit approval.

# System Architecture

The system is a pnpm monorepo with separate packages for the API server and the web application.

## UI/UX Decisions

- **Language & Layout**: Full Arabic RTL layout with Noto Kufi Arabic font.
- **PWA**: Installable with offline capabilities and animated splash screen.
- **Responsiveness**: Mobile-responsive design using adaptive layout patterns.
- **Consistency**: Shared `LoadingSpinner` and `EmptyState` components, consistent page headers.
- **Error Handling**: Dedicated Arabic 404 "Not Found" page.
- **Numerals**: All dates/times use `en-GB` locale or `ar-u-nu-latn` for consistent numeral display.

## Technical Implementations

- **Monorepo**: pnpm workspaces.
- **Backend**: Node.js 24, Express 5 REST API.
- **Frontend**: React + Vite, built for RTL Arabic.
- **Database**: PostgreSQL with Drizzle ORM.
- **Type Safety & Validation**: TypeScript 5.9, Zod (`zod/v4`), `drizzle-zod`.
- **API Codegen**: Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build Tool**: esbuild for CJS bundles.
- **Authentication**: JWT stored in `localStorage`. Account activation gate requires admin linkage to a company and project before login.
- **Authorization**: Role-based access control (Admin, Project Manager, Engineer, Contractor, Owner) with project-level permissions and per-user, per-project tab permissions.
- **File Management**: Uploads via `multer`, images compressed with `sharp`, stored in Google Cloud Storage via Replit Object Storage.
- **Offline Capabilities**: Offline-first attendance system using IndexedDB for queuing requests.
- **Notifications**: Web Push notifications for key events using VAPID keys, including geofence reminders.
- **Backup System**: Admin-only database backup creating JSON snapshots.
- **Performance**: Gzip compression for API, React Query caching, parallelized DB reads, client-side caching strategies, and workspace pre-bundling.

## Feature Specifications

- **Projects**: CRUD, auto-calculated `expectedEndDate`, "No Schedule" mode.
- **Activities**: CRUD, Excel import/export, drag-and-drop reordering, automatic `actualStartDate`/`actualEndDate` tracking.
- **Reports**: Periodic reports with activity snapshots, date range filtering.
- **Dashboard**: Project statistics, charts, delay notifications.
- **Owner Portal**: Public, password-protected read-only view with customizable slugs, activity status, and Gantt chart.
- **Form Builder**: Custom form templates with various field types and customizable signatures. Public links for unauthenticated submissions. Daily templates track missing submissions.
- **Audit Log**: Tracks create/update/delete operations on key entities with detailed JSON logs.
- **Companies**: Management of companies with logo uploads, linking to projects, and user affiliation.
- **Suspensions**: Tracks project stoppages, with optional date shifting.
- **Executive Summary PDF**: Print-ready project overview generated from project detail page.
- **Quick-Assign**: Tool for quickly assigning incomplete users to companies and projects.
- **Project page lazy-loading**: Site geofence map is lazy-loaded.

# External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment.
- **TypeScript**: Language.
- **Express**: API framework.
- **PostgreSQL**: Database.
- **Drizzle ORM**: Object Relational Mapper.
- **Zod**: Schema validation.
- **Orval**: OpenAPI spec code generation.
- **esbuild**: JavaScript bundler.
- **Recharts**: Charting library.
- **`vite-plugin-pwa`**: PWA functionality.
- **`localStorage`**: Client-side storage.
- **`xlsx`**: Excel file parsing and generation.
- **`multer`**: `multipart/form-data` handling.
- **`sharp`**: Image processing.
- **Replit Object Storage (Google Cloud Storage)**: Persistent file storage.
- **IndexedDB**: Browser-side storage.
- **Web Push API**: Browser notifications.
- **Microsoft Graph API (via Replit OneDrive connector)**: OneDrive integration.
- **`@dnd-kit`**: Drag-and-drop functionality.