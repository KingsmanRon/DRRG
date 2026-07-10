-- Merge-based duplicate resolution: duplicates are resolved by merging into a
-- surviving record and archiving the other. Hard deletes are removed entirely
-- (HPCSA record retention: clinical records must be kept, so all removal is
-- soft-delete/archive).
--
-- Schema only. The new 'merged' enum value cannot be referenced in the same
-- transaction that adds it, so every function/constraint that uses it lives in
-- the follow-up migration (20260710090500_merge_and_scoring_functions.sql).

-- 1. New resolution state for pairs resolved by a merge.
alter type public.duplicate_review_status add value if not exists 'merged';

-- 2. Patients archived by a merge point at the surviving record.
alter table public.patients
  add column merged_into uuid references public.patients(id);

alter table public.patients drop constraint patients_archive_shape_check;
alter table public.patients add constraint patients_archive_shape_check check (
  (status = 'active' and archived_at is null and merged_into is null)
  or (status = 'archived' and archived_at is not null)
);

create index patients_merged_into_idx
  on public.patients (merged_into)
  where merged_into is not null;

-- 3. The archived record's file number becomes an alias on the survivor so a
--    search for the old number still finds the patient.
create table public.patient_aliases (
  id uuid primary key default extensions.gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  alias_file_number text not null check (char_length(btrim(alias_file_number)) between 1 and 40),
  source_patient_id uuid references public.patients(id) on delete restrict,
  merged_by uuid not null references auth.users(id),
  merged_at timestamptz not null default now()
);

create index patient_aliases_file_number_idx on public.patient_aliases (lower(alias_file_number));
create index patient_aliases_patient_idx on public.patient_aliases (patient_id);

alter table public.patient_aliases enable row level security;
revoke all on public.patient_aliases from anon;
grant select on public.patient_aliases to authenticated;
grant select, insert, update on public.patient_aliases to service_role;

create policy patient_aliases_select_staff
on public.patient_aliases for select
to authenticated
using ((select private.is_active_staff()));

-- 4. Audit vocabulary for merges.
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in (
    'patient_created',
    'patient_updated',
    'patient_archived',
    'patient_deleted',
    'duplicate_reviewed',
    'duplicate_resolved',
    'patient_merged'
  ));

-- 5. "Keep both" decisions remember the state of the matched fields at
--    resolution time, so a later edit to either record can re-open the pair.
alter table public.duplicate_reviews add column resolved_fingerprint text;

-- The resolution shape check is recreated in the functions migration where the
-- 'merged' value can be referenced.
alter table public.duplicate_reviews drop constraint duplicate_reviews_resolution_shape_check;

-- 6. Hard deletes of patient records are no longer allowed through any path.
--    (patient_deletions is kept as a historical log of past deletions.)
drop function public.delete_patient(uuid, text);

-- 7. Name matching should ignore diacritics (spec: normalise case, whitespace
--    and diacritics). Query-time only, so stable is fine; it is not indexed.
create extension if not exists unaccent with schema extensions;

create or replace function private.normalise_name(value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select regexp_replace(lower(extensions.unaccent(value)), '[^a-z0-9]+', '', 'g');
$$;

-- Address matching normalisation: lowercase, strip accents, collapse
-- punctuation/whitespace runs to single spaces.
create function private.normalise_address(value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent(value)), '[^a-z0-9]+', ' ', 'g'));
$$;

revoke all on function private.normalise_address(text) from public;
grant execute on function private.normalise_address(text) to authenticated, service_role;
