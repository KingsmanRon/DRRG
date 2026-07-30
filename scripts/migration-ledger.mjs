// Prints the one-time command that teaches Supabase which migrations a database
// already has.
//
// Why this exists: this project's migrations were applied by hand through the SQL
// editor, so `supabase_migrations.schema_migrations` — the CLI's migration history
// table — was never created. With no ledger, nothing records what is applied, and
// the repo and the database can drift apart silently. That is exactly how a
// migration deleted from the repo stayed live in the database and broke patient
// saving: no query could show that the two disagreed.
//
// `supabase migration repair` creates the history table and marks versions as
// applied. It does not run any SQL from the migrations, so it is safe against a
// database that already has this schema — it only records what is already true.
//
// Getting the version list wrong is the easy mistake (eleven 14-digit timestamps),
// so this derives it from the migrations folder instead of trusting a copy-paste.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const versions = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.split("_")[0])
  .filter((version) => /^\d{14}$/.test(version))
  .sort();

if (versions.length === 0) {
  console.error(`No migrations found in ${migrationsDir}`);
  process.exit(1);
}

const list = versions.join(" ");

console.log(`${versions.length} migrations in supabase/migrations:\n`);
for (const version of versions) console.log(`  ${version}`);

console.log(`
One time, per database that had its migrations applied by hand:

  supabase link --project-ref <your-project-ref>
  supabase migration repair --linked --status applied ${list}

Then confirm the repo and the database agree — every row should show the same
version under both "Local" and "Remote":

  supabase migration list --linked

After that, apply new migrations with "supabase db push" rather than the SQL
editor, and the ledger stays correct on its own.
`);
