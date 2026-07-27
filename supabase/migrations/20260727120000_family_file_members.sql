-- Family files: one file number may cover several people (a household folder).
--
-- Why: cash patients are filed by household. A single paper file often holds a
-- parent and their children, so the register has to let one file number carry
-- more than one person. Each person stays a full patient row with their own
-- identity, own consent and own audit trail — only the *number* is shared.
--
-- Guard rails, because the file number is no longer unique:
--
--  * A shared number is only reachable through an explicit "add a person to
--    this file" action (p_join_file). Free-typing a number that already exists
--    into the new-patient form still fails with the same 23505 the UI already
--    handles, so a mistyped digit can never silently attach a patient to a
--    stranger's household.
--  * People on one file are a staff statement that they are different people,
--    so they are never offered as duplicate candidates for one another. Without
--    this, reception would have to write a "why is this a different patient"
--    justification for every family member they add: relatives share a phone
--    (+1) and an address (+1), which is exactly the 2-point, 2-field threshold
--    that flags a possible duplicate.
--  * Merging only turns a losing file number into an alias when no other
--    patient still holds that number, so archiving one member of a household
--    cannot redirect searches for the whole family onto the survivor.

-- --------------------------------------------------------------------------
-- 1. The file number is no longer unique on its own.
-- --------------------------------------------------------------------------

alter table public.patients drop constraint patients_file_number_key;

-- Dropping the constraint drops its index; keep a plain one for file lookups
-- (loading the members of a file, and the join-file existence checks below).
create index patients_file_number_idx on public.patients (file_number);

-- --------------------------------------------------------------------------
-- 2. Duplicate detection ignores people already on the same file.
-- --------------------------------------------------------------------------

drop function public.find_possible_duplicates(text, text, date, text, integer, text, text);

create function public.find_possible_duplicates(
  p_first_names text,
  p_surname text,
  p_date_of_birth date,
  p_phone text,
  p_limit integer default 5,
  p_email text default null,
  p_address text default null,
  p_file_number text default null
)
returns table (
  id uuid,
  file_number text,
  first_names text,
  surname text,
  date_of_birth date,
  phone text,
  identity_type public.patient_identity_type,
  identity_last4 text,
  status public.patient_status,
  match_score integer,
  match_tier text,
  match_reasons text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidate_signals as (
    select
      p.*,
      (private.normalise_name(p.first_names) = private.normalise_name(p_first_names)
        and private.normalise_name(p.surname) = private.normalise_name(p_surname)) as same_name,
      p.date_of_birth = p_date_of_birth as same_dob,
      coalesce(
        p.email is not null
          and nullif(lower(btrim(coalesce(p_email, ''))), '') = lower(p.email),
        false) as same_email,
      coalesce(
        char_length(coalesce(private.normalise_phone(p_phone), '')) > 0
          and p.phone_normalized = private.normalise_phone(p_phone),
        false) as same_phone,
      coalesce(
        nullif(btrim(coalesce(p_address, '')), '') is not null
          and private.normalise_address(p.residential_address) = private.normalise_address(p_address),
        false) as same_address
    from public.patients p
    where p.status = 'active'
      -- Household members are not candidates for one another.
      and (
        nullif(btrim(coalesce(p_file_number, '')), '') is null
        or p.file_number <> btrim(p_file_number)
      )
  ),
  candidate_scores as (
    select
      s.*,
      (case when s.same_name then 3 else 0 end
        + case when s.same_dob then 3 else 0 end
        + case when s.same_email then 2 else 0 end
        + case when s.same_phone then 1 else 0 end
        + case when s.same_address then 1 else 0 end) as points,
      (s.same_name::int + s.same_dob::int + s.same_email::int
        + s.same_phone::int + s.same_address::int) as fields_matched,
      array_remove(array[
        case when s.same_name then 'name' end,
        case when s.same_dob then 'date of birth' end,
        case when s.same_email then 'email' end,
        case when s.same_phone then 'phone' end,
        case when s.same_address then 'address' end
      ], null)::text[] as reasons
    from candidate_signals s
  )
  select
    c.id,
    c.file_number,
    c.first_names,
    c.surname,
    c.date_of_birth,
    c.phone,
    c.identity_type,
    right(c.identity_number, 4) as identity_last4,
    c.status,
    c.points,
    case
      when (c.same_name and c.same_dob) or c.points >= 6 then 'likely'
      else 'possible'
    end,
    c.reasons
  from candidate_scores c
  where c.points >= 2 and c.fields_matched >= 2
  order by
    case when (c.same_name and c.same_dob) or c.points >= 6 then 0 else 1 end,
    c.points desc,
    c.created_at desc
  limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.find_possible_duplicates(text, text, date, text, integer, text, text, text) from public, anon;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer, text, text, text) to authenticated;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- 3. Onboarding: p_join_file adds this person to an existing file number.
-- --------------------------------------------------------------------------

drop function public.onboard_patient(jsonb, jsonb, uuid[], text);

create function public.onboard_patient(
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

-- --------------------------------------------------------------------------
-- 4. Editing: a household member keeping its own number is not a collision.
-- --------------------------------------------------------------------------

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
-- 5. Merge: only alias a file number that no living patient still holds.
-- --------------------------------------------------------------------------

-- Only the alias insert changes: a losing file number may still belong to the
-- source's household, and those people must keep the number.

create or replace function public.merge_patients(
  p_survivor_id uuid,
  p_source_id uuid
)
returns table (patient_id uuid, file_number text, fields_copied text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_survivor public.patients%rowtype;
  v_source public.patients%rowtype;
  v_copied text[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'merging patients requires active staff access'
      using errcode = '42501';
  end if;

  if p_survivor_id = p_source_id then
    raise exception 'a record cannot be merged into itself' using errcode = '22023';
  end if;

  -- Lock both rows in a stable order so concurrent merges cannot deadlock.
  perform 1
  from public.patients p
  where p.id in (p_survivor_id, p_source_id)
  order by p.id
  for update;

  select * into v_survivor from public.patients where id = p_survivor_id;
  select * into v_source from public.patients where id = p_source_id;

  if v_survivor.id is null or v_source.id is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;

  if v_survivor.status <> 'active' or v_source.status <> 'active' then
    raise exception 'merge_already_resolved: one of these records has already been merged or archived'
      using errcode = '55000';
  end if;

  -- Fill empty survivor fields from the source; note conflicts we override.
  if v_survivor.email is null and v_source.email is not null then
    update public.patients set email = v_source.email, updated_by = v_actor, updated_at = now()
    where id = p_survivor_id;
    v_copied := array_append(v_copied, 'email');
  elsif v_survivor.email is not null and v_source.email is not null
    and lower(v_survivor.email) <> lower(v_source.email) then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'email', 'kept', v_survivor.email, 'discarded', v_source.email);
  end if;

  if v_survivor.identity_type = 'none' and v_source.identity_type <> 'none' then
    -- Free the unique identity slot on the source first, then move the
    -- document to the survivor.
    update public.patients set
      identity_type = 'none',
      identity_number = null,
      identity_country = null,
      no_identity_reason = 'Identity document moved to merged record ' || v_survivor.file_number,
      updated_by = v_actor,
      updated_at = now()
    where id = p_source_id;

    update public.patients set
      identity_type = v_source.identity_type,
      identity_number = v_source.identity_number,
      identity_country = v_source.identity_country,
      no_identity_reason = null,
      updated_by = v_actor,
      updated_at = now()
    where id = p_survivor_id;
    v_copied := array_append(v_copied, 'identity document');
  elsif v_survivor.identity_type <> 'none' and v_source.identity_type <> 'none'
    and not (
      v_survivor.identity_type = v_source.identity_type
      and upper(btrim(v_survivor.identity_number)) = upper(btrim(v_source.identity_number))
    ) then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'identity document',
      'kept', v_survivor.identity_type::text || ' ****' || right(v_survivor.identity_number, 4),
      'discarded', v_source.identity_type::text || ' ****' || right(v_source.identity_number, 4));
  end if;

  -- Remaining comparison fields are non-nullable, so a difference is always a
  -- conflict the survivor wins; nothing to copy.
  if private.normalise_name(v_survivor.first_names) <> private.normalise_name(v_source.first_names)
    or private.normalise_name(v_survivor.surname) <> private.normalise_name(v_source.surname) then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'name',
      'kept', v_survivor.first_names || ' ' || v_survivor.surname,
      'discarded', v_source.first_names || ' ' || v_source.surname);
  end if;
  if v_survivor.date_of_birth <> v_source.date_of_birth then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'date of birth',
      'kept', v_survivor.date_of_birth::text, 'discarded', v_source.date_of_birth::text);
  end if;

  -- Phone/address are optional: fill an empty survivor field from the source,
  -- otherwise flag a conflict only when both records carry a value.
  if v_survivor.phone is null and v_source.phone is not null then
    update public.patients set phone = v_source.phone, updated_by = v_actor, updated_at = now()
    where id = p_survivor_id;
    v_copied := array_append(v_copied, 'phone');
  elsif v_survivor.phone is not null and v_source.phone is not null
    and v_survivor.phone_normalized <> v_source.phone_normalized then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'phone', 'kept', v_survivor.phone, 'discarded', v_source.phone);
  end if;

  if v_survivor.residential_address is null and v_source.residential_address is not null then
    update public.patients set
      residential_address = v_source.residential_address, updated_by = v_actor, updated_at = now()
    where id = p_survivor_id;
    v_copied := array_append(v_copied, 'address');
  elsif v_survivor.residential_address is not null and v_source.residential_address is not null
    and private.normalise_address(v_survivor.residential_address)
      <> private.normalise_address(v_source.residential_address) then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'address',
      'kept', v_survivor.residential_address, 'discarded', v_source.residential_address);
  end if;

  -- Once the survivor has both phone and address on file, its "no contact
  -- details" note is stale — drop it so the record reads cleanly.
  update public.patients set no_contact_reason = null, updated_by = v_actor, updated_at = now()
  where id = p_survivor_id
    and no_contact_reason is not null
    and phone is not null
    and residential_address is not null;

  -- Any aliases the source already carried from earlier merges keep finding
  -- the survivor.
  update public.patient_aliases set patient_id = p_survivor_id
  where patient_aliases.patient_id = p_source_id;

  -- The source's own file number becomes an alias only when no one else still
  -- holds it. If the source shared a household file, those members keep the
  -- number and it must keep resolving to them, not to the survivor.
  insert into public.patient_aliases (patient_id, alias_file_number, source_patient_id, merged_by)
  select p_survivor_id, v_source.file_number, p_source_id, v_actor
  where not exists (
    select 1 from public.patients p
    where p.file_number = v_source.file_number and p.id <> p_source_id
  );

  -- The source's consent record intentionally stays attached to the source:
  -- it is the consent that patient signed for that file, the survivor has its
  -- own, and patient_consents.patient_id is unique. The archived source row
  -- keeps it queryable for audit.

  -- Move unresolved third-party duplicate flags from the source onto the
  -- survivor where that does not self-pair or duplicate an existing flag.
  update public.duplicate_reviews dr set patient_id = p_survivor_id
  where dr.status = 'flagged'
    and dr.patient_id = p_source_id
    and dr.candidate_patient_id <> p_survivor_id
    and not exists (
      select 1 from public.duplicate_reviews d2
      where d2.status = 'flagged'
        and ((d2.patient_id = p_survivor_id and d2.candidate_patient_id = dr.candidate_patient_id)
          or (d2.candidate_patient_id = p_survivor_id and d2.patient_id = dr.candidate_patient_id))
    );

  update public.duplicate_reviews dr set candidate_patient_id = p_survivor_id
  where dr.status = 'flagged'
    and dr.candidate_patient_id = p_source_id
    and dr.patient_id <> p_survivor_id
    and not exists (
      select 1 from public.duplicate_reviews d2
      where d2.status = 'flagged'
        and ((d2.patient_id = p_survivor_id and d2.candidate_patient_id = dr.patient_id)
          or (d2.candidate_patient_id = p_survivor_id and d2.patient_id = dr.patient_id))
    );

  -- Resolve every remaining flag that still involves the source, including the
  -- survivor/source pair itself.
  update public.duplicate_reviews set
    status = 'merged',
    resolved_by = v_actor,
    resolved_at = now(),
    resolution_reason = 'Merged ' || v_source.file_number || ' into ' || v_survivor.file_number
  where duplicate_reviews.status = 'flagged'
    and (duplicate_reviews.patient_id = p_source_id
      or duplicate_reviews.candidate_patient_id = p_source_id);

  -- Archive the source (soft delete; audit history stays attached to it).
  update public.patients set
    status = 'archived',
    archived_at = now(),
    merged_into = p_survivor_id,
    updated_by = v_actor,
    updated_at = now()
  where id = p_source_id;

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_merged',
    p_survivor_id,
    jsonb_build_object(
      'source_patient_id', p_source_id,
      'source_file_number', v_source.file_number,
      'fields_copied', to_jsonb(v_copied),
      'conflicts_overridden', v_conflicts
    )
  );

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_archived',
    p_source_id,
    jsonb_build_object(
      'merged_into_patient_id', p_survivor_id,
      'merged_into_file_number', v_survivor.file_number
    )
  );

  return query select v_survivor.id, v_survivor.file_number, v_copied;
end;
$$;

revoke all on function public.merge_patients(uuid, uuid) from public, anon;
grant execute on function public.merge_patients(uuid, uuid) to authenticated;
grant execute on function public.merge_patients(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- 6. Search: carry how many people share each row's file number.
-- --------------------------------------------------------------------------

create or replace function public.search_patients(
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0,
  p_sort text default 'recent',
  p_dir text default 'desc',
  p_scope text default 'active'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as (
    select case
      when private.is_active_doctor()
        and lower(btrim(coalesce(p_scope, 'active'))) in ('include_archived', 'archived_only')
        then lower(btrim(p_scope))
      else 'active'
    end as mode
  ),
  matched as materialized (
    select p.*
    from public.patients p
    cross join scope s
    where (
        (s.mode = 'active' and p.status = 'active')
        or (s.mode = 'include_archived')
        or (s.mode = 'archived_only' and p.status = 'archived')
      )
      and (
        btrim(coalesce(p_query, '')) = ''
        or position(lower(btrim(p_query)) in lower(p.file_number)) > 0
        or position(lower(btrim(p_query)) in lower(p.first_names || ' ' || p.surname)) > 0
        or position(lower(btrim(p_query)) in lower(p.surname || ' ' || p.first_names)) > 0
        or position(upper(btrim(p_query)) in upper(coalesce(p.identity_number, ''))) > 0
        or exists (
          select 1
          from public.patient_aliases pa
          where pa.patient_id = p.id
            and position(lower(btrim(p_query)) in lower(pa.alias_file_number)) > 0
        )
        or (
          char_length(private.normalise_phone(p_query)) > 0
          and (
            position(private.normalise_phone(p_query) in p.phone_normalized) > 0
            or (
              regexp_replace(p_query, '[^0-9]', '', 'g') like '0%'
              and char_length(regexp_replace(p_query, '[^0-9]', '', 'g')) >= 5
              and position(substring(regexp_replace(p_query, '[^0-9]', '', 'g') from 2) in p.phone_normalized) > 0
            )
          )
        )
        or (
          p.residential_address is not null
          and char_length(private.normalise_address(p_query)) >= 3
          and position(private.normalise_address(p_query) in private.normalise_address(p.residential_address)) > 0
        )
      )
  ),
  paged as (
    select
      p.id,
      p.file_number,
      p.first_names,
      p.surname,
      p.date_of_birth,
      p.identity_type,
      right(p.identity_number, 4) as identity_last4,
      p.phone,
      p.status,
      (p.merged_into is not null) as is_merged,
      (
        select count(*)::integer
        from public.patients f
        where f.file_number = p.file_number and f.status = 'active'
      ) as file_member_count,
      case
        when p.status = 'active' then (
          select case
            when bool_or(m.tier = 'likely') then 'likely'
            when bool_or(m.tier = 'possible') then 'possible'
          end
          from public.duplicate_reviews dr
          join public.patients o
            on o.id = case when dr.patient_id = p.id then dr.candidate_patient_id else dr.patient_id end
          cross join lateral private.duplicate_match(p.id, o.id) m
          where dr.status = 'flagged'
            and (dr.patient_id = p.id or dr.candidate_patient_id = p.id)
            and o.status = 'active'
        )
        else null
      end as duplicate_tier,
      row_number() over (
        order by
          -- Household members sort together under their shared number, oldest
          -- member first, so a family reads as one block in the register.
          case when p_sort = 'file_number' and p_dir = 'asc' then lower(p.file_number) end asc,
          case when p_sort = 'file_number' and p_dir <> 'asc' then lower(p.file_number) end desc,
          case when p_sort = 'file_number' then p.date_of_birth end asc,
          case when p_sort = 'name' and p_dir = 'asc' then lower(p.surname || ' ' || p.first_names) end asc,
          case when p_sort = 'name' and p_dir <> 'asc' then lower(p.surname || ' ' || p.first_names) end desc,
          case when p_sort = 'date_of_birth' and p_dir = 'asc' then p.date_of_birth end asc,
          case when p_sort = 'date_of_birth' and p_dir <> 'asc' then p.date_of_birth end desc,
          p.created_at desc
      ) as sort_order
    from matched p
    order by sort_order
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total_count', (select count(*) from matched),
    'patients', coalesce(
      (
        select jsonb_agg(to_jsonb(paged) - 'sort_order' order by paged.sort_order)
        from paged
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.search_patients(text, integer, integer, text, text, text) from public, anon;
grant execute on function public.search_patients(text, integer, integer, text, text, text) to authenticated;
grant execute on function public.search_patients(text, integer, integer, text, text, text) to service_role;

-- Let PostgREST pick up the recreated functions.
notify pgrst, 'reload schema';
