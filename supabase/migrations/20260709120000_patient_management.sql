-- Patient management: editable file numbers, patient edit, permanent delete,
-- and after-the-fact duplicate resolution ("keep both / not a duplicate").

-- 1. File numbers may now be supplied by the clinic (cash patients already have
--    their own numbers). Keep them bounded; uniqueness is already enforced by
--    the patients_file_number_key unique constraint.
alter table public.patients
  add constraint patients_file_number_shape_check
  check (char_length(btrim(file_number)) between 1 and 40);

-- 2. Duplicate reviews gain a resolution state so a flagged pair can be marked
--    "not a duplicate" and stop warning, while keeping who/when/why.
create type public.duplicate_review_status as enum ('flagged', 'not_duplicate');

alter table public.duplicate_reviews
  add column status public.duplicate_review_status not null default 'flagged',
  add column resolved_by uuid references auth.users(id),
  add column resolved_at timestamptz,
  add column resolution_reason text
    check (resolution_reason is null or char_length(btrim(resolution_reason)) between 5 and 500),
  add constraint duplicate_reviews_resolution_shape_check check (
    (status = 'flagged' and resolved_by is null and resolved_at is null and resolution_reason is null)
    or
    (status = 'not_duplicate' and resolved_by is not null and resolved_at is not null and resolution_reason is not null)
  );

-- 3. Audit + deletion trail. Permanent deletion removes the patient and its
--    audit rows, so deletions are recorded in a standalone log with no FK to
--    patients (it must outlive the patient).
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in (
    'patient_created',
    'patient_updated',
    'patient_archived',
    'patient_deleted',
    'duplicate_reviewed',
    'duplicate_resolved'
  ));

create table public.patient_deletions (
  id bigint generated always as identity primary key,
  patient_id uuid not null,
  file_number text not null,
  reason text,
  patient_snapshot jsonb not null default '{}'::jsonb,
  deleted_by uuid not null references auth.users(id),
  deleted_at timestamptz not null default now()
);

alter table public.patient_deletions enable row level security;
revoke all on public.patient_deletions from anon;
grant select on public.patient_deletions to authenticated;
grant select on public.patient_deletions to service_role;

create policy patient_deletions_select_doctor
on public.patient_deletions for select
to authenticated
using ((select private.is_active_doctor()));

-- 4. Search: a patient is only a "possible duplicate" while it still has an
--    unresolved (flagged) review on either side.
create or replace function public.search_patients(
  p_query text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with matched as materialized (
    select p.*
    from public.patients p
    where btrim(coalesce(p_query, '')) = ''
      or position(lower(btrim(p_query)) in lower(p.file_number)) > 0
      or position(lower(btrim(p_query)) in lower(p.first_names || ' ' || p.surname)) > 0
      or position(lower(btrim(p_query)) in lower(p.surname || ' ' || p.first_names)) > 0
      or position(upper(btrim(p_query)) in upper(coalesce(p.identity_number, ''))) > 0
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
      exists (
        select 1
        from public.duplicate_reviews dr
        where dr.status = 'flagged'
          and (dr.patient_id = p.id or dr.candidate_patient_id = p.id)
      ) as possible_duplicate,
      p.created_at
    from matched p
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total_count', (select count(*) from matched),
    'patients', coalesce(
      (
        select jsonb_agg(to_jsonb(paged) - 'created_at' order by paged.created_at desc)
        from paged
      ),
      '[]'::jsonb
    )
  );
$$;

-- 5. onboard_patient: accept an optional clinic-supplied file number.
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
    10
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
    btrim(p_patient->>'phone'),
    nullif(lower(btrim(p_patient->>'email')), ''),
    btrim(p_patient->>'residential_address'),
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

-- 6. update_patient: edit a patient's details (including file number). Re-checks
--    identity and file-number uniqueness, excluding the patient itself.
create function public.update_patient(
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
  v_file_number text;
  v_identity_type public.patient_identity_type;
  v_identity_number text;
  v_identity_country text;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient editing requires active staff access'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.patients p where p.id = p_id) then
    raise exception 'patient not found' using errcode = 'P0002';
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
    phone = btrim(p_patient->>'phone'),
    email = nullif(lower(btrim(p_patient->>'email')), ''),
    residential_address = btrim(p_patient->>'residential_address'),
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

  return next;
end;
$$;

revoke all on function public.update_patient(uuid, jsonb) from public, anon;
grant execute on function public.update_patient(uuid, jsonb) to authenticated;
grant execute on function public.update_patient(uuid, jsonb) to service_role;

-- 7. delete_patient: permanent removal of a patient and all of its dependent
--    records, logged to patient_deletions for the trail.
create function public.delete_patient(
  p_id uuid,
  p_reason text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_file_number text;
  v_snapshot jsonb;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient deletion requires active staff access'
      using errcode = '42501';
  end if;

  select p.file_number, to_jsonb(p) into v_file_number, v_snapshot
  from public.patients p
  where p.id = p_id;

  if v_file_number is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;

  insert into public.patient_deletions (patient_id, file_number, reason, patient_snapshot, deleted_by)
  values (p_id, v_file_number, nullif(btrim(p_reason), ''), v_snapshot, v_actor);

  delete from public.duplicate_reviews
    where patient_id = p_id or candidate_patient_id = p_id;
  delete from public.patient_consents where patient_id = p_id;
  delete from public.audit_events where patient_id = p_id;
  delete from public.patients where id = p_id;

  return v_file_number;
end;
$$;

revoke all on function public.delete_patient(uuid, text) from public, anon;
grant execute on function public.delete_patient(uuid, text) to authenticated;
grant execute on function public.delete_patient(uuid, text) to service_role;

-- 8. resolve_duplicate: mark a flagged pair as "not a duplicate" (keep both).
create function public.resolve_duplicate(
  p_patient_id uuid,
  p_candidate_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_updated integer;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'resolving duplicates requires active staff access'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a resolution reason is required' using errcode = '22023';
  end if;

  update public.duplicate_reviews set
    status = 'not_duplicate',
    resolved_by = v_actor,
    resolved_at = now(),
    resolution_reason = btrim(p_reason)
  where status = 'flagged'
    and (
      (patient_id = p_patient_id and candidate_patient_id = p_candidate_id)
      or (patient_id = p_candidate_id and candidate_patient_id = p_patient_id)
    );

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'no flagged duplicate review found for this pair'
      using errcode = 'P0002';
  end if;

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'duplicate_resolved',
    p_patient_id,
    jsonb_build_object('candidate_patient_id', p_candidate_id, 'reason', btrim(p_reason))
  );

  return v_updated;
end;
$$;

revoke all on function public.resolve_duplicate(uuid, uuid, text) from public, anon;
grant execute on function public.resolve_duplicate(uuid, uuid, text) to authenticated;
grant execute on function public.resolve_duplicate(uuid, uuid, text) to service_role;

-- 9. list_duplicate_reviews: flagged pairs with a masked summary of each side,
--    for the reception duplicate-resolution queue.
create function public.list_duplicate_reviews()
returns table (
  review_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  patient jsonb,
  candidate jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    dr.id,
    dr.reviewed_at,
    dr.review_reason,
    jsonb_build_object(
      'id', p.id,
      'file_number', p.file_number,
      'first_names', p.first_names,
      'surname', p.surname,
      'date_of_birth', p.date_of_birth,
      'identity_type', p.identity_type,
      'identity_last4', right(p.identity_number, 4),
      'phone', p.phone,
      'email', p.email,
      'residential_address', p.residential_address,
      'status', p.status
    ),
    jsonb_build_object(
      'id', c.id,
      'file_number', c.file_number,
      'first_names', c.first_names,
      'surname', c.surname,
      'date_of_birth', c.date_of_birth,
      'identity_type', c.identity_type,
      'identity_last4', right(c.identity_number, 4),
      'phone', c.phone,
      'email', c.email,
      'residential_address', c.residential_address,
      'status', c.status
    )
  from public.duplicate_reviews dr
  join public.patients p on p.id = dr.patient_id
  join public.patients c on c.id = dr.candidate_patient_id
  where dr.status = 'flagged'
  order by dr.reviewed_at desc;
$$;

revoke all on function public.list_duplicate_reviews() from public, anon;
grant execute on function public.list_duplicate_reviews() to authenticated;
grant execute on function public.list_duplicate_reviews() to service_role;
