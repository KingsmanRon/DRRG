# DRRG Patient Onboarding

An internal patient onboarding and register application for Dr Refiloe G's cash patients.

How the system is put together — trust boundaries, data model, RPC surface,
schema-change process — is in **[docs/architecture.md](docs/architecture.md)**.
Deployment lives in [DEPLOY.md](DEPLOY.md), the interface specification in
[docs/design](docs/design/README.md).

## Scope

1. Authenticated doctor and staff access.
2. Cash patient onboarding.
3. South African ID, passport, other foreign document and no document support.
4. Exact identity duplicate blocking.
5. Soft duplicate review using name, date of birth and phone.
6. Patient search, consent capture and audit history (doctors see activity on each file).
7. Family files: one file number may cover several people.

Clinical notes, billing and medical aid workflows are deliberately excluded.

## Family files

Cash patients are filed by household, so one file number can carry more than one
person. Each person is still a full patient record with their own identity
document and own audit trail — only the **number** is shared, and it is not
rewritten or suffixed when a household grows.

Tick **"This file covers more than one person"** when registering, and the form
reopens on the same file number for the next member once the first is saved. The
same flow is available later from any patient: **Add a person to this file**.

### Adding a person is a short form, not a second registration

Opening a file is a four-step registration. Adding someone to a file that
already exists asks **only who they are** — one screen, three fields for the
usual case:

1. **First names and surname.**
2. **"This person has a South African ID"**, ticked by default. Ticked, the ID
   number is asked for and the **date of birth is read out of it**; unticked,
   the date of birth is asked for along with one select covering both remaining
   questions — which other document there is, or why there is none.
3. **Contact details are the file's** and are shown as a line of text rather
   than asked again. *"This person's contact details are different"* opens the
   fields for the household member who lives elsewhere or has their own phone.
4. **Consent is the file's** (below), so there is no consent step.

The date of birth taken from an ID is shown, not hidden: an ID number does not
say which century it belongs to, so the most recent plausible date is used and
can be corrected in one click. That matters only for patients over about a
hundred.

Possible duplicates still stop the save, and staff still confirm and write a
reason — but people already on the file never match each other, so a household
member rarely sees the panel at all.

### Consent covers the file

The person who opens a file signs once. When someone is added to that file, that
signature is **promoted to cover the household** and the new member's record
carries a consent that names whose signature it is (`granted_by_patient_id`).
Nobody's consent is invented: an inherited record does not claim the new person
signed, and does not claim anyone attested they were present. A file that never
grows keeps its individual consent, and consents captured one-per-person before
this change are left exactly as they were.

This is also the more accurate record for who is usually on a family file —
children cannot sign their own consent, and a guardian's signature is what
actually covers them.

Because the file number is no longer unique, two rules protect it:

1. A number already in use can only be reused through *Add a person to this
   file*. Typing an existing number into the new-patient form is still rejected,
   so a mistyped digit cannot attach someone to a stranger's household, and the
   edit form will not let a patient be retyped onto another file.
2. People on one file never flag each other as possible duplicates — sharing a
   file is a staff statement that they are different people. Relatives share a
   phone (+1) and an address (+1), which is exactly the threshold that would
   otherwise demand a written justification for every member added.

In the register, patients sharing a file number collapse into one expandable
file row, so a household reads as a single file rather than repeated records.
Files with one patient are shown as ordinary rows.

Merging is unaffected except that a losing file number only becomes a search
alias when nobody else still holds it, so archiving one member never redirects
searches for the whole household.

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

People sharing a file number are excluded from each other's duplicate checks.
South African mobile numbers are normalised so local `082...` and international `+27 82...` formats match one another. Names and addresses are compared ignoring case, punctuation and accents.

## Address and postal code

The postal code is captured in its own optional field, not inside the address.
It is stored in `patients.postal_code` (four digits, or nothing at all) and is
**never** a duplicate signal — thousands of patients share 1983, so a delivery
area identifies nobody. It is shown beside the address when a pair is reviewed,
because seeing that one file carries the code and the other does not is often
what explains the pair.

Addresses are matched on their content: case, punctuation, accents, line breaks
and a trailing postal code all fall away, so `1410 Zone 13 Sebokeng 1983`,
`1410 / Zone13 / Sebokeng` and `1410 Zone 13 Sebokeng` are one address. That is
what the register was missing — two files for one household stayed apart purely
because reception had typed the postal code on one of them.

Postal code is optional and stays optional: a patient without one is a complete
record, and the contact rule (a phone and an address, unless a reason is
recorded) is unchanged. The migration that introduced the column lifted trailing
codes out of existing addresses only where it was unambiguous; a number-only
address such as `17234` is a stand number and was left exactly as it was.

Patient records are never hard deleted (HPCSA requires clinical records to be retained). Merging archives the losing record and keeps it queryable for audit. Staff can also **archive** a single file that was registered in error (with a reason); **doctors** can **restore** manually archived files. Records archived by a merge cannot be restored — open the kept file instead.

**Doctors** can filter the patient list: Active only · Include archived · Archived only. Reception staff always see the active register.

Scoring for production decisions runs in Postgres (`private.duplicate_match` /
`find_possible_duplicates`). The TypeScript helpers in `src/lib/patients/duplicate-score.ts`
format UI banners and lock the weight/tier contract with unit tests.

## Local setup

The app runs end-to-end against a local Supabase stack. Docker Desktop must be running.

1. Install Node.js 20.9 or later and start Docker Desktop.
2. Run `npm install`.
3. Start Supabase: `npx supabase start`. Copy the printed `API URL`, `publishable key`
   and `secret key`.
4. Create `.env.local` (see `.env.example`) with:
   - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` = the API URL (e.g. `http://127.0.0.1:54321`)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` = the publishable key
   - `SUPABASE_SECRET_KEY` = the secret key (server-only; used by the seed/verify scripts)
5. Apply migrations and seed data: `npx supabase db reset`.
6. Create a local staff login: `npm run seed:local:staff`
   (defaults to `doctor@drrg.local` / `LocalTest123!`).
7. Optionally seed sample patients: `npm run seed:local:patients`.
8. Run `npm run dev` and sign in at `/login`.

Useful checks: `npm run verify:db` (onboarding/duplicate RPCs), `npm run verify:merge`
(merge flow), `npm run test` (unit tests) and `npm run test:db` (applies every
migration to a throwaway database and asserts on the result — including what a
migration's backfill did to rows seeded before it ran). When hosting on Supabase
Cloud later, point the same environment variables at the cloud project and apply
the migrations there.

There is no demo/fake-data mode — all screens use the real database.
