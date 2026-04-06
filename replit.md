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

## Application: نظام الإشراف الهندسي على مشاريع البناء

A full-stack Arabic RTL engineering supervision system for construction projects.

### Artifacts
- **API Server** (`artifacts/api-server`) — Express 5 REST API, port from `$PORT` env (prod: 8080)
- **Web App** (`artifacts/construction-supervision`) — React + Vite, RTL Arabic frontend

### Features
- Full Arabic RTL layout with Noto Kufi Arabic font
- JWT authentication (stored in `localStorage` as `auth_token`)
- Dashboard with project statistics and charts (Recharts)
- Projects management with CRUD operations
- Project detail tabs: Summary, Activities (Gantt), Reports, Files, Deviation Analysis
- Owner portal (`/owner/:token`) — public password-protected read-only view
- User management with roles: admin, engineer, owner
- File uploads via multer (served at `/api/uploads/`)

### Default Credentials (Seed Data)
- **Admin**: username=`admin`, password=`admin123`
- **Engineer**: username=`engineer1`, password=`eng123`
- 3 Arabic sample projects seeded automatically

### Auth Flow
- Login → JWT token stored in `localStorage` as `auth_token`
- `setAuthTokenGetter` configured in `main.tsx` to inject token as Bearer header
- Protected routes redirect to `/login` when unauthenticated
- Owner portal uses a separate token in the URL + password verification

### Companies & Logos
- Companies management page at `/companies` with CRUD + logo upload
- Company types: owner, contractor, supervisor
- Projects can optionally link to companies via `ownerCompanyId`, `contractorCompanyId`, `supervisorCompanyId`
- Company logos appear in report print preview header (logos strip above the main header)
- Text fields (`ownerEntity`, `contractor`, `supervisorEntity`) remain for backward compatibility
- DB table: `companies` (id, name, type, logo_url, phone, email, address)
- DB columns added to `projects`: `owner_company_id`, `contractor_company_id`, `supervisor_company_id`

### API Routes
- `POST /api/auth/login` — login
- `GET /api/auth/me` — current user (requires Bearer token)
- `GET/POST /api/projects` — projects list/create
- `GET/PUT/DELETE /api/projects/:id` — project detail
- `GET /api/projects/:id/summary` — computed summary with deviations
- `GET /api/projects/:id/company-logos` — get linked company logos
- `GET/POST /api/projects/:id/activities` — Gantt activities
- `GET/POST /api/projects/:id/reports` — periodic reports
- `GET/POST /api/projects/:id/files` — file upload/list
- `POST /api/projects/:id/generate-owner-link` — create owner access token
- `POST /api/owner/:token/verify` — verify owner password
- `GET /api/owner/:token/project` — get project for owner
- `GET /api/dashboard/summary` — overall stats
- `GET /api/dashboard/deviations` — deviation analysis
- `GET/POST/PUT/DELETE /api/users` — user management (admin only)
- `GET/POST/PATCH/DELETE /api/companies` — companies management with logo upload
