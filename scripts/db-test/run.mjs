// Applies every migration in supabase/migrations to a throwaway database and
// runs the SQL tests in scripts/db-test/tests against the result.
//
// Why this exists separately from `npm run verify:db`: that script talks to a
// running Supabase project through PostgREST, so it can only check what the API
// exposes and it cannot test a migration's *backfill* — by the time it connects,
// the migration has already run. This runner applies the migrations itself, so a
// test can seed rows before a migration and assert on what the migration did to
// them (scripts/db-test/before/<migration>.sql).
//
// Requirements: psql, and a PostgreSQL server. Defaults to the local Supabase
// database (postgresql://postgres:postgres@127.0.0.1:54322/postgres) — set
// DATABASE_URL to point anywhere else. Nothing is written to the database named
// in the URL: the runner creates and drops its own database beside it.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const beforeDir = path.join(here, "before");
const testsDir = path.join(here, "tests");

const adminUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const testDatabase = `drrg_db_test_${process.pid}`;
const applyShim = process.env.DRRG_DB_TEST_SHIM !== "0";

function urlForDatabase(name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function psql(url, args, { capture = true } = {}) {
  const result = spawnSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-X", "-q", "--no-psqlrc", url, ...args],
    { encoding: "utf8", stdio: capture ? "pipe" : "inherit" },
  );
  if (result.error?.code === "ENOENT") {
    console.error(
      "psql was not found on PATH. Install the PostgreSQL client tools, or run this\n" +
        "against the Supabase CLI's bundled psql (`npx supabase db shell` uses the same binary).",
    );
    process.exit(2);
  }
  return result;
}

function run(url, args, label) {
  const result = psql(url, args);
  if (result.status !== 0) {
    console.error(`\n✗ ${label}\n${result.stderr.trim()}`);
    return { ok: false, output: `${result.stdout}${result.stderr}` };
  }
  return { ok: true, output: `${result.stdout}${result.stderr}` };
}

function sqlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

const probe = psql(adminUrl, ["-tAc", "select 1"]);
if (probe.status !== 0) {
  console.error(
    `Could not connect to ${adminUrl}\n${probe.stderr.trim()}\n\n` +
      "Start the database first (`npx supabase start`) or set DATABASE_URL.",
  );
  process.exit(2);
}

psql(adminUrl, ["-c", `drop database if exists ${testDatabase}`]);
const created = psql(adminUrl, ["-c", `create database ${testDatabase}`]);
if (created.status !== 0) {
  console.error(`Could not create ${testDatabase}:\n${created.stderr.trim()}`);
  process.exit(2);
}

const testUrl = urlForDatabase(testDatabase);
let failures = 0;
let assertions = 0;

try {
  if (applyShim) {
    // On Supabase these objects are part of the platform. Locally they are not,
    // so the migrations get the roles, auth.users and auth.uid() they expect.
    const shim = run(testUrl, ["-f", path.join(here, "shim.sql")], "supabase shim");
    if (!shim.ok) process.exit(1);
  }

  for (const migration of sqlFiles(migrationsDir)) {
    // A migration that changes existing rows is tested by seeding those rows
    // first — that is the only moment the "before" state exists.
    const seed = path.join(beforeDir, migration);
    if (existsSync(seed)) {
      const seeded = run(testUrl, ["-f", seed], `seed before ${migration}`);
      if (!seeded.ok) process.exit(1);
    }

    const applied = run(testUrl, ["-f", path.join(migrationsDir, migration)], `migration ${migration}`);
    if (!applied.ok) process.exit(1);
    console.log(`  applied ${migration}`);
  }

  const harness = run(testUrl, ["-f", path.join(here, "harness.sql")], "test harness");
  if (!harness.ok) process.exit(1);

  console.log("");
  for (const file of sqlFiles(testsDir)) {
    const result = run(testUrl, ["-f", path.join(testsDir, file)], file);
    const passed = (result.output.match(/NOTICE:  ok - /g) ?? []).length;
    assertions += passed;
    if (result.ok) {
      console.log(`✓ ${file} (${passed} assertions)`);
    } else {
      failures += 1;
      // The failing assertion names itself in the error psql already printed.
      console.error(`  ${passed} assertions passed before the failure`);
    }
  }
} finally {
  psql(adminUrl, ["-c", `drop database if exists ${testDatabase} with (force)`]);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} test file(s) failed.`);
  process.exit(1);
}
console.log(`Database tests passed: ${assertions} assertions.`);
