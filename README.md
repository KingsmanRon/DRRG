# DRRG Patient Onboarding

An internal patient onboarding and register application for Dr Refiloe G's cash patients.

## Scope

1. Authenticated doctor and staff access.
2. Cash patient onboarding.
3. South African ID, passport, other foreign document and no document support.
4. Exact identity duplicate blocking.
5. Soft duplicate review using name, date of birth and phone.
6. Patient search, consent capture and audit history.

Clinical notes, billing and medical aid workflows are deliberately excluded.

## Duplicate control

The system uses two levels of duplicate protection.

1. A South African ID is a hard unique identifier. A matching ID cannot create another patient.
2. A passport or foreign document is unique by document type, issuing country and normalised document number.
3. Patients without an identity document can still be registered when staff record the reason.
4. Soft matches use a weighted score: full name +3, date of birth +3, email +2,
   mobile number +1, address +1. An identity-number match is decisive.
5. Pairs are tiered: **Likely duplicate** (identity match, name + date of birth,
   or score ≥ 6) and **Possible duplicate** (score 2–5). A single weak field
   (phone alone, address alone) is not flagged; phone + address together is only
   ever "Possible" because relatives share phones and addresses.
6. Possible matches do not automatically block registration. Staff must review
   every match and record why a separate patient is being created.
7. Flagged pairs are resolved on the Possible duplicates page by **merging**
   (one record survives, the other is archived — never deleted — and its file
   number keeps finding the kept patient) or by **keep both**, which is
   remembered and re-opened only if the matched details later change.

South African mobile numbers are normalised so local `082...` and international `+27 82...` formats match one another. Names and addresses are compared ignoring case, punctuation and accents.

Patient records are never hard deleted (HPCSA requires clinical records to be retained). Merging archives the losing record and keeps it queryable for audit.

## Local setup (real database)

The app runs end-to-end against a local Supabase stack. Docker Desktop must be running.

1. Install Node.js 20.9 or later and start Docker Desktop.
2. Run `npm install`.
3. Start Supabase: `npx supabase start`. Copy the printed `API URL`, `publishable key`
   and `secret key`.
4. Create `.env.local` (see `.env.example`) with:
   - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` = the API URL (e.g. `http://127.0.0.1:54321`)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` = the publishable key
   - `SUPABASE_SECRET_KEY` = the secret key (server-only; used by the seed/verify scripts)
   - `DRRG_DEMO_MODE=false`
5. Apply migrations and seed data: `npx supabase db reset`.
6. Create a local staff login: `npm run seed:local:staff`
   (defaults to `doctor@drrg.local` / `LocalTest123!`).
7. Run `npm run dev` and sign in at `/login`.

Useful checks: `npm run verify:db` (exercises the onboarding/duplicate RPCs) and
`npm run test` (unit tests). When hosting on Supabase Cloud later, point the same
environment variables at the cloud project and apply the migrations there.

The legacy `DRRG_DEMO_MODE=true` fake-data mode is deprecated and off by default; the
app now uses the real database for all screens.
