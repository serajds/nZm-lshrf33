import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  linkSync,
  readSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDirectory = join(root, ".local", "dev-db-backups");
const envelopeMagic = Buffer.from("HDBK\x01", "binary");
const saltLength = 16;
const ivLength = 12;
const tagLength = 16;
const headerLength = envelopeMagic.length + saltLength + ivLength + tagLength;
const serviceName = "hardening_dev_target";

function usage() {
  console.error(
    "Usage:\n" +
      "  NODE_ENV=development HARDENING_DEV_DATABASE_URL=... HARDENING_DEV_EXPECTED_DATABASE=host/database node scripts/dev-db-backup.mjs backup [filename.hdbkp]\n" +
      "  NODE_ENV=development HARDENING_DEV_DATABASE_URL=... HARDENING_DEV_EXPECTED_DATABASE=host/database node scripts/dev-db-backup.mjs restore filename.hdbkp --confirm-empty-development-database",
  );
}

function assertDevelopmentTarget() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Refusing backup/restore: NODE_ENV must be exactly development.");
  }
  if (process.env.HARDENING_DEV_DATABASE_URL === undefined) {
    throw new Error("Refusing backup/restore: set an explicit HARDENING_DEV_DATABASE_URL.");
  }
  if (!process.env.HARDENING_DEV_DATABASE_URL) {
    throw new Error("Refusing backup/restore: HARDENING_DEV_DATABASE_URL is empty.");
  }

  const target = new URL(process.env.HARDENING_DEV_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname || !target.pathname.slice(1)) {
    throw new Error("Refusing backup/restore: the development target must be a valid PostgreSQL URL.");
  }
  const databaseHost = target.hostname.replace(/^\[|\]$/g, "");
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  const targetIdentity = `${databaseHost.toLowerCase()}/${databaseName}`;
  if (process.env.HARDENING_DEV_EXPECTED_DATABASE !== targetIdentity) {
    throw new Error("Refusing backup/restore: set HARDENING_DEV_EXPECTED_DATABASE to the verified development host/database identity.");
  }
  if (target.username.includes("\n") || target.password.includes("\n")) {
    throw new Error("Refusing backup/restore: invalid development connection URL.");
  }

  for (const key of ["DATABASE_URL", "PRODUCTION_DATABASE_URL", "EXTERNAL_DATABASE_URL"]) {
    const candidate = process.env[key];
    if (candidate) {
      try {
        const known = new URL(candidate);
        const knownIdentity = `${known.hostname.toLowerCase()}/${decodeURIComponent(known.pathname.slice(1))}`;
        if (knownIdentity === targetIdentity) {
          throw new Error(`Refusing backup/restore: development target matches the host/database identity of ${key}.`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Refusing backup/restore:")) throw error;
      }
    }
  }
  return target;
}

function serviceValue(value) {
  if (/[\r\n]/.test(value)) throw new Error("Invalid character in development database connection setting.");
  return value;
}

function writePrivateFile(filepath, contents) {
  let fd;
  try {
    fd = openSync(filepath, "wx", 0o600);
    writeSync(fd, contents);
    closeSync(fd);
    fd = undefined;
    chmodSync(filepath, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    rmSync(filepath, { force: true });
    throw error;
  }
}

function createServiceFile(target) {
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  chmodSync(backupDirectory, 0o700);
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const serviceFile = join(backupDirectory, `.service-${suffix}`);
  const passwordFile = join(backupDirectory, `.pgpass-${suffix}`);
  const settings = {
    host: target.hostname.replace(/^\[|\]$/g, ""),
    port: target.port || "5432",
    dbname: decodeURIComponent(target.pathname.slice(1)),
    user: decodeURIComponent(target.username),
  };
  const password = decodeURIComponent(target.password);
  for (const value of [...Object.values(settings), password]) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid character in development database connection setting.");
  }
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslcrl", "application_name"]) {
    const value = target.searchParams.get(key);
    if (value) settings[key] = value;
  }
  const contents = `[${serviceName}]\n${Object.entries(settings)
    .map(([key, value]) => `${key}=${serviceValue(value)}`)
    .join("\n")}\n`;
  try {
    writePrivateFile(serviceFile, contents);
    const escapePgpass = (value) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
    const passContents = `${escapePgpass(settings.host)}:${escapePgpass(settings.port)}:${escapePgpass(settings.dbname)}:${escapePgpass(settings.user)}:${escapePgpass(password)}\n`;
    writePrivateFile(passwordFile, passContents);
    return { serviceFile, passwordFile };
  } catch (error) {
    rmSync(serviceFile, { force: true });
    rmSync(passwordFile, { force: true });
    throw error;
  }
}

function validateFilename(filename) {
  if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.hdbkp$/.test(filename)) {
    throw new Error("Use a simple .hdbkp filename (letters, digits, dot, underscore, or hyphen only).");
  }
  const filepath = resolve(backupDirectory, filename);
  if (dirname(filepath) !== backupDirectory) throw new Error("Backup file must be inside .local/dev-db-backups.");
  return filepath;
}

async function promptPassphrase(label, confirm = false) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("A secure interactive terminal is required to enter the backup encryption passphrase.");
  }
  const readHiddenLine = (prompt) =>
    new Promise((resolvePromise, reject) => {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let value = "";
      const onData = (buffer) => {
        for (const byte of buffer) {
          if (byte === 3 || byte === 4) {
            cleanup();
            reject(new Error("Passphrase entry cancelled."));
            return;
          }
          if (byte === 10 || byte === 13) {
            cleanup();
            process.stdout.write("\n");
            resolvePromise(value);
            return;
          }
          if (byte === 127 || byte === 8) {
            value = value.slice(0, -1);
          } else if (byte >= 32 && byte <= 126) {
            value += String.fromCharCode(byte);
          }
        }
      };
      const cleanup = () => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      };
      process.stdin.on("data", onData);
    });
  const passphrase = await readHiddenLine(label);
  if (passphrase.length < 16) throw new Error("Use an encryption passphrase of at least 16 characters.");
  if (confirm && passphrase !== (await readHiddenLine("Confirm encryption passphrase: "))) {
    throw new Error("Passphrases did not match.");
  }
  return passphrase;
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function createEncryptedDump(filepath, env, passphrase) {
  const tempPath = `${filepath}.partial-${process.pid}-${randomBytes(6).toString("hex")}`;
  const salt = randomBytes(saltLength);
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const header = Buffer.concat([envelopeMagic, salt, iv, Buffer.alloc(tagLength)]);
  let tempCreated = false;
  try {
    const output = openSync(tempPath, "wx", 0o600);
    tempCreated = true;
    writeSync(output, header);
    closeSync(output);
    const service = { ...env, PGSERVICEFILE: env.PGSERVICEFILE, PGSERVICE: serviceName };
    const child = spawn("pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-acl", "--compress=6", `--dbname=service=${serviceName}`], {
      env: service,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const closePromise = new Promise((resolvePromise) => child.once("close", resolvePromise));
    await pipeline(child.stdout, cipher, createWriteStream(tempPath, { flags: "a", mode: 0o600 }));
    const code = await closePromise;
    if (code !== 0) throw new Error("pg_dump failed; encrypted backup was discarded.");
    const authTag = cipher.getAuthTag();
    const fd = openSync(tempPath, "r+");
    try {
      const tagOffset = envelopeMagic.length + saltLength + ivLength;
      const tagBuffer = Buffer.alloc(tagLength);
      authTag.copy(tagBuffer);
      writeSync(fd, tagBuffer, 0, tagLength, tagOffset);
    } finally {
      closeSync(fd);
    }
    chmodSync(tempPath, 0o600);
    linkSync(tempPath, filepath);
    rmSync(tempPath);
  } catch (error) {
    if (tempCreated) rmSync(tempPath, { force: true });
    throw error;
  }
}

function createBackupDecipher(filepath, passphrase) {
  const info = lstatSync(filepath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("Backup must be a regular file with owner-only permissions (0600).");
  }
  if (info.size <= headerLength) throw new Error("Encrypted backup is empty or truncated.");
  const fd = openSync(filepath, "r");
  const header = Buffer.alloc(headerLength);
  try {
    if (readSync(fd, header, 0, headerLength, 0) !== headerLength) throw new Error("Encrypted backup is truncated.");
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, envelopeMagic.length).equals(envelopeMagic)) {
    throw new Error("This is not a supported encrypted development backup.");
  }

  const saltStart = envelopeMagic.length;
  const ivStart = saltStart + saltLength;
  const tagStart = ivStart + ivLength;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, header.subarray(saltStart, ivStart)),
    header.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(header.subarray(tagStart, headerLength));
  return { decipher, header };
}

function createEncryptedSnapshot(filepath) {
  const info = lstatSync(filepath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("Backup must be a regular file with owner-only permissions (0600).");
  }
  const snapshot = join(backupDirectory, `.restore-encrypted-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  try {
    copyFileSync(filepath, snapshot, constants.COPYFILE_EXCL);
    chmodSync(snapshot, 0o600);
    return snapshot;
  } catch (error) {
    rmSync(snapshot, { force: true });
    throw error;
  }
}

async function verifyEncryptedBackup(filepath, passphrase) {
  const { decipher, header } = createBackupDecipher(filepath, passphrase);
  const discard = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  try {
    await pipeline(createReadStream(filepath, { start: headerLength }), decipher, discard);
    return header;
  } catch {
    throw new Error("Backup authentication failed; check the passphrase or use an unmodified backup file.");
  }
}

async function restoreFromEncryptedStream(filepath, passphrase, verifiedHeader, env) {
  const { decipher, header } = createBackupDecipher(filepath, passphrase);
  if (!header.equals(verifiedHeader)) {
    throw new Error("Backup changed after authentication; restore was refused.");
  }
  await assertDatabaseEmpty(env);

  const child = spawn("pg_restore", [
    "--exit-on-error",
    "--single-transaction",
    "--no-password",
    "--no-owner",
    "--no-acl",
    "--format=custom",
    `--dbname=service=${serviceName}`,
  ], {
    env,
    stdio: ["pipe", "ignore", "ignore"],
  });
  let streamError;
  let authenticated = false;
  let terminating = false;
  const closePromise = new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Could not start pg_restore; install PostgreSQL client tools.")));
    child.once("close", resolvePromise);
  });
  const input = createReadStream(filepath, { start: headerLength });
  const abort = (error) => {
    if (terminating) return;
    terminating = true;
    streamError = error;
    input.destroy();
    decipher.destroy();
    child.kill();
  };
  input.on("error", abort);
  decipher.on("error", abort);
  child.stdin.on("error", abort);
  child.on("error", abort);
  decipher.once("end", () => {
    authenticated = true;
    child.stdin.end();
  });
  input.pipe(decipher).pipe(child.stdin, { end: false });
  const code = await closePromise;
  if (streamError || !authenticated) {
    throw new Error("Encrypted backup streaming failed; the single-transaction restore was aborted.");
  }
  if (code !== 0) {
    throw new Error("pg_restore failed; the single-transaction restore was rolled back.");
  }
}

async function assertDatabaseEmpty(env) {
  const sql = `
    SELECT CASE WHEN
      NOT EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND nspname NOT LIKE 'pg_toast%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype IN ('c', 'd', 'e', 'r', 'm')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE n.nspname = 'public'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      )
    THEN 'empty' ELSE 'not-empty' END;
  `;
  const child = spawn("psql", ["--no-psqlrc", "--no-password", "--tuples-only", "--no-align", `--dbname=service=${serviceName}`, "--command", sql], {
    env: { ...env, PGSERVICE: serviceName },
    stdio: ["ignore", "pipe", "ignore"],
  });
  let result = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { result += chunk; });
  const code = await new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Could not start psql; install PostgreSQL client tools.")));
    child.once("close", resolvePromise);
  });
  if (code !== 0) throw new Error("Could not validate the development database target; restore was refused.");
  if (result.trim() !== "empty") {
    throw new Error("Restore target is not empty. Create a fresh disposable development database; this tool never overwrites existing data.");
  }
}

async function main() {
  const [operation, filename, confirmation] = process.argv.slice(2);
  if (!["backup", "restore"].includes(operation)) {
    usage();
    process.exitCode = 2;
    return;
  }

  const target = assertDevelopmentTarget();
  const filepath = operation === "backup"
    ? validateFilename(filename || `dev-db-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.hdbkp`)
    : validateFilename(filename);
  const { serviceFile, passwordFile } = createServiceFile(target);
  const env = { ...process.env, PGSERVICEFILE: serviceFile, PGPASSFILE: passwordFile, PGSERVICE: serviceName };
  try {
    if (operation === "backup") {
      if (existsSync(filepath)) throw new Error("Refusing to overwrite an existing backup.");
      const passphrase = await promptPassphrase("Encryption passphrase (hidden): ", true);
      await createEncryptedDump(filepath, env, passphrase);
      console.log(`Encrypted development backup created: ${filename || filepath.split("/").at(-1)}`);
      console.log("The passphrase is not stored. Preserve it separately; it cannot be recovered.");
      return;
    }

    if (confirmation !== "--confirm-empty-development-database") {
      throw new Error("Restore requires --confirm-empty-development-database and a fresh empty development database.");
    }
    if (!existsSync(filepath)) throw new Error("Backup file was not found in .local/dev-db-backups.");
    const passphrase = await promptPassphrase("Backup decryption passphrase (hidden): ");
    const encryptedSnapshot = createEncryptedSnapshot(filepath);
    try {
      const verifiedHeader = await verifyEncryptedBackup(encryptedSnapshot, passphrase);
      await assertDatabaseEmpty(env);
      await restoreFromEncryptedStream(encryptedSnapshot, passphrase, verifiedHeader, env);
      console.log("Development backup restored successfully to the verified empty target.");
    } finally {
      rmSync(encryptedSnapshot, { force: true });
    }
  } finally {
    rmSync(serviceFile, { force: true });
    rmSync(passwordFile, { force: true });
  }
}

main().catch((error) => {
  console.error(`Backup/restore failed safely: ${error.message}`);
  process.exitCode = 1;
});