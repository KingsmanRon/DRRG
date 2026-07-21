-- Reason-gated optional contact details, and address-searchable patients.
--
-- Why: some treated patients genuinely have no phone or fixed address, but the
-- register required both, so their file could not be saved. This mirrors the
-- existing "No identity document" pattern: contact details become optional only
-- when a short reason is recorded (no_contact_reason). It also makes the
-- residential address searchable so staff can find people who gave different
-- names at the same address (address alone is still only a weak +1 duplicate
-- signal, so genuinely different people at one address are kept as separate
-- files — nothing here changes that).

-- --------------------------------------------------------------------------
-- 1. Schema: nullable contact fields + reason column + shape constraint.
-- --------------------------------------------------------------------------

alter table public.patients alter column phone drop not null;
alter table public.patients alter column residential_address drop not null;

alter table public.patients
  add column no_contact_reason text check (char_length(no_contact_reason) <= 250);

-- Relax the inline column checks so a NULL (absent) value is allowed; a present
-- value must still be well formed.
alter table public.patients drop constraint patients_phone_check;
alter table public.patients add constraint patients_phone_check check (
  phone is null
  or char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
);

alter table public.patients drop constraint patients_residential_address_check;
alter table public.patients add constraint patients_residential_address_check check (
  residential_address is null
  or char_length(btrim(residential_address)) between 3 and 500
);

-- Either the patient has phone AND address on file, or a reason for their
-- absence is recorded. The reason column is the source of truth for "no contact
-- details on file"; when it is null, both contact fields are mandatory.
alter table public.patients add constraint patients_contact_shape_check check (
  case
    when no_contact_reason is null
      then phone is not null and residential_address is not null
    else char_length(btrim(no_contact_reason)) >= 3
  end
);

-- --------------------------------------------------------------------------
-- 2. Onboarding: store blank contact fields as NULL and persist the reason.
-- --------------------------------------------------------------------------

create or replace function public.onboard_patient(
  p_patient jsonb,
  p_consent jsonb,
  p_duplicate_candidate_ids uuid[] default '{}'::uuid[],
  p_duplicate_review_reason text default ''
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
  if v_supplied_file_number is not null and exists (
    select 1 from public.patients p where p.file_number = v_supplied_file_number
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
    p_patient->>'residential_address'
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

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_created',
    v_patient_id,
    jsonb_build_object(
      'file_number', v_file_number,
      'identity_type', p_patient->>'identity_type'
    )
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

revoke all on function public.onboard_patient(jsonb, jsonb, uuid[], text) from public, anon;
grant execute on function public.onboard_patient(jsonb, jsonb, uuid[], text) to authenticated;
grant execute on function public.onboard_patient(jsonb, jsonb, uuid[], text) to service_role;

-- --------------------------------------------------------------------------
-- 3. Editing: same NULL handling for contact fields and the reason.
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
  v_file_number text;
  v_identity_type public.patient_identity_type;
  v_identity_number text;
  v_identity_country text;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient editing requires active staff access'
      using errcode = '42501';
  end if;

  select p.status into v_status from public.patients p where p.id = p_id;
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
  if exists (
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
-- 4. Merge: fill a missing survivor phone/address from the source, and drop a
--    now-stale "no contact details" note once the survivor has both on file.
-- --------------------------------------------------------------------------

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

  -- Phone/address are now optional: fill an empty survivor field from the
  -- source, otherwise flag a conflict only when both records carry a value.
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

  -- The source's file number (and any aliases it already carried from earlier
  -- merges) keep finding the survivor.
  update public.patient_aliases set patient_id = p_survivor_id
  where patient_aliases.patient_id = p_source_id;

  insert into public.patient_aliases (patient_id, alias_file_number, source_patient_id, merged_by)
  values (p_survivor_id, v_source.file_number, p_source_id, v_actor);

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
-- 5. Search: match on residential address (normalised substring), so patients
--    who gave different names at the same address surface together.
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
          case when p_sort = 'file_number' and p_dir = 'asc' then lower(p.file_number) end asc,
          case when p_sort = 'file_number' and p_dir <> 'asc' then lower(p.file_number) end desc,
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
