// Free-tier backup: dump this app's data to local files you keep.
//
// Why this exists: Supabase's Free plan has no automated backups and no
// point-in-time recovery. This app deliberately never deletes a patient — soft
// archive only, merges keep the losing record, full audit trail — so losing the
// database loses records the application layer was built to protect.
//
// Uses pg_dump directly rather than "supabase db dump", which shells out to
// Docker and fails without a running daemon. pg_dump is a small free install
// (PostgreSQL client tools) with nothing to run in the background, which is what
// a practice machine wants.
//
// This is NOT equivalent to automated backups plus PITR. It captures the database
// at the moment it runs, so anything entered since the last run is still lost.
// Schedule it (see BACKUP.md) and treat it as a floor, not a target.
//
// Three files per run:
//   schema.sql      public + private schemas: tables, functions, policies
//   data.sql        the rows — patients, consents, audit events
//   auth-users.sql  staff login rows, which profiles.user_id references
//
// Only the schemas this app owns are dumped. A whole-database dump would drag in
// Supabase's own auth/storage/realtime internals, which conflict on restore into
// a fresh project.
//
// PATIENT DATA LEAVES SUPABASE WHEN THIS RUNS. The output directory is
// gitignored, but that stops accidental commits — it does not encrypt anything.
// Read the storage section of BACKUP.md before pointing this at a shared drive,
// a sync folder, or anything that leaves the practice.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(`SUPABASE_DB_URL is required.

Supabase dashboard -> Project Settings -> Database -> Connection string -> URI.
It looks like:

  postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

Special characters in the password must be percent-encoded (@ becomes %40).
Put it in .env (already gitignored) or set it for one run:

  SUPABASE_DB_URL="postgresql://..." npm run backup
`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

// pg_dump refuses to dump a server newer than itself. Supabase projects run
// Postgres 15 or 17 depending on when they were created, so a local 16 is a real
// possibility — catch it here with an explanation instead of pg_dump's version
// error, which does not say what to install.
const localVersion = run("pg_dump", ["--version"]);
if (localVersion.status !== 0) {
  console.error(`pg_dump was not found on PATH.

Install the PostgreSQL client tools (free — you do not need a local server):
  Windows  https://www.postgresql.org/download/windows/  (the installer can
           deselect "PostgreSQL Server" and install only "Command Line Tools")
  macOS    brew install libpq   then add its bin directory to PATH
  Linux    sudo apt install postgresql-client
`);
  process.exit(1);
}
const localMajor = Number((localVersion.stdout.match(/(\d+)\./) ?? [])[1]);

const serverProbe = run("psql", [dbUrl, "-tAc", "show server_version"]);
if (serverProbe.status !== 0) {
  console.error(`Could not connect to the database.\n\n${(serverProbe.stderr || "").trim()}`);
  process.exit(1);
}
const serverMajor = Number((serverProbe.stdout.match(/(\d+)/) ?? [])[1]);

if (localMajor && serverMajor && localMajor < serverMajor) {
  console.error(`pg_dump is version ${localMajor}, the database is Postgres ${serverMajor}.

pg_dump cannot dump a newer server. Install PostgreSQL ${serverMajor} client tools
and re-run — a dump taken by a mismatched pg_dump is not trustworthy.
`);
  process.exit(1);
}

const outRoot = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(repoRoot, "backups");

// How many runs to keep. Pruning happens only after a successful run, never
// before — a failed backup must not delete the last good one.
const keep = Number(process.env.BACKUP_KEEP ?? 30);

// 20260730T1059Z — sorts chronologically as a plain string, and contains no
// character Windows rejects in a directory name.
const now = new Date();
const stamp =
  `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}` +
  `${String(now.getUTCDate()).padStart(2, "0")}T` +
  `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}Z`;
const outDir = path.join(outRoot, stamp);
mkdirSync(outDir, { recursive: true });

/**
 * Two things stop a raw pg_dump of these schemas from restoring cleanly. Both
 * were found by actually restoring a dump into an empty database rather than
 * assuming the file was good.
 *
 * 1. pg_dump emits a bare "CREATE SCHEMA public;" when public is named
 *    explicitly. Every database already has one, so it always fails — and it is
 *    near the top of the file, so with ON_ERROR_STOP=1 the whole restore aborts
 *    having created nothing.
 *
 * 2. The schema depends on extensions that live outside it — patients.id defaults
 *    to extensions.gen_random_uuid() (pgcrypto) and private.normalise_name calls
 *    extensions.unaccent(). Restoring without them produces a database that looks
 *    complete and fails on the first save, which is the worst possible outcome for
 *    a backup. The required list is read from the source database rather than
 *    hardcoded, so a migration that adds an extension cannot silently produce
 *    dumps that no longer restore.
 *
 * Fixing both here keeps the restore runnable with ON_ERROR_STOP=1, which is
 * what we want: a real error must stop the restore rather than scroll past while
 * it half-completes.
 */
function makeSchemaRestorable(file, requiredExtensions) {
  const dumped = readFileSync(file, "utf8").replace(
    /^CREATE SCHEMA (public|private);$/gm,
    "CREATE SCHEMA IF NOT EXISTS $1;",
  );

  const lines = requiredExtensions.flatMap(({ name, schema }) => [
    `CREATE SCHEMA IF NOT EXISTS ${schema};`,
    `CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA ${schema};`,
  ]);

  const preamble = `--
-- Prerequisites this dump depends on but does not itself contain, read from the
-- source database at backup time. Already true on a Supabase project; stated so
-- the file also restores onto a plain Postgres server.
--
${lines.join("\n")}

`;

  writeFileSync(file, preamble + dumped);
}

/** Extensions installed on the source database, with the schema each lives in. */
function readRequiredExtensions() {
  const probe = run("psql", [
    dbUrl,
    "-tAF",
    "\t",
    "-c",
    "select e.extname, n.nspname from pg_extension e " +
      "join pg_namespace n on n.oid = e.extnamespace " +
      "where e.extname <> 'plpgsql' order by e.extname",
  ]);
  if (probe.status !== 0) {
    console.error(`Could not read the extension list.\n\n${(probe.stderr || "").trim()}`);
    process.exit(1);
  }
  return probe.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, schema] = line.split("\t");
      return { name, schema };
    });
}

const steps = [
  {
    file: "schema.sql",
    label: "schema",
    args: ["--schema-only", "--schema=public", "--schema=private"],
    after: (file) => makeSchemaRestorable(file, requiredExtensions),
  },
  {
    file: "data.sql",
    label: "data",
    args: ["--data-only", "--schema=public", "--schema=private"],
  },
  {
    file: "auth-users.sql",
    label: "staff logins",
    // Staff auth rows only. profiles.user_id has a foreign key to these, so a
    // data restore fails without them.
    args: ["--data-only", "--table=auth.users"],
  },
];

const requiredExtensions = readRequiredExtensions();

console.log(
  `Backing up Postgres ${serverMajor} to ${outDir}\n` +
    `  requires: ${requiredExtensions.map((e) => e.name).join(", ") || "(none)"}\n`,
);

for (const { file, label, args, after } of steps) {
  const target = path.join(outDir, file);
  process.stdout.write(`  ${label.padEnd(14)}`);
  const result = run("pg_dump", [dbUrl, "--no-owner", "--no-privileges", "-f", target, ...args]);
  if (result.status === 0 && after && existsSync(target)) after(target);
  const bytes = result.status === 0 && existsSync(target) ? statSync(target).size : 0;
  if (result.status !== 0 || bytes === 0) {
    console.log(result.status !== 0 ? "FAILED" : "FAILED (empty file)");
    console.error(`\n${(result.stderr || result.stdout || "").trim()}`);
    // Leave the partial directory: a half-written backup that is visibly there
    // is easier to notice than one silently cleaned away.
    console.error(`\nBackup FAILED. Partial output left at ${outDir}`);
    console.error("Nothing was pruned, so the previous backup is untouched.");
    process.exit(1);
  }
  console.log(`${(bytes / 1024).toFixed(1)} KB`);
}

const runs = readdirSync(outRoot)
  .filter((name) => /^\d{8}T\d{4}Z$/.test(name))
  .sort();
const stale = runs.slice(0, Math.max(0, runs.length - keep));
for (const name of stale) rmSync(path.join(outRoot, name), { recursive: true, force: true });

console.log(`
Backup complete. ${runs.length - stale.length} kept${stale.length ? `, ${stale.length} pruned` : ""}.

This backup is unencrypted and only on this machine, so it is not safe yet —
see the storage section of BACKUP.md.

Restore order matters (schema, then logins, then data):
  psql "<target-db-url>" -f schema.sql
  psql "<target-db-url>" -f auth-users.sql
  psql "<target-db-url>" -f data.sql
`);
