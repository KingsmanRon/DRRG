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

All migrations in `supabase/migrations/` must be applied, in order (as of
2026-07-10 there are four; the two `20260710*` ones add the merge flow and
weighted duplicate scoring). **Apply migrations before deploying new app
code** — the old app works against the new schema, but not the other way
round:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

(Or paste each migration's SQL into the Supabase SQL editor, oldest first.)

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

- Do **not** set `DRRG_DEMO_MODE` (or set it to `false`).
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

(There is intentionally no way to delete a patient — records are retained
per HPCSA guidance; merging archives the losing record.)

If all of these pass, the deployment matches local behaviour.
