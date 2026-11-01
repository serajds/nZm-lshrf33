# Excel import HTTP integration test

Run from the workspace root:

```sh
pnpm run test:excel-import:http
```

Requires the existing workspace packages, Node.js 24 and PostgreSQL server tools
(`initdb`, `pg_ctl`). The project already includes these tools. It must run as a
non-root user, in development, never in a deployment.

The test starts a fresh PostgreSQL cluster with a private Unix socket and no TCP
listener. It uses the checked-in Drizzle schema to create empty tables, then
imports the actual Express application and listens on a random loopback port.
The configured application database is **never connected to or copied**.
All projects, companies, users, memberships and XLSX files are synthetic.
Credentials are generated in memory; tokens come from `/api/auth/login`.
Authentication, project access checks and transactions are not replaced or bypassed.

The cluster, socket and generated database files live under the ignored
`generated-artifacts/` directory. The server and database are stopped and this
directory's test-specific subfolder is removed in `finally`, including on failed
assertions. The original database environment value is restored without printing
it. A forcibly killed process may leave an `excel-http-pg-*` folder; stop that
folder's PostgreSQL instance before removing it.

Coverage includes persisted activity/file order and participating group order,
unrelated group slots, existing targets, normalized/ambiguous group names,
explicit new/reused groups, repeated headers, authentication and edit permissions,
assigned-group restrictions (including revocation after preview), stale/expired
previews, preview ownership and project identity, and idempotent consumed previews.
A temporary PostgreSQL trigger forces an error **after** group creation, group
reordering and activity insertion; stored rows and GET results must be unchanged,
and retrying the same preview must succeed. Only the expiration check fakes time.

Without `EXCEL_IMPORT_HTTP_TESTS=1`, the integration test skips, so ordinary unit
test runs do not start PostgreSQL.
