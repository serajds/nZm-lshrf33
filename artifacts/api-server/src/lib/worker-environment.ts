/** Native image/PDF children do not need database or cloud/API credentials. */
export function isolatedWorkerEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TZ", "LANG", "LC_ALL",
    "LD_LIBRARY_PATH", "NIX_LD", "NIX_LD_LIBRARY_PATH", "NODE_ENV",
  ];
  const env: NodeJS.ProcessEnv = { UV_THREADPOOL_SIZE: "1" };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
