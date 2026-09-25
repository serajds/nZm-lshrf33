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
  readdirSync,
  readSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { dirname, join, resolve, basename, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDirectory = join(root, ".local", "dev-db-backups");
const envelopeMagic = Buffer.from("HDBK\x02", "binary");
const bundleMagic = Buffer.from("HDBND\x01", "binary");
const databaseSpoolMagic = Buffer.from("HDBDS\x01", "binary");
const saltLength = 16;
const ivLength = 12;
const tagLength = 16;
const headerLength = envelopeMagic.length + saltLength + ivLength + tagLength;
const serviceName = "hardening_dev_target";

function usage() {
  console.error(
    "Usage:\n" +
      "  NODE_ENV=development HARDENING_DEV_DATABASE_URL=... HARDENING_DEV_EXPECTED_DATABASE=host/database HARDENING_DEV_UPLOADS_DIR=... HARDENING_DEV_OBJECT_ADAPTER=gcloud|local-dir node scripts/dev-db-backup.mjs backup [filename.hdbkp]\n" +
      "  NODE_ENV=development HARDENING_DEV_DATABASE_URL=... HARDENING_DEV_EXPECTED_DATABASE=host/database HARDENING_DEV_UPLOADS_DIR=... HARDENING_DEV_OBJECT_ADAPTER=gcloud|local-dir node scripts/dev-db-backup.mjs restore filename.hdbkp --confirm-empty-development-database\n" +
      "  local-dir additionally requires HARDENING_DEV_OBJECT_ROOT; gcloud requires gcloud CLI and credentials",
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

function getObjectScopes() {
  const scopes = [];
  const add = (raw, suffix = "") => {
    if (!raw) return;
    const clean = raw.replace(/^\/+|\/+$/g, "");
    const slash = clean.indexOf("/");
    const bucket = slash < 0 ? clean : clean.slice(0, slash);
    const prefix = `${slash < 0 ? "" : clean.slice(slash + 1)}${suffix}`;
    if (!/^[A-Za-z0-9._-]{3,222}$/.test(bucket) || bucket.includes("..")) {
      throw new Error("Invalid bucket name in development Object Storage scope.");
    }
    const parts = prefix.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === ".." || /[\\,*?[\]\r\n]/.test(part))) {
      throw new Error("Invalid prefix in development Object Storage scope.");
    }
    scopes.push({ bucket, prefix: parts.length ? `${parts.join("/")}/` : "" });
  };
  if (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    add(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "uploads/");
  }
  if (process.env.PRIVATE_OBJECT_DIR) add(process.env.PRIVATE_OBJECT_DIR);
  for (const path of (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "").split(",")) {
    add(path.trim());
  }
  const ordered = [...new Map(scopes.map((scope) => [`${scope.bucket}/${scope.prefix}`, scope])).values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket) || a.prefix.length - b.prefix.length || a.prefix.localeCompare(b.prefix));
  const unique = [];
  for (const scope of ordered) {
    if (unique.some((parent) => parent.bucket === scope.bucket && scope.prefix.startsWith(parent.prefix))) continue;
    unique.push(scope);
  }
  return unique;
}

function getStorageAdapter() {
  const type = process.env.HARDENING_DEV_OBJECT_ADAPTER;
  if (type === "local-dir") {
    const rootPath = process.env.HARDENING_DEV_OBJECT_ROOT;
    if (!rootPath || !resolve(rootPath)) throw new Error("local-dir adapter requires HARDENING_DEV_OBJECT_ROOT.");
    const root = resolve(rootPath);
    if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
      throw new Error("local-dir adapter root must be an existing, real directory.");
    }
    return { type, root };
  }
  if (type === "gcloud") return { type };
  throw new Error("Set HARDENING_DEV_OBJECT_ADAPTER explicitly to gcloud or local-dir.");
}

function assertDevelopmentObjectScopes(scopes) {
  const actual = scopes.length ? scopes.map(({ bucket, prefix }) => `${bucket}/${prefix}`).sort().join(",") : "none";
  if (process.env.HARDENING_DEV_EXPECTED_OBJECT_SCOPES !== actual) {
    throw new Error("Set HARDENING_DEV_EXPECTED_OBJECT_SCOPES to the separately verified exact development storage scope list.");
  }
  const knownProduction = [];
  const addProductionScope = (raw, suffix = "") => {
    if (!raw) return;
    const value = raw.replace(/^\/+|\/+$/g, "");
    const slash = value.indexOf("/");
    const bucket = slash < 0 ? value : value.slice(0, slash);
    const prefix = `${slash < 0 ? "" : value.slice(slash + 1)}${suffix}`.replace(/^\/+|\/+$/g, "");
    knownProduction.push({ bucket, prefix: prefix ? `${prefix}/` : "" });
  };
  addProductionScope(process.env.PRODUCTION_DEFAULT_OBJECT_STORAGE_BUCKET_ID, "uploads/");
  addProductionScope(process.env.PRODUCTION_PRIVATE_OBJECT_DIR);
  for (const path of (process.env.PRODUCTION_PUBLIC_OBJECT_SEARCH_PATHS || "").split(",")) {
    addProductionScope(path.trim());
  }
  if (knownProduction.some((production) => scopes.some((scope) =>
    production.bucket === scope.bucket &&
    (scope.prefix.startsWith(production.prefix) || production.prefix.startsWith(scope.prefix))))) {
    throw new Error("Refusing backup/restore: development Object Storage scope matches a known production storage scope.");
  }
}

function localObjectPath(adapter, key) {
  const path = resolve(adapter.root, ...key.split("/"));
  if (path !== adapter.root && !path.startsWith(`${adapter.root}${sep}`)) {
    throw new Error("Object key escapes the configured local adapter root.");
  }
  return path;
}

function ensureLocalObjectParent(adapter, key) {
  const parts = parseObjectKey(key).split("/");
  let directory = adapter.root;
  for (const part of parts.slice(0, -1)) {
    directory = join(directory, part);
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Local Object Storage target contains a non-directory or symbolic link.");
    }
  }
  return join(directory, parts.at(-1));
}

function parseObjectKey(key) {
  if (typeof key !== "string" || key.startsWith("/") || key.includes("\\") ||
      key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid Object Storage key in backup.");
  }
  return key;
}

function runCapture(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", () => reject(new Error(`Could not start ${command}; install the required client tool.`)));
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`${command} failed${stderr ? `: ${stderr.trim().slice(0, 300)}` : "."}`));
      else resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function gcloudUri(key) {
  const [bucket, ...parts] = parseObjectKey(key).split("/");
  return `gs://${bucket}/${parts.join("/")}`;
}

async function describeGcloudObject(key) {
  let output;
  try {
    output = await runCapture("gcloud", ["storage", "objects", "describe", gcloudUri(key), "--format=json"]);
  } catch (error) {
    if (/matched no objects/i.test(error.message)) return null;
    throw error;
  }
  let object;
  try {
    object = JSON.parse(output);
  } catch {
    throw new Error("gcloud returned invalid metadata while checking a restored object.");
  }
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata : {};
  return {
    generation: String(object.generation || ""),
    restoreMarker: metadata["custom:devBackupRestoreId"] || metadata.devBackupRestoreId,
  };
}

async function listObjectScope(adapter, scope) {
  if (adapter.type === "local-dir") {
    const prefixPath = localObjectPath(adapter, `${scope.bucket}/${scope.prefix}`.replace(/\/$/, ""));
    if (!existsSync(prefixPath)) return [];
    const results = [];
    const walk = (directory) => {
      if (lstatSync(directory).isSymbolicLink()) throw new Error("Object adapter contains a symbolic link; refusing to back it up.");
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const info = lstatSync(path);
        if (info.isSymbolicLink()) throw new Error("Object adapter contains a symbolic link; refusing to back it up.");
        if (info.isDirectory()) walk(path);
        else if (info.isFile()) results.push({ key: relative(adapter.root, path).split(sep).join("/"), size: info.size });
        else throw new Error("Object adapter contains an unsupported filesystem entry.");
      }
    };
    walk(prefixPath);
    return results;
  }
  const uri = `gs://${scope.bucket}/${scope.prefix}**`;
  let output;
  try {
    output = await runCapture("gcloud", ["storage", "ls", "--recursive", "--format=json", uri]);
  } catch (error) {
    if (error.message.includes("matched no objects")) return [];
    throw error;
  }
  if (!output.trim()) return [];
  let values;
  try {
    values = JSON.parse(output);
  } catch {
    throw new Error("gcloud returned an unrecognized Object Storage listing.");
  }
  if (!Array.isArray(values)) values = [values];
  return values.map((item) => {
    let name = item.url || item.name;
    if (typeof name === "string" && !name.startsWith("gs://")) {
      const bucket = typeof item.bucket === "string" ? item.bucket.replace(/^gs:\/\//, "") : scope.bucket;
      name = `gs://${bucket}/${name.replace(/^\/+/, "")}`;
    }
    const match = typeof name === "string" && name.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match || !Number.isSafeInteger(Number(item.size))) {
      throw new Error("gcloud returned incomplete Object Storage listing metadata.");
    }
    const aclPolicy = item.metadata?.["custom:aclPolicy"];
    if (aclPolicy !== undefined && typeof aclPolicy !== "string") {
      throw new Error("gcloud returned invalid object ACL metadata.");
    }
    return {
      key: parseObjectKey(`${match[1]}/${match[2]}`),
      size: Number(item.size),
      contentType: typeof item.contentType === "string" ? item.contentType : undefined,
      aclPolicy,
    };
  });
}

async function listAllObjects(adapter, scopes) {
  const all = [];
  for (const scope of scopes) all.push(...await listObjectScope(adapter, scope));
  const unique = new Map();
  for (const entry of all) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("Invalid object size in storage listing.");
    if (unique.has(entry.key)) throw new Error("Overlapping Object Storage scopes produced duplicate objects.");
    unique.set(entry.key, entry);
  }
  return [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function objectReadStream(adapter, key) {
  if (adapter.type === "local-dir") return createReadStream(localObjectPath(adapter, key));
  const child = spawn("gcloud", ["storage", "cat", gcloudUri(key)], { stdio: ["ignore", "pipe", "ignore"] });
  child.once("error", () => child.stdout.destroy(new Error("Could not start gcloud; install and configure the Google Cloud CLI.")));
  child.once("close", (code) => {
    if (code !== 0) child.stdout.destroy(new Error("gcloud could not read an Object Storage object."));
  });
  return child.stdout;
}

async function assertObjectTargetsEmpty(adapter, scopes) {
  const objects = await listAllObjects(adapter, scopes);
  if (objects.length) throw new Error("Object Storage restore target is not empty. Use fresh, isolated development storage; existing objects are never overwritten.");
}

function assertLocalUploadTargetEmpty(directory) {
  if (!directory) throw new Error("Set HARDENING_DEV_UPLOADS_DIR to the verified app uploads directory.");
  if (!existsSync(directory)) return;
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Uploads target must be a real directory.");
  if (readdirSync(directory).length) {
    throw new Error("Uploads restore target is not empty. Use a fresh, isolated development uploads directory.");
  }
}

function localUploadFiles(directory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error("HARDENING_DEV_UPLOADS_DIR must point to the app's existing uploads directory for backup.");
  }
  return readdirSync(directory).map((name) => {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || basename(name) !== name || name === "." || name === "..") {
      throw new Error("The app uploads directory contains an unsupported entry; backup was refused.");
    }
    return { path, name, size: info.size };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function* recordBytes(metadata, source) {
  const json = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length);
  yield header;
  yield json;
  let total = 0;
  for await (const input of source) {
    const chunk = Buffer.from(input);
    for (let offset = 0; offset < chunk.length; offset += 1024 * 1024) {
      const piece = chunk.subarray(offset, Math.min(offset + 1024 * 1024, chunk.length));
      const size = Buffer.alloc(4);
      size.writeUInt32BE(piece.length);
      yield size;
      yield piece;
      total += piece.length;
    }
  }
  const end = Buffer.alloc(4);
  yield end;
  if (metadata.size !== undefined && total !== metadata.size) {
    throw new Error(`Backup source size changed while reading ${metadata.name || metadata.key}.`);
  }
}

async function* bundleBytes(env, localFiles, objectFiles, adapter) {
  yield bundleMagic;
  const dump = spawn("pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-acl", "--compress=6", `--dbname=service=${serviceName}`], {
    env: { ...env, PGSERVICEFILE: env.PGSERVICEFILE, PGSERVICE: serviceName },
    stdio: ["ignore", "pipe", "ignore"],
  });
  let dumpCode;
  let dumpError;
  dump.once("close", (code) => { dumpCode = code; });
  dump.once("error", (error) => { dumpError = error; });
  try {
    yield* recordBytes({ kind: "database" }, dump.stdout);
    while (dumpCode === undefined) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    if (dumpError) throw new Error("Could not start pg_dump; install PostgreSQL client tools.");
    if (dumpCode !== 0) throw new Error("pg_dump failed; encrypted backup was discarded.");
  } catch (error) {
    dump.kill();
    throw error;
  }
  for (const file of localFiles) {
    yield* recordBytes({ kind: "upload", name: file.name, size: file.size }, createReadStream(file.path));
  }
  for (const object of objectFiles) {
    yield* recordBytes({
      kind: "object",
      key: object.key,
      size: object.size,
      contentType: object.contentType,
      aclPolicy: object.aclPolicy,
    }, objectReadStream(adapter, object.key));
  }
  yield Buffer.alloc(4);
}

async function createEncryptedBackup(filepath, env, passphrase, localFiles, objectFiles, adapter) {
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
    await pipeline(
      Readable.from(bundleBytes(env, localFiles, objectFiles, adapter)),
      cipher,
      createWriteStream(tempPath, { flags: "a", mode: 0o600 }),
    );
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

function createEncryptedDatabaseSpool() {
  const filepath = join(backupDirectory, `.restore-db-encrypted-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  const key = randomBytes(32);
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.concat([databaseSpoolMagic, iv, Buffer.alloc(tagLength)]);
  const fd = openSync(filepath, "wx", 0o600);
  try {
    writeSync(fd, header);
  } finally {
    closeSync(fd);
  }
  const output = createWriteStream(filepath, { flags: "a", mode: 0o600 });
  let finished = false;
  return {
    filepath,
    async write(chunk) {
      const encrypted = cipher.update(chunk);
      if (encrypted.length) await writeToStream(output, encrypted);
    },
    async finish() {
      const final = cipher.final();
      if (final.length) await writeToStream(output, final);
      await endWritable(output);
      const authTag = cipher.getAuthTag();
      const tagFd = openSync(filepath, "r+");
      try {
        writeSync(tagFd, authTag, 0, tagLength, databaseSpoolMagic.length + ivLength);
      } finally {
        closeSync(tagFd);
      }
      finished = true;
      chmodSync(filepath, 0o600);
      return { filepath, key, iv };
    },
    abort() {
      if (!finished) output.destroy();
      rmSync(filepath, { force: true });
    },
  };
}

async function verifyEncryptedDatabaseSpool(spool) {
  const info = lstatSync(spool.filepath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size <= databaseSpoolMagic.length + ivLength + tagLength) {
    throw new Error("Temporary encrypted database stream is invalid.");
  }
  const fd = openSync(spool.filepath, "r");
  const header = Buffer.alloc(databaseSpoolMagic.length + ivLength + tagLength);
  try {
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        !header.subarray(0, databaseSpoolMagic.length).equals(databaseSpoolMagic) ||
        !header.subarray(databaseSpoolMagic.length, databaseSpoolMagic.length + ivLength).equals(spool.iv)) {
      throw new Error("Temporary encrypted database stream is invalid.");
    }
  } finally {
    closeSync(fd);
  }
  const decipher = createDecipheriv("aes-256-gcm", spool.key, spool.iv);
  decipher.setAuthTag(header.subarray(databaseSpoolMagic.length + ivLength));
  try {
    await pipeline(
      createReadStream(spool.filepath, { start: header.length }),
      decipher,
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    );
  } catch {
    throw new Error("Temporary encrypted database stream failed authentication.");
  }
}

async function restoreEncryptedDatabaseSpool(spool, env) {
  await verifyEncryptedDatabaseSpool(spool);
  const decipher = createDecipheriv("aes-256-gcm", spool.key, spool.iv);
  const fd = openSync(spool.filepath, "r");
  const header = Buffer.alloc(databaseSpoolMagic.length + ivLength + tagLength);
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  decipher.setAuthTag(header.subarray(databaseSpoolMagic.length + ivLength));
  const child = spawn("pg_restore", [
    "--exit-on-error", "--single-transaction", "--no-password", "--no-owner", "--no-acl",
    "--format=custom", `--dbname=service=${serviceName}`,
  ], { env, stdio: ["pipe", "ignore", "ignore"] });
  const close = new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Could not start pg_restore; install PostgreSQL client tools.")));
    child.once("close", resolvePromise);
  });
  try {
    await pipeline(createReadStream(spool.filepath, { start: header.length }), decipher, child.stdin);
    if (await close !== 0) throw new Error("pg_restore failed; the single-transaction restore was rolled back.");
  } catch (error) {
    child.kill();
    await close.catch(() => {});
    if (error.message.includes("pg_restore failed") || error.message.includes("Could not start pg_restore")) throw error;
    throw new Error("Encrypted database stream failed; the single-transaction restore was aborted.");
  }
}

async function restoreFromEncryptedStream(filepath, passphrase, verifiedHeader, env) {
  const { decipher, header } = createBackupDecipher(filepath, passphrase);
  if (!header.equals(verifiedHeader)) {
    throw new Error("Backup changed after authentication; restore was refused.");
  }
  await assertDatabaseEmpty(env);
  const localDir = resolve(process.env.HARDENING_DEV_UPLOADS_DIR || "");
  const adapter = getStorageAdapter();
  const createdUploads = [];
  const createdObjects = [];
  const remoteAttempts = [];
  const restoreMarker = randomBytes(16).toString("hex");
  let databaseSpoolBuilder;
  let databaseSpool;
  const read = new BundleReader(createReadStream(filepath, { start: headerLength }).pipe(decipher));
  try {
    if (!(await read.readExact(bundleMagic.length)).equals(bundleMagic)) {
      throw new Error("Unsupported encrypted backup bundle format.");
    }
    assertLocalUploadTargetEmpty(localDir);
    const scopes = getObjectScopes();
    await assertObjectTargetsEmpty(adapter, scopes);
    let databaseSeen = false;
    const uploadNames = new Set();
    const objectKeys = new Set();
    while (true) {
      const metadataLength = (await read.readExact(4)).readUInt32BE(0);
      if (metadataLength === 0) break;
      if (metadataLength > 64 * 1024) throw new Error("Backup bundle record metadata is too large.");
      let metadata;
      try {
        metadata = JSON.parse((await read.readExact(metadataLength)).toString("utf8"));
      } catch {
        throw new Error("Backup bundle contains invalid record metadata.");
      }
      let writer;
      let counted = 0;
      if (metadata.kind === "database" && !databaseSeen) {
        databaseSeen = true;
        databaseSpoolBuilder = createEncryptedDatabaseSpool();
        writer = {
          write: (chunk) => databaseSpoolBuilder.write(chunk),
          end: async () => { databaseSpool = await databaseSpoolBuilder.finish(); },
        };
      } else if (metadata.kind === "upload" && databaseSeen && typeof metadata.name === "string" &&
          basename(metadata.name) === metadata.name && ![".", ".."].includes(metadata.name) &&
          Number.isSafeInteger(metadata.size) && metadata.size >= 0 && !uploadNames.has(metadata.name)) {
        uploadNames.add(metadata.name);
        mkdirSync(localDir, { recursive: true, mode: 0o700 });
        const destination = join(localDir, metadata.name);
        const fd = openSync(destination, "wx", 0o600);
        createdUploads.push(destination);
        const output = createWriteStream(destination, { fd, autoClose: true });
        writer = {
          write: (chunk) => writeToStream(output, chunk),
          end: () => endWritable(output),
        };
      } else if (metadata.kind === "object" && databaseSeen && typeof metadata.key === "string" &&
          Number.isSafeInteger(metadata.size) && metadata.size >= 0 &&
          (metadata.contentType === undefined || (typeof metadata.contentType === "string" && metadata.contentType.length <= 1024)) &&
          (metadata.aclPolicy === undefined || typeof metadata.aclPolicy === "string") &&
          !objectKeys.has(metadata.key)) {
        const key = parseObjectKey(metadata.key);
        objectKeys.add(key);
        const scope = scopes.find((entry) => key.startsWith(`${entry.bucket}/${entry.prefix}`));
        if (!scope) throw new Error("Backup contains an Object Storage key outside the configured development scopes.");
        if (adapter.type === "local-dir") {
          const destination = ensureLocalObjectParent(adapter, key);
          const fd = openSync(destination, "wx", 0o600);
          createdObjects.push(key);
          const output = createWriteStream(destination, { fd, autoClose: true });
          writer = {
            write: (chunk) => writeToStream(output, chunk),
            end: () => endWritable(output),
          };
        } else {
          const args = ["storage", "cp", "--if-generation-match=0"];
          if (metadata.contentType) args.push(`--content-type=${metadata.contentType}`);
          const customMetadata = [`custom:devBackupRestoreId=${restoreMarker}`];
          if (metadata.aclPolicy) {
            try {
              JSON.parse(metadata.aclPolicy);
            } catch {
              throw new Error("Backup contains invalid Object Storage ACL metadata.");
            }
            const escapedPolicy = JSON.stringify(JSON.parse(metadata.aclPolicy)).replaceAll(",", "\\u002c");
            customMetadata.push(`custom:aclPolicy=${escapedPolicy}`);
          }
          args.push(`--custom-metadata=${customMetadata.join(",")}`);
          args.push("-", gcloudUri(key));
          const attempt = { key, marker: restoreMarker, exitCode: undefined, generation: undefined, owned: false, spawnFailed: false };
          remoteAttempts.push(attempt);
          const child = spawn("gcloud", args, { stdio: ["pipe", "ignore", "ignore"] });
          attempt.child = child;
          attempt.close = new Promise((resolvePromise, reject) => {
            child.once("error", () => {
              attempt.spawnFailed = true;
              reject(new Error("Could not start gcloud; install and configure the Google Cloud CLI."));
            });
            child.once("close", (code) => {
              attempt.exitCode = code;
              resolvePromise(code);
            });
          });
          writer = {
            write: (chunk) => writeToStream(child.stdin, chunk),
            end: async () => {
              await endWritable(child.stdin);
              const code = await attempt.close;
              const described = await describeGcloudObject(key);
              if (described?.restoreMarker === restoreMarker && /^[0-9]+$/.test(described.generation)) {
                attempt.owned = true;
                attempt.generation = described.generation;
              }
              if (code !== 0) throw new Error("gcloud failed to restore an Object Storage object.");
              if (!attempt.owned) {
                throw new Error("gcloud reported success, but the restored object's ownership marker could not be verified.");
              }
            },
            abort: () => child.kill(),
          };
        }
      } else {
        throw new Error("Backup bundle records are invalid, duplicated, or out of order.");
      }
      while (true) {
        const chunkLength = (await read.readExact(4)).readUInt32BE(0);
        if (chunkLength === 0) break;
        if (chunkLength > 1024 * 1024) throw new Error("Backup bundle contains an oversized content chunk.");
        const chunk = await read.readExact(chunkLength);
        counted += chunk.length;
        if (metadata.size !== undefined && counted > metadata.size) throw new Error("Backup bundle record exceeds its declared size.");
        await writer.write(chunk);
      }
      if (metadata.size !== undefined && counted !== metadata.size) throw new Error("Backup bundle record size does not match its declaration.");
      if (writer.end) await writer.end();
    }
    if (!databaseSeen) throw new Error("Backup bundle does not contain a PostgreSQL database dump.");
    await read.assertEnd();
    if (!databaseSpool) throw new Error("Backup bundle database stream is incomplete.");
    await restoreEncryptedDatabaseSpool(databaseSpool, env);
    try {
      rmSync(databaseSpool.filepath, { force: true });
      databaseSpool = undefined;
    } catch {
      console.error("Restore succeeded, but the encrypted temporary database stream could not be removed; delete the .restore-db-encrypted-*.tmp file after inspection.");
    }
  } catch (error) {
    const cleanupProblems = [];
    try {
      if (databaseSpoolBuilder && !databaseSpool) databaseSpoolBuilder.abort();
      if (databaseSpool) rmSync(databaseSpool.filepath, { force: true });
    } catch {
      cleanupProblems.push("encrypted database spool cleanup failed");
    }
    for (const filepath of createdUploads) {
      try { rmSync(filepath, { force: true }); } catch { cleanupProblems.push("local upload cleanup failed"); }
    }
    for (const key of createdObjects) {
      try { rmSync(localObjectPath(adapter, key), { force: true }); } catch { cleanupProblems.push("local object cleanup failed"); }
    }
    for (const attempt of remoteAttempts) {
      if (attempt.spawnFailed) continue;
      if (attempt.child && attempt.exitCode === undefined) {
        attempt.child.kill();
        await attempt.close.catch(() => {});
      }
      if (!attempt.owned) {
        try {
          const described = await describeGcloudObject(attempt.key);
          if (!described) {
            if (attempt.exitCode === 0) {
              cleanupProblems.push("cloud upload succeeded but its object is missing during cleanup verification");
            }
            continue;
          }
          if (described.restoreMarker !== restoreMarker) {
            if (attempt.exitCode === 0) {
              cleanupProblems.push("cloud upload succeeded but ownership could not be verified; inspect the development object target");
            }
            continue;
          }
          if (!/^[0-9]+$/.test(described.generation)) {
            cleanupProblems.push("a cloud object has the restore marker but no verifiable generation");
            continue;
          }
          attempt.owned = true;
          attempt.generation = described.generation;
        } catch {
          cleanupProblems.push("cloud upload outcome is uncertain; inspect the development object target");
          continue;
        }
      }
      if (!attempt.generation) {
        cleanupProblems.push("owned cloud object has no generation for conditional cleanup");
        continue;
      }
      try {
        await runCapture("gcloud", [
          "storage", "rm", "--quiet", `--if-generation-match=${attempt.generation}`, gcloudUri(attempt.key),
        ]);
      } catch {
        cleanupProblems.push("conditional cloud object cleanup failed; inspect the development object target");
      }
    }
    if (cleanupProblems.length) {
      throw new Error(`${error.message} Additionally, ${cleanupProblems.join("; ")}. Check the isolated development restore targets.`);
    }
    throw error;
  }
}

function writeToStream(stream, chunk) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const onError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    stream.once("error", onError);
    stream.write(chunk, (error) => {
      if (settled) return;
      settled = true;
      stream.off("error", onError);
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function endWritable(stream) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const onError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    stream.once("error", onError);
    stream.end(() => {
      if (settled) return;
      settled = true;
      stream.off("error", onError);
      resolvePromise();
    });
  });
}

class BundleReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.parts = [];
    this.available = 0;
  }

  async readExact(length) {
    while (this.available < length) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Encrypted backup bundle is truncated.");
      const chunk = Buffer.from(next.value);
      if (chunk.length) {
        this.parts.push(chunk);
        this.available += chunk.length;
      }
    }
    if (length === 0) return Buffer.alloc(0);
    const result = Buffer.allocUnsafe(length);
    let copied = 0;
    while (copied < length) {
      const first = this.parts[0];
      const take = Math.min(first.length, length - copied);
      first.copy(result, copied, 0, take);
      copied += take;
      this.available -= take;
      if (take === first.length) this.parts.shift();
      else this.parts[0] = first.subarray(take);
    }
    return result;
  }

  async assertEnd() {
    if (this.available) throw new Error("Backup bundle contains unexpected trailing data.");
    const next = await this.iterator.next();
    if (!next.done) throw new Error("Backup bundle contains unexpected trailing data.");
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
  if (!process.env.HARDENING_DEV_UPLOADS_DIR) {
    throw new Error("Set HARDENING_DEV_UPLOADS_DIR to the app's actual uploads directory.");
  }
  const uploadsDirectory = resolve(process.env.HARDENING_DEV_UPLOADS_DIR);
  const adapter = getStorageAdapter();
  const scopes = getObjectScopes();
  assertDevelopmentObjectScopes(scopes);
  const { serviceFile, passwordFile } = createServiceFile(target);
  const env = { ...process.env, PGSERVICEFILE: serviceFile, PGPASSFILE: passwordFile, PGSERVICE: serviceName };
  try {
    if (operation === "backup") {
      if (existsSync(filepath)) throw new Error("Refusing to overwrite an existing backup.");
      const uploads = localUploadFiles(uploadsDirectory);
      const objects = await listAllObjects(adapter, scopes);
      const passphrase = await promptPassphrase("Encryption passphrase (hidden): ", true);
      await createEncryptedBackup(filepath, env, passphrase, uploads, objects, adapter);
      console.log(`Encrypted development backup created: ${filename || filepath.split("/").at(-1)}`);
      console.log(`Included PostgreSQL, ${uploads.length} local upload(s), and ${objects.length} Object Storage object(s).`);
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
        assertLocalUploadTargetEmpty(uploadsDirectory);
        await assertObjectTargetsEmpty(adapter, scopes);
        await restoreFromEncryptedStream(encryptedSnapshot, passphrase, verifiedHeader, env);
        console.log("Development database, local uploads, and Object Storage restored to verified empty targets.");
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