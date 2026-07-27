# Changelog

## 2026-07-28 — Register rebuild, and a coded identity reason

**Register (`/patients`)**
- **The file is now the container.** Results group by file number and render as
  expandable cards, so `2014` and its shared phone appear **once** with the
  three patients nested inside, instead of repeating on every row — a repeated
  identifier reads as a duplicate record.
- Files with one matching patient render flat, no expander; the file number
  moves inline into the meta line (`3 Mar 1974 · File 1877`).
- File headers are real `<button>`s with `aria-expanded`/`aria-controls`, so
  Enter and Space work and screen readers get the state. Chevron rotation
  respects `prefers-reduced-motion`.
- Search is a single 38px input with an inline clear; the separate Search and
  Clear buttons are gone. Scope pills become `Active · All · Archived`.
- Result summary (`6 patients across 3 files`) moves above the results and is
  announced with `aria-live`.
- **Removed:** the Status column and the constant `Cash patient` chip, the
  per-row Open button, the repeated phone column, the `3 people` badge, and
  pagination (with it, the sortable column headers and the tablet page-size
  cookie).

**Patient page**
- One navigation system: `Back to patients` is gone, and Details/History move
  under the patient name as a left-aligned underlined tab row.
- Header shows `29 Dec 1994 · 083 927 4199`; `Save changes` is the page's
  primary action and sits in the header.
- The file-membership block moves **below** the patient's own details, lists
  every member including the one being viewed (marked `viewing now`), and is
  collapsed by default.
- Section header bands removed in favour of plain headings; fields are a
  responsive `minmax(200px, 1fr)` grid.
- Red asterisks removed everywhere — optional fields are marked instead.

**Identity reason is now a closed list** (the data-quality fix)
- `no_identity_reason` free text becomes `no_identity_reason_code` (7 values),
  an **optional** `no_identity_note`, and an `ask_identity_again` flag that
  defaults on for reasons that resolve themselves later.
- A note is required only for `other`. An always-required free-text box is what
  produced `Nog applicable` in the first place.
- Backfill maps only unambiguous values and preserves everything else verbatim
  in the note under `other`. The legacy column is **kept and still written**
  until the practice has reviewed the backfill.

**Shared formatting**
- `formatDate` (`29 Dec 1994`), `formatPhone` (`083 927 4199`) and initials now
  live in `src/lib/format.ts` and are used by both screens, which previously
  formatted the same date differently.

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
