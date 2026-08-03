# Changelog

## 2026-08-03 — Postal code leaves the address, and a missed duplicate surfaces

Two files existed for what looks like one patient — 2014 and 1450, both
"Boitumelo Phale", same address, dates of birth a day apart — and the register
never said so. The addresses were identical apart from `1983` on the end of one
of them, and address matching compared the whole string, so the pair scored 3
across a single field and stayed below the threshold.

- **Postal code is its own field.** Optional, four digits, blank stored as
  nothing. It appears below the residential address on the registration and edit
  forms, and on the patient file as the last line of the address. A patient
  without one is a complete record — the phone-and-address rule is unchanged.
- **Existing addresses were split** where doing so was unambiguous: the address
  must end in a standalone four-digit token, something has to be left behind,
  and what is left has to contain a letter. Number-only addresses like `17234`
  are stand numbers and were left untouched, as was anything the rule could not
  read confidently. Nothing else about an address was rewritten — line breaks,
  capitalisation and punctuation are as entered.
- **Addresses now match on their content**: case, punctuation, accents, line
  breaks and a trailing postal code fall away, so `1410 Zone 13 Sebokeng 1983`
  and `1410 Zone 13 Sebokeng` are one address, and so are `Zone 13` and
  `Zone13`. A postal code typed into the address box by habit can no longer hide
  a match.
- **A postal code is worth nothing on its own.** Thousands of patients share
  1983; a delivery area identifies nobody. It is shown beside the address on the
  duplicate review screen — which file has it and which does not is often the
  explanation — but it scores zero and never changes a tier. The weights are
  otherwise untouched: name 3, date of birth 3, email 2, phone 1, address 1.
- **Households are unaffected.** People on one file still never flag each other,
  and relatives sharing an address and a phone are still only ever "possible".
- **Fixed alongside:** a pair involving a patient with no phone (or no address)
  could never reach the "possible" tier. Both fields became optional in July and
  the comparison was left returning NULL rather than false, which made the
  "two matching fields" test unknown. Every comparison is now explicit.
- **Files 2014 and 1450 are a decision for staff, not for the software.**
  Nothing was merged and no date of birth was corrected. The pair is queued for
  review by a documented post-deployment script
  (`supabase/post-deploy/20260803_flag_boitumelo_phale_review.sql`), which
  refuses to run unless both files are active and the database still considers
  them a match.
- **`npm run test:db`** applies every migration to a throwaway database and
  asserts on the result — including what this migration's backfill did to rows
  seeded before it ran, which is the one thing an API-level check can never see.

## 2026-07-30 — Coded identity reason, and drift made visible

Patients recorded as **No identity document** could not be saved. The database
required a coded reason while the app still sent free text, because the
migration that introduced the code was deleted from the repo after it had
already been applied — deleting the file removed it from git, not from Postgres.

- **Reason for no identity document is now a dropdown**, not a free-text box:
  not brought, newborn, lost or stolen, Home Affairs pending, asylum permit
  pending, declined, other. A note is optional except for **Other**, which is
  the point — the old always-required text box is what produced values like
  "Nog applicable". Reasons that resolve themselves later default **Ask again
  at the next visit** on, and staff can override it.
- **The existing register UI is unchanged.** Only the two Identity sections
  changed; the patient table, search, sorting and pagination are untouched.
- **Failed saves now say why.** A rejected identity shape returns a specific
  message instead of a generic 500, guard rejections from the database return
  422 rather than 500, and a missing function or column is reported as "the
  database is out of date" instead of an unexplained failure. Every failed
  mutation is logged with its Postgres code — previously nothing was.
- **Migration history is now tracked.** `npm run migrations:ledger` prints the
  one-time command that teaches Supabase which migrations a hand-applied
  database already has, so repo-versus-database drift is a query away instead
  of a debugging session. See DEPLOY.md step 2a.

## 2026-07-29 — Register groups patients sharing a file number

A household file repeated its number, its "N people" badge and its phone on
every member's row, which reads as a duplicated record when it is one file.

Rows sharing a file number now collapse into a single expandable file row: the
number stated once, the count, the names on the file, and the shared phone.
Expanding reveals the members as ordinary rows, indented under the file with a
left accent. Files matched by a search open automatically; browsing the
register keeps them shut.

Files with one patient are completely unchanged — no header row, no chevron.
Columns, sorting, search, the Cash patient chip, duplicate badges, Open buttons
and pagination are all untouched.

Because pagination can split a household across pages, a partial group says so
("3 people · 2 on this page") rather than silently showing a count that does
not match the rows beneath it.

## 2026-07-27 — Family files (several people on one file number)

- **One file number can now cover a household.** `patients.file_number` is no
  longer unique; each person stays a full record with their own identity,
  consent and audit trail. Existing numbers are unchanged — no suffixes, no
  renumbering.
- **Registering:** a "This file covers more than one person" checkbox on the
  new-patient form. After saving, the wizard reopens on the same file number for
  the next member with phone and address carried over (email is not — it
  identifies a person, not a household). Also reachable later as **Add a person
  to this file** from any patient page.
- **Typo guard:** reusing a number requires the explicit add-a-person flow
  (`onboard_patient(p_join_file => true)`). Typing an in-use number into the
  form, or retyping onto one from the edit form, is still a 409.
- **No duplicate spam within a household:** `find_possible_duplicates` gains
  `p_file_number` and skips people already on that file. Editing a member no
  longer re-opens dismissed pairs against their own household.
- **Merge:** a losing file number becomes a search alias only when nobody else
  holds it, so archiving one member never redirects searches for the family.
- **Register:** rows whose number is shared show an "N people" badge, and
  sorting by file number groups a household together (oldest member first).
  `search_patients` returns `file_member_count`.

## 2026-07-12 — UI polish (list scopes, hierarchy, mobile duplicates)

- **Doctor list scopes:** Active only · Include archived · Archived only (chips on Patients).
  Staff always see active-only. RPC `search_patients` gains `p_scope` (enforced doctor-only in SQL).
- **Archived/merged badges** on list rows; clearer empty states with next-step actions.
- **Patient page:** Details | History tabs for doctors; quieter archive danger zone; secondary audit trail.
- **Mobile duplicates:** stacked A/B layout, full-width actions, reception-friendly microcopy.
- **Copy:** shorter placeholders and page subtitles across register, duplicates, archive/restore.

## 2026-07-12 — Standalone archive and restore

- **Archive patient file** on the edit page (any active staff): soft-archives with a
  required reason. Row, consent and audit are kept; the file leaves search/lists and
  open duplicate pairs involving it are closed as “not a duplicate”.
- **Restore** (doctor only) on manually archived files that were **not** merged.
  Merged archives stay read-only and still link to the kept record.
- RPCs: `archive_patient`, `restore_patient`. Audit actions include `patient_restored`
  and manual `patient_archived` with reason metadata.

## 2026-07-12 — Hardening: no demo mode, staff API gate, audit UI

- **Removed demo mode** (`DRRG_DEMO_MODE`, `demo.ts`, and all fake-data branches).
  The app always uses Supabase.
- **API auth**: every patient API route uses `requireStaffApi()` (active
  doctor/staff profile), not only `getUser()`.
- **Proxy**: unauthenticated HTML routes redirect to `/login`; signed-in users
  hitting `/login` go to `/patients`.
- **Central PG → HTTP error mapping** in `src/lib/api/errors.ts`.
- **Typed Supabase clients** via hand-maintained `database.types.ts`.
- **Shared Zod step schemas** for onboarding + edit forms (same rules as the API).
- **Duplicate detection prefilter + indexes** migration so registration scoring
  does not scan every active patient.
- **Doctor audit trail** on the patient page (activity history from `audit_events`).
- **Profiles directory policy** so doctors can resolve other staff names on audit rows.
- Scoring remains **Postgres as source of truth**; TS `scorePair` is contract tests + banner formatting only.

## 2026-07-10 — Duplicate handling & UX fixes

### Task 1 (P0): Merge flow replaces "Delete record"

**Before:** the Possible duplicates page offered "Delete record" on each side of a pair, and the patient edit page had a "Permanently delete patient" danger zone. Deleting removed the patient row, its consent and its audit rows.

**After:** no code path hard-deletes a patient row — the `delete_patient` database function is dropped and the `DELETE /api/patients/[id]` handler is removed.

- Each side of a duplicate card now has **"Merge — keep this record"** under "View record".
- Merging (server-side, transactional `merge_patients` RPC):
  - the chosen survivor keeps its values; empty survivor fields (email, identity document) are filled from the source;
  - the source is archived (`status = archived`, `merged_into = <survivor>`) — never deleted — and excluded from all lists/searches;
  - the source's file number becomes an alias (`patient_aliases`), so searching the old number finds the survivor;
  - child records: third-party duplicate flags are repointed to the survivor; the source's consent record intentionally stays on the archived source (it is that file's signed consent and is unique per patient); audit history stays attached to the archived source, which remains queryable;
  - audit events `patient_merged` (on the survivor, with fields copied and conflicts overridden) and `patient_archived` (on the source) are written.
- A confirmation panel summarises what will happen — record kept, record archived, fields copied, conflicting values with the value that wins — with Cancel as the default action.
- "Different patients — keep both" still persists the dismissal and now also stores a fingerprint of the matched fields (see Task 2).

### Task 2 (P1): Match-confidence scoring

**Before:** all matches rendered identically ("Possible duplicate"), whether the pair shared only a phone number or a full name + date of birth.

**After:** weighted score, shared by registration-time detection (`find_possible_duplicates`), the duplicates queue (`list_duplicate_reviews`) and the patients list (`search_patients`), mirrored in `src/lib/patients/duplicate-score.ts` (unit-tested):

- identity number match (unmasked, server-side) → decisive; name +3; date of birth +3; email +2; phone +1; address +1;
- **Likely duplicate** = identity match, or name + DOB, or score ≥ 6; **Possible duplicate** = score 2–5; below 2 not flagged (phone + address alone = 2 → Possible, never Likely);
- the duplicates page orders Likely above Possible;
- "keep both" dismissals are excluded from detection; editing a patient re-opens a dismissed pair when the matched fields changed since dismissal (fingerprint comparison in `update_patient`);
- names and addresses are compared ignoring case, punctuation and diacritics (unaccent).

### Task 3 (P1): Payment status separated from data-quality flags

**Before:** the Status column showed *either* "Cash patient" *or* "Possible duplicate", and flagged rows had a full-row amber background.

**After:** the payment badge always shows; the duplicate warning is a second, tier-aware badge ("Likely duplicate" / "Possible duplicate") that links to the duplicates page scrolled to that pair. The full-row tint is replaced with a 3 px amber left accent; badge text `#a45c00` on white is 5.1:1 (WCAG AA).

### Task 4 (P2): Duplicates page clarity and accessibility

- Every comparison row states its match state in text as well as colour: `✓ Match` / `≠ Differs` / `— Missing`.
- The legend swatches are round, borderless and non-interactive (no longer look like checkboxes).
- Card banners lead with tier + reason: "Likely duplicate — same name, date of birth and address"; the redundant standalone label is gone.
- A progress line shows "N pairs to review · X likely · Y possible"; resolving a pair removes its card in place with an inline confirmation, no full reload.

### Task 5 (P2): Patients list search and sorting

- Search filters as you type (250 ms debounce, server-side query kept); Enter and the Search button apply immediately.
- File number, Patient and Date of birth columns sort (click/keyboard, visible indicator, `aria-sort`).
- "Recent patients" renamed to "Recently registered" (the query orders by creation date).
- The "Cash patients only" subtitle is removed: the system is cash-only by design (see README — clinical notes, billing and medical-aid workflows are deliberately excluded).

### Task 6 (P3): Merge-safety hardening

- Editing a record that is part of a flagged pair shows a non-blocking notice linking to the pair.
- Concurrent resolution is guarded: `merge_patients` locks both rows (stable order) and requires both to be active, so the second resolver gets a clear 409 ("already resolved by someone else"), and `resolve_duplicate` only transitions `flagged` rows. `update_patient` refuses archived records.
- Directly opening an archived record shows a read-only view with "This record was merged into <file number> on <date>" linking to the survivor.
