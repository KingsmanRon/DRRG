# Backups

The Supabase Free plan has **no automated backups and no point-in-time recovery**.
This app is deliberately built never to lose a patient record — soft archive only,
merges keep the losing record, a full audit trail, and no delete path anywhere —
so the database is the single point of failure for records the application layer
was designed to protect.

`npm run backup` is the free stopgap. Be clear about what it is:

| | |
|---|---|
| Costs | nothing — local `pg_dump`, no Docker, no add-ons |
| Captures | the database at the moment you run it |
| Does **not** cover | anything entered since the last run |
| Replaces PITR? | **No.** PITR recovers to a point in time; this recovers to your last run |

If the practice can move to Supabase Pro, do that — daily backups plus PITR is the
real answer, and this script becomes a belt-and-braces second copy.

## One-time setup

**1. Install the PostgreSQL client tools** (free; you do not need a local server):

- Windows — <https://www.postgresql.org/download/windows/>. In the installer you
  can deselect *PostgreSQL Server* and install only *Command Line Tools*.
- macOS — `brew install libpq`, then add its `bin` directory to `PATH`.
- Linux — `sudo apt install postgresql-client`.

The `pg_dump` version must be **at least** the database's Postgres version — it
refuses to dump a newer server. `npm run backup` checks this and tells you which
version to install, because a dump from a mismatched `pg_dump` is not trustworthy.

**2. Set the connection string.** Supabase dashboard → *Project Settings* →
*Database* → *Connection string* → *URI*:

```
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

Put it in `.env` (already gitignored). Percent-encode special characters in the
password — `@` becomes `%40`.

## Running it

```bash
npm run backup
```

Writes to `backups/<UTC timestamp>/` (gitignored) and keeps the last 30 runs.
Override with `BACKUP_DIR` and `BACKUP_KEEP`. Pruning happens only after a
successful run, so a failed backup never deletes your last good one.

Three files, which is what a working restore needs:

| File | Contents |
|---|---|
| `schema.sql` | `public` + `private` — tables, functions, RLS policies, plus the extensions the schema depends on |
| `data.sql` | the rows: patients, consents, audit events, duplicate reviews |
| `auth-users.sql` | staff login rows, which `profiles.user_id` references |

Only the schemas this app owns are dumped. A whole-database dump drags in
Supabase's own `auth`/`storage`/`realtime` internals, which conflict on restore.

## Storing them — read this before automating

**Every backup file contains patient health information in plain text.** The
output directory is gitignored, which prevents an accidental commit and nothing
else. The files themselves are unencrypted.

- **Do** keep them on practice-controlled hardware, on an encrypted volume
  (BitLocker, FileVault, LUKS) or inside an AES-encrypted archive (7-Zip's
  *Encrypt file names* + AES-256 is free).
- **Do** keep at least one copy off the machine that made it — a backup that dies
  with the laptop is not a backup. An encrypted external drive, swapped weekly, is
  enough and costs nothing.
- **Do not** put them in Dropbox/Google Drive/OneDrive, a GitHub repo, or a CI
  artifact store. Free tiers of those are the obvious "free backup" answer and the
  wrong one: patient data would leave the practice's control, and consumer sync
  services are not an appropriate place for health records.
- **Do not** email them.

This app holds South African patient records, so POPIA and HPCSA record-keeping
obligations apply to the backups as much as to the database. The guidance above is
the sensible technical floor, not legal advice — confirm the retention period and
handling requirements with whoever advises the practice.

## Scheduling

Nothing here runs itself. Pick a cadence — daily after close is a reasonable
default for a clinic — and schedule it.

**Windows (Task Scheduler):**

```
Program:    cmd.exe
Arguments:  /c cd /d C:\path\to\DRRG && npm run backup >> backup.log 2>&1
Trigger:    Daily, 18:30
```

Tick *Run whether user is logged on or not*, and make sure the machine is actually
on at that time.

**macOS / Linux (cron):**

```cron
30 18 * * * cd /path/to/DRRG && /usr/bin/npm run backup >> backup.log 2>&1
```

Then **check the log occasionally**. A scheduled job that has been failing quietly
for six weeks is the classic way to discover you had no backups at the worst
possible moment.

## Restoring

This procedure has been tested end to end: dumped from a populated database,
restored into an empty one, and the restored database then verified to work —
registering a new patient, keeping the file-number sequence (no restart from 1),
and searching correctly.

1. Create a new Supabase project (see `DEPLOY.md` step 1).
2. Get its connection string, then restore **in this order**:

```bash
psql "<new-db-url>" -v ON_ERROR_STOP=1 -f schema.sql
psql "<new-db-url>" -v ON_ERROR_STOP=1 -f auth-users.sql
psql "<new-db-url>" -v ON_ERROR_STOP=1 -f data.sql
```

Order matters: `data.sql` needs the tables, and `profiles` rows have a foreign key
to `auth.users`.

Keep `ON_ERROR_STOP=1`. Without it `psql` prints errors and carries on, leaving a
half-restored database that looks fine — exactly the failure you cannot afford
here.

3. Point the app at the new project (`DEPLOY.md` step 5), then run the smoke test
   in `DEPLOY.md` step 6.
4. Staff sign-in: `auth-users.sql` restores the user rows, but passwords may need
   resetting from the dashboard. If a login is missing, recreate it per
   `DEPLOY.md` step 3.

### Test a restore before you need one

Once a quarter, restore your latest backup into a scratch Supabase project and
confirm you can sign in and see patients. An untested backup is a guess. The
script verifies each dump is non-empty, but only a real restore proves the files
are usable.
