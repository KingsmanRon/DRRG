# Deployment checklist (Supabase + app)

This app is an internal, staff-only patient onboarding tool. It talks to Supabase
via the Data API (PostgREST) for every read/write, so the database must be set up
before the app will work.

## 1. Create the Supabase project

- **Region:** Supabase has no South Africa region. Pick the closest — **EU (Frankfurt
  `eu-central-1`)** or **EU (Ireland `eu-west-1`)** (~150–180 ms to Johannesburg).
  If a Cape Town / `af-south-1` region is offered, prefer it. Avoid US regions.
- **Postgres type:** **Default** (standard Postgres). Not the alpha/OrioleDB option.
- **Data API:** **Enabled** (required — the app depends on it).
- **Auto-expose new tables to the Data API:** **Off** (migrations grant access
  explicitly; auto-expose would leak future tables).
- **Automatic RLS on new tables:** **On** (safer default; migrations also enable RLS
  on every table).

## 2. Apply the migrations to the cloud database

Every migration in `supabase/migrations/` must be applied, in filename order.
**Apply migrations before deploying new app code** — the old app works against the
new schema, but not the other way round:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Prefer `db push` over pasting SQL into the editor. `db push` records what it
applied in the migration history table; the SQL editor does not, and a database
with no history is one nobody can check for drift (see 2a).

## 2a. Migration history: required once per hand-applied database

The CLI tracks applied migrations in `supabase_migrations.schema_migrations`. A
database whose migrations were pasted into the SQL editor has no such table, so
nothing records what is applied and the repo and the database can disagree in
silence. That is not hypothetical: a migration was once deleted from this repo
while still live in the database, and patient saving broke with a generic error
because no query could show that the two had diverged.

Fix it once, per database:

```bash
npm run migrations:ledger      # prints the command below with every version filled in
```

```bash
supabase link --project-ref <your-project-ref>
supabase migration repair --linked --status applied <every version the script printed>
```

`migration repair` runs none of the migrations' SQL — it only records versions as
already applied, so it is safe on a database that already has this schema.

Then check that the repo and the database agree:

```bash
supabase migration list --linked
```

Every row must show the same version under **Local** and **Remote**. A version
present on one side only is drift, and is worth resolving before deploying.

If you cannot use the CLI, this query answers the same question directly:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

An error saying the relation does not exist means step 2a has not been done yet.

## 3. Create staff logins

A login needs **two** things — an auth user AND a matching profile row. Without the
profile row, sign-in succeeds but access is denied.

1. Supabase → Authentication → Users → add the user (email + password).
2. Supabase → SQL editor:

   ```sql
   insert into public.profiles (user_id, display_name, role, active)
   values ('<auth-user-uuid>', 'Dr Refiloe G', 'doctor', true);
   ```

   `role` is `doctor` or `staff`. `doctor` additionally can read audit/deletion logs.

## 4. Lock down auth

- Supabase → Authentication → Providers/Settings: **disable public sign-ups**
  (this is a staff-only app; users are provisioned by an admin).

## 5. Configure the app host (e.g. Vercel)

Set these environment variables to the **cloud** project's values:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- **Never** put the secret key in a `NEXT_PUBLIC_*` variable. The app does not use the
  secret key; only the local `seed:*`/`verify:db` scripts do, and those are not run in
  production.

## 6. Smoke test after deploy

- Sign in with a staff account → lands on `/patients`.
- Register a new patient (with and without a file number).
- Open a patient → edit a field → save.
- Trigger a duplicate (same name + date of birth) → it appears on **Possible
  duplicates** as "Likely duplicate" with both records compared.
- Merge the pair (keep one record) → the kept record shows the union of the
  data, and searching the archived record's file number finds the kept one.
- Open the archived record by its old URL → read-only "merged into" banner.
- Flag another pair and choose **Different patients — keep both** → the pair
  leaves the queue and stays resolved after a reload.
- Sign in as a **doctor** → open a patient → **Activity history** lists create /
  update / merge events with staff names.
- Archive a test patient with a reason → it leaves the list; open by URL →
  read-only archived view. As doctor, **Restore** returns it to the register.
- A merged (not manually archived) record must **not** offer Restore.
- As doctor on Patients: **Include archived** / **Archived only** chips find archived
  files; staff must not see those chips.
- Register a patient with **No identity document** → the reason is a dropdown, saving
  works without a note, and a note is demanded only for **Other**. Edit that patient
  back to an SA ID → the reason clears.
- Register a patient with a **postal code** and one without → both save. Typing three
  digits blocks the step with "Enter a four-digit postal code."; clearing the field
  saves and the patient detail shows only the address.
- Register a second patient with the **same name and address** as the first but a
  different date of birth → **Possible duplicates** flags the pair on name and
  address, with the postal code shown as its own row.

(There is intentionally no way to delete a patient — records are retained
per HPCSA guidance; merging archives the losing record.)

If all of these pass, the deployment matches local behaviour.

## 7. Once, with the postal code migration (20260803120000)

That migration adds `patients.postal_code` and lifts a trailing postal code out
of the addresses where doing so is unambiguous. It rewrites patient data, so it
gets its own checks. Run them in this order, and before deploying the app code
if the two are not going out together.

**Before applying**, take the counts to compare against:

```sql
select count(*) as patients,
       count(residential_address) as with_address
from public.patients;
```

**After applying**, confirm nothing was lost or emptied:

```sql
-- Same totals as before, and no address became too short to be valid.
select count(*) as patients,
       count(residential_address) as with_address,
       count(*) filter (where char_length(btrim(residential_address)) < 3) as broken
from public.patients;

-- Every address the migration changed, for a human to read.
select file_number, residential_address, postal_code
from public.patients
where postal_code is not null
order by file_number;

-- Addresses that are only a number were left alone on purpose.
select file_number, residential_address
from public.patients
where residential_address ~ '^[0-9\s]+$';
```

`broken` must be `0`, and the patient total must match the before count exactly.

**Then queue the known pair.** The matcher runs when a record is registered or
edited; it does not rescan the register, so the pair that prompted this change
is queued once, by hand:

1. Confirm the database now sees it:

   ```sql
   select m.tier, m.score, m.reasons
   from public.patients a, public.patients b,
        lateral private.duplicate_match(a.id, b.id) m
   where a.file_number = '2014' and b.file_number = '1450';
   ```

   Expected: `possible`, `4`, `{name,address}`.

2. Set `:reviewer_email` in
   `supabase/post-deploy/20260803_flag_boitumelo_phale_review.sql` to the staff
   account doing the review, and run the file. It refuses to do anything unless
   both files are active, the account is active staff, and the pair still
   matches; running it twice queues nothing twice.

3. Open **Possible duplicates** in the app. The pair is a decision for staff:
   whether it is one person, whether the date of birth is 9 or 10 September
   1995, which phone is current, which consent and audit history stays attached,
   and whether 1450 should be merged into 2014. **Nothing is merged
   automatically**, and no date of birth is corrected without staff confirming.

**Rolling the app back** does not require rolling this back. Keep the column and
the split addresses: older app code reads and writes `residential_address` as
before and simply ignores `postal_code`. Do not re-append the codes to the
addresses — there is no verified migration for that, and it would undo the
matching this deployment is for.
