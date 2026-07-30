-- Revert the coded identity reason (20260728090000).
--
-- Why this file exists: 20260728090000_identity_reason_enum.sql was deleted from
-- the repo by commit d1526bb, but it had already been applied to the database.
-- Deleting a migration file removes it from the repo, not from Postgres, so the
-- database kept the coded reason while the application code went back to the
-- free-text one. The result was that saving any patient recorded as "No identity
-- document" failed: the shape constraint required no_identity_reason_code, and
-- onboard_patient raised 22023 when the payload did not carry one. The API maps
-- that to a generic 500, so it surfaced as patients silently not saving.
--
-- A deleted migration can only be undone by a forward migration. This restores
-- the 20260727120000 shape exactly: the original identity shape constraint, and
-- onboard_patient / update_patient with their 20260727120000 bodies.
--
-- Every step is idempotent, because this file has two jobs. On the database that
-- received 20260728090000 it is a reversal. On a database built from this repo,
-- which never had that migration, it must be a no-op rather than an error — the
-- migrations folder still has to provision a working database from scratch. The
-- steps that touch the added columns are guarded on those columns existing.
--
-- Data: no reason text is lost. 20260728090000 kept the legacy
-- no_identity_reason column and kept writing it (mirroring the label for coded
-- reasons and the note for 'other'), so the prose survives the column drops.
-- Step 2 closes the one gap that would otherwise abort this migration. The
-- ask_identity_again follow-up flag is dropped and not reconstructed: the
-- pre-20260728090000 schema has nowhere to hold it, and it was derived from the
-- reason code rather than entered by staff.

-- --------------------------------------------------------------------------
-- 1. Drop the shape constraint, whichever version is installed.
-- --------------------------------------------------------------------------

alter table public.patients drop constraint if exists patients_identity_shape_check;

-- --------------------------------------------------------------------------
-- 2. Make sure every 'none' row can satisfy the restored constraint.
--
--    20260728090000 step 2 wrote a placeholder into no_identity_note for legacy
--    rows whose free-text reason was blank, and left the blank legacy column
--    alone. Those rows would fail the restored constraint's >= 3 character rule
--    and abort this migration, so populate the legacy column from the coded
--    reason first. This must run before the label function and the columns go.
-- --------------------------------------------------------------------------

do $revert$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patients'
      and column_name = 'no_identity_reason_code'
  ) then
    execute $sql$
      update public.patients set no_identity_reason = coalesce(
          nullif(btrim(coalesce(no_identity_note, '')), ''),
          public.no_identity_reason_label(no_identity_reason_code)
        )
      where identity_type = 'none'
        and char_length(btrim(coalesce(no_identity_reason, ''))) < 3
    $sql$;
  end if;
end
$revert$;

-- The restored constraint requires no_identity_reason to be null whenever a
-- document *is* on file. 20260728090000's constraint did not police the legacy
-- column for those rows, so clear any value that survived an identity change.
update public.patients set no_identity_reason = null
where identity_type <> 'none'
  and no_identity_reason is not null;

-- --------------------------------------------------------------------------
-- 3. Restore the original identity shape constraint (20260703181502).
-- --------------------------------------------------------------------------

alter table public.patients add constraint patients_identity_shape_check check (
  (
    identity_type = 'none'
    and identity_number is null
    and identity_country is null
    and char_length(btrim(coalesce(no_identity_reason, ''))) >= 3
  )
  or
  (
    identity_type = 'sa_id'
    and identity_number ~ '^[0-9]{13}$'
    and identity_country is null
    and no_identity_reason is null
  )
  or
  (
    identity_type in ('passport', 'foreign_document')
    and char_length(btrim(coalesce(identity_number, ''))) >= 3
    and identity_country ~ '^[A-Z]{2}$'
    and no_identity_reason is null
  )
);

-- --------------------------------------------------------------------------
-- 4. Restore onboard_patient and update_patient to their 20260727120000 bodies.
--    Both signatures are unchanged, so these replace in place. On a database
--    that never drifted these are byte-identical to what is already installed.
-- --------------------------------------------------------------------------

create or replace function public.onboard_patient(
  p_patient jsonb,
  p_consent jsonb,
  p_duplicate_candidate_ids uuid[] default '{}'::uuid[],
  p_duplicate_review_reason text default '',
  p_join_file boolean default false
)
returns table (patient_id uuid, file_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_patient_id uuid;
  v_file_number text;
  v_supplied_file_number text;
  v_file_exists boolean;
  v_join_file boolean := coalesce(p_join_file, false);
  v_household_size integer;
  v_candidate_id uuid;
  v_possible_ids uuid[];
  v_identity_type public.patient_identity_type;
  v_identity_number text;
  v_identity_country text;
begin
  p_duplicate_candidate_ids := coalesce(p_duplicate_candidate_ids, '{}'::uuid[]);
  p_duplicate_review_reason := coalesce(p_duplicate_review_reason, '');

  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient onboarding requires active staff access'
      using errcode = '42501';
  end if;

  if cardinality(p_duplicate_candidate_ids) > 10 then
    raise exception 'too many duplicate candidates submitted'
      using errcode = '22023';
  end if;

  v_supplied_file_number := nullif(btrim(p_patient->>'file_number'), '');
  v_file_exists := v_supplied_file_number is not null and exists (
    select 1 from public.patients p where p.file_number = v_supplied_file_number
  );

  -- Joining a household is deliberate: the caller must name an existing file.
  if v_join_file and not v_file_exists then
    raise exception 'file not found' using errcode = 'P0002';
  end if;

  -- Otherwise a number that is already in use is still a collision, so a typo
  -- cannot quietly put this patient into someone else's household.
  if v_file_exists and not v_join_file then
    raise exception 'patients_file_number_key: file number already exists'
      using errcode = '23505', constraint = 'patients_file_number_key';
  end if;

  v_identity_type := (p_patient->>'identity_type')::public.patient_identity_type;
  v_identity_number := nullif(
    case
      when v_identity_type = 'sa_id' then regexp_replace(p_patient->>'identity_number', '\s', '', 'g')
      else upper(btrim(p_patient->>'identity_number'))
    end,
    ''
  );
  v_identity_country := nullif(upper(btrim(p_patient->>'identity_country')), '');

  -- Identity stays unique per person, household or not: sharing a file number
  -- never means sharing an ID.
  if v_identity_type <> 'none' and exists (
    select 1
    from public.patients p
    where p.identity_type = v_identity_type
      and upper(btrim(p.identity_number)) = upper(v_identity_number)
      and (
        v_identity_type = 'sa_id'
        or upper(p.identity_country) = v_identity_country
      )
  ) then
    raise exception 'patients_unique_identity_idx: patient identity already exists'
      using errcode = '23505', constraint = 'patients_unique_identity_idx';
  end if;

  select coalesce(array_agg(d.id), '{}'::uuid[])
  into v_possible_ids
  from public.find_possible_duplicates(
    p_patient->>'first_names',
    p_patient->>'surname',
    (p_patient->>'date_of_birth')::date,
    p_patient->>'phone',
    10,
    p_patient->>'email',
    p_patient->>'residential_address',
    case when v_join_file then v_supplied_file_number else null end
  ) d;

  if cardinality(v_possible_ids) > 0
     and not (v_possible_ids <@ p_duplicate_candidate_ids) then
    raise exception 'soft_duplicate_review_required'
      using errcode = '22023',
            detail = 'Review every possible patient match before creating a new patient.';
  end if;

  if cardinality(p_duplicate_candidate_ids) > 0
     and not (p_duplicate_candidate_ids <@ v_possible_ids) then
    raise exception 'soft_duplicate_review_mismatch'
      using errcode = '22023',
            detail = 'Submitted duplicate candidates must match the current possible patient matches.';
  end if;

  if cardinality(p_duplicate_candidate_ids) > 0
     and char_length(btrim(coalesce(p_duplicate_review_reason, ''))) < 5 then
    raise exception 'duplicate review reason is required'
      using errcode = '22023';
  end if;

  insert into public.patients (
    file_number,
    first_names,
    surname,
    date_of_birth,
    identity_type,
    identity_number,
    identity_country,
    no_identity_reason,
    phone,
    email,
    residential_address,
    no_contact_reason,
    created_by,
    updated_by
  ) values (
    coalesce(v_supplied_file_number, public.next_patient_file_number()),
    btrim(p_patient->>'first_names'),
    btrim(p_patient->>'surname'),
    (p_patient->>'date_of_birth')::date,
    v_identity_type,
    v_identity_number,
    v_identity_country,
    nullif(btrim(p_patient->>'no_identity_reason'), ''),
    nullif(btrim(p_patient->>'phone'), ''),
    nullif(lower(btrim(p_patient->>'email')), ''),
    nullif(btrim(p_patient->>'residential_address'), ''),
    nullif(btrim(p_patient->>'no_contact_reason'), ''),
    v_actor,
    v_actor
  )
  returning patients.id, patients.file_number into v_patient_id, v_file_number;

  insert into public.patient_consents (
    patient_id,
    consent_version,
    consent_text_hash,
    signature_type,
    signature_value,
    patient_present_attestation,
    captured_by
  ) values (
    v_patient_id,
    btrim(p_consent->>'consent_version'),
    btrim(p_consent->>'consent_text_hash'),
    (p_consent->>'signature_type')::public.signature_type,
    btrim(p_consent->>'signature_value'),
    coalesce((p_consent->>'patient_present_attestation')::boolean, false),
    v_actor
  );

  foreach v_candidate_id in array p_duplicate_candidate_ids loop
    insert into public.duplicate_reviews (
      patient_id,
      candidate_patient_id,
      review_reason,
      reviewed_by
    ) values (
      v_patient_id,
      v_candidate_id,
      btrim(p_duplicate_review_reason),
      v_actor
    );
  end loop;

  select count(*)::integer into v_household_size
  from public.patients p
  where p.file_number = v_file_number and p.status = 'active';

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_created',
    v_patient_id,
    jsonb_build_object(
      'file_number', v_file_number,
      'identity_type', p_patient->>'identity_type'
    )
    || case
         when v_join_file
           then jsonb_build_object('joined_file', true, 'household_size', v_household_size)
         else '{}'::jsonb
       end
  );

  if cardinality(p_duplicate_candidate_ids) > 0 then
    insert into public.audit_events (actor_user_id, action, patient_id, metadata)
    values (
      v_actor,
      'duplicate_reviewed',
      v_patient_id,
      jsonb_build_object(
        'candidate_patient_ids', p_duplicate_candidate_ids,
        'reason', btrim(p_duplicate_review_reason)
      )
    );
  end if;

  return query select v_patient_id, v_file_number;
end;
$$;

revoke all on function public.onboard_patient(jsonb, jsonb, uuid[], text, boolean) from public, anon;
grant execute on function public.onboard_patient(jsonb, jsonb, uuid[], text, boolean) to authenticated;
grant execute on function public.onboard_patient(jsonb, jsonb, uuid[], text, boolean) to service_role;

create or replace function public.update_patient(
  p_id uuid,
  p_patient jsonb
)
returns table (patient_id uuid, file_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_status public.patient_status;
  v_current_file_number text;
  v_file_number text;
  v_identity_type public.patient_identity_type;
  v_identity_number text;
  v_identity_country text;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient editing requires active staff access'
      using errcode = '42501';
  end if;

  select p.status, p.file_number into v_status, v_current_file_number
  from public.patients p where p.id = p_id;
  if v_status is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'archived_record: this record was merged and is read only'
      using errcode = '55000';
  end if;

  v_file_number := nullif(btrim(p_patient->>'file_number'), '');
  if v_file_number is null then
    raise exception 'file number is required' using errcode = '22023';
  end if;

  -- Household members share a number, so "already in use" only bites when the
  -- number is being *changed* onto one other patients hold. Keeping your own
  -- file number is always allowed; moving between files is not done here.
  if v_file_number is distinct from v_current_file_number and exists (
    select 1 from public.patients p
    where p.file_number = v_file_number and p.id <> p_id
  ) then
    raise exception 'patients_file_number_key: file number already exists'
      using errcode = '23505', constraint = 'patients_file_number_key';
  end if;

  v_identity_type := (p_patient->>'identity_type')::public.patient_identity_type;
  v_identity_number := nullif(
    case
      when v_identity_type = 'sa_id' then regexp_replace(p_patient->>'identity_number', '\s', '', 'g')
      else upper(btrim(p_patient->>'identity_number'))
    end,
    ''
  );
  v_identity_country := nullif(upper(btrim(p_patient->>'identity_country')), '');

  if v_identity_type <> 'none' and exists (
    select 1
    from public.patients p
    where p.id <> p_id
      and p.identity_type = v_identity_type
      and upper(btrim(p.identity_number)) = upper(v_identity_number)
      and (
        v_identity_type = 'sa_id'
        or upper(p.identity_country) = v_identity_country
      )
  ) then
    raise exception 'patients_unique_identity_idx: patient identity already exists'
      using errcode = '23505', constraint = 'patients_unique_identity_idx';
  end if;

  update public.patients set
    file_number = v_file_number,
    first_names = btrim(p_patient->>'first_names'),
    surname = btrim(p_patient->>'surname'),
    date_of_birth = (p_patient->>'date_of_birth')::date,
    identity_type = v_identity_type,
    identity_number = v_identity_number,
    identity_country = v_identity_country,
    no_identity_reason = nullif(btrim(p_patient->>'no_identity_reason'), ''),
    phone = nullif(btrim(p_patient->>'phone'), ''),
    email = nullif(lower(btrim(p_patient->>'email')), ''),
    residential_address = nullif(btrim(p_patient->>'residential_address'), ''),
    no_contact_reason = nullif(btrim(p_patient->>'no_contact_reason'), ''),
    updated_by = v_actor,
    updated_at = now()
  where id = p_id
  returning patients.id, patients.file_number into patient_id, file_number;

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_updated',
    p_id,
    jsonb_build_object('file_number', v_file_number)
  );

  -- Re-open dismissed pairs whose matched fields changed with this edit.
  insert into public.duplicate_reviews (patient_id, candidate_patient_id, review_reason, reviewed_by)
  select distinct on (least(dr.patient_id::text, dr.candidate_patient_id::text),
                      greatest(dr.patient_id::text, dr.candidate_patient_id::text))
    dr.patient_id,
    dr.candidate_patient_id,
    'Patient details changed after this pair was marked as different patients.',
    v_actor
  from public.duplicate_reviews dr
  join public.patients other
    on other.id = case when dr.patient_id = p_id then dr.candidate_patient_id else dr.patient_id end
  where dr.status = 'not_duplicate'
    and (dr.patient_id = p_id or dr.candidate_patient_id = p_id)
    and other.status = 'active'
    -- Never re-open a pair that now shares a file: same household is a
    -- standing statement that these are different people.
    and other.file_number <> v_file_number
    and dr.resolved_fingerprint is not null
    and dr.resolved_fingerprint <> private.pair_match_fingerprint(dr.patient_id, dr.candidate_patient_id)
    and (select m.tier from private.duplicate_match(dr.patient_id, dr.candidate_patient_id) m) <> 'none'
    and not exists (
      select 1 from public.duplicate_reviews d2
      where d2.status = 'flagged'
        and ((d2.patient_id = dr.patient_id and d2.candidate_patient_id = dr.candidate_patient_id)
          or (d2.patient_id = dr.candidate_patient_id and d2.candidate_patient_id = dr.patient_id))
    );

  return next;
end;
$$;

revoke all on function public.update_patient(uuid, jsonb) from public, anon;
grant execute on function public.update_patient(uuid, jsonb) to authenticated;
grant execute on function public.update_patient(uuid, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- 5. Remove everything else 20260728090000 added.
--
--    Guarded as one unit: the label function's signature names the enum type, so
--    even "drop function if exists" errors on a database where that type was
--    never created. Order matters — the columns go before the type they use.
-- --------------------------------------------------------------------------

do $revert$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patients'
      and column_name = 'no_identity_reason_code'
  ) then
    execute 'drop index if exists public.patients_no_identity_reason_code_idx';
    execute 'drop index if exists public.patients_ask_identity_again_idx';
    execute 'drop function if exists public.no_identity_reason_label(public.no_identity_reason_code)';
    execute 'alter table public.patients
               drop column if exists no_identity_reason_code,
               drop column if exists no_identity_note,
               drop column if exists ask_identity_again';
    execute 'drop type if exists public.no_identity_reason_code';
  end if;
end
$revert$;

-- The column is the live reason field again, not a superseded one.
comment on column public.patients.no_identity_reason is null;

-- Let PostgREST pick up the replaced functions and the dropped columns.
notify pgrst, 'reload schema';
