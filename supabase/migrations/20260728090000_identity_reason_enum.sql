-- Identity reason: free text becomes a coded reason.
--
-- Why: `no_identity_reason` was a mandatory free-text field, and production
-- data already contains "Nog applicable" — someone hit a required field and
-- typed whatever cleared the validator. A column that exists so the practice
-- can report on undocumented patients cannot do that job while it holds prose.
--
-- The fix is not to make the free text stricter. It is to make the *reason* a
-- closed list and the free text optional, because an always-required free-text
-- box is what produced the junk in the first place.
--
-- Nothing is dropped here. The original column stays until the practice has
-- reviewed the backfill (see step 4).

-- --------------------------------------------------------------------------
-- 1. The coded reason, an optional note, and the follow-up flag.
-- --------------------------------------------------------------------------

create type public.no_identity_reason_code as enum (
  'not_brought',
  'newborn_no_certificate',
  'lost_or_stolen',
  'home_affairs_pending',
  'asylum_permit_pending',
  'declined',
  'other'
);

alter table public.patients
  add column no_identity_reason_code public.no_identity_reason_code,
  add column no_identity_note text check (char_length(no_identity_note) <= 250),
  add column ask_identity_again boolean not null default false;

-- --------------------------------------------------------------------------
-- 2. Backfill. Map what can be mapped confidently; preserve the rest verbatim.
-- --------------------------------------------------------------------------

-- Patterns are deliberately narrow. Mapping too eagerly invents a clinical
-- fact from a typo: an earlier draft matched bare 'applic', which turned the
-- junk value "Nog applicable" into "Home Affairs application in progress".
-- Under-mapping is safe — everything unmapped lands in 'other' with its
-- original words intact — so each pattern must name the reason unambiguously.
update public.patients set
  no_identity_reason_code = case
    when reason ~ 'newborn|new born|birth certificate'                 then 'newborn_no_certificate'
    when reason ~ '\ylost\y|stolen'                                    then 'lost_or_stolen'
    when reason ~ 'home affairs|\ydha\y|applied for|(id|passport|document) application'
                                                                       then 'home_affairs_pending'
    when reason ~ 'asylum|refugee'                                     then 'asylum_permit_pending'
    when reason ~ 'declin|refus'                                       then 'declined'
    when reason ~ 'not brought|did not bring|didnt bring|forgot|left at home|left it at home'
                                                                       then 'not_brought'
    else 'other'
  end::public.no_identity_reason_code,
  -- Anything without a confident mapping keeps its original words verbatim.
  -- This is what stops "Nog applicable" being silently discarded.
  no_identity_note = case
    when reason ~ 'newborn|new born|birth certificate|\ylost\y|stolen|home affairs|\ydha\y|applied for|(id|passport|document) application|asylum|refugee|declin|refus|not brought|did not bring|didnt bring|forgot|left at home|left it at home'
      then null
    else nullif(btrim(no_identity_reason), '')
  end
from (
  select id as pid, lower(btrim(coalesce(no_identity_reason, ''))) as reason
  from public.patients
  where identity_type = 'none'
) mapped
where public.patients.id = mapped.pid
  and public.patients.identity_type = 'none';

-- A legacy row whose reason was blank has nothing to preserve, but 'other'
-- requires a note, so record why the note is empty rather than failing the
-- constraint on data that predates it.
update public.patients set no_identity_note = 'No reason was recorded before this was a required field.'
where identity_type = 'none'
  and no_identity_reason_code = 'other'
  and coalesce(btrim(no_identity_note), '') = '';

-- Reasons that carry a follow-up: these resolve themselves at a later visit.
-- "Declined" does not — asking again would be badgering the patient.
update public.patients set ask_identity_again = true
where identity_type = 'none'
  and no_identity_reason_code in (
    'not_brought', 'newborn_no_certificate', 'home_affairs_pending', 'asylum_permit_pending'
  );

-- --------------------------------------------------------------------------
-- 3. Shape: the code is what is now required, not the prose.
-- --------------------------------------------------------------------------

alter table public.patients drop constraint patients_identity_shape_check;

alter table public.patients add constraint patients_identity_shape_check check (
  (
    identity_type = 'none'
    and identity_number is null
    and identity_country is null
    and no_identity_reason_code is not null
    -- A note is required only for 'other'; for every coded reason it is free
    -- to be empty, which is the whole point of the change.
    and (no_identity_reason_code <> 'other' or char_length(btrim(coalesce(no_identity_note, ''))) >= 3)
  )
  or
  (
    identity_type = 'sa_id'
    and identity_number ~ '^[0-9]{13}$'
    and identity_country is null
    and no_identity_reason_code is null
    and no_identity_note is null
    and not ask_identity_again
  )
  or
  (
    identity_type in ('passport', 'foreign_document')
    and char_length(btrim(coalesce(identity_number, ''))) >= 3
    and identity_country ~ '^[A-Z]{2}$'
    and no_identity_reason_code is null
    and no_identity_note is null
    and not ask_identity_again
  )
);

-- --------------------------------------------------------------------------
-- 4. The legacy column stays, and keeps being written.
--
--    Not dropped in this deploy: the backfill above has to be reviewed by the
--    practice against real records first. Until then both columns are
--    maintained so anything still reading the old one keeps working.
-- --------------------------------------------------------------------------

comment on column public.patients.no_identity_reason is
  'Legacy free-text reason. Superseded by no_identity_reason_code + no_identity_note. '
  'Retained until the practice has reviewed the backfill; do not read in new code.';

create index patients_no_identity_reason_code_idx
  on public.patients (no_identity_reason_code)
  where identity_type = 'none';

create index patients_ask_identity_again_idx
  on public.patients (ask_identity_again)
  where ask_identity_again;

-- --------------------------------------------------------------------------
-- 5. Human-readable labels, so SQL reporting does not re-invent the wording.
-- --------------------------------------------------------------------------

create function public.no_identity_reason_label(p_code public.no_identity_reason_code)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'not_brought' then 'Not brought to this visit'
    when 'newborn_no_certificate' then 'Newborn — birth certificate not yet issued'
    when 'lost_or_stolen' then 'Document lost or stolen'
    when 'home_affairs_pending' then 'Home Affairs application in progress'
    when 'asylum_permit_pending' then 'Asylum or refugee permit pending'
    when 'declined' then 'Patient declined to provide'
    when 'other' then 'Other'
  end;
$$;

revoke all on function public.no_identity_reason_label(public.no_identity_reason_code) from public, anon;
grant execute on function public.no_identity_reason_label(public.no_identity_reason_code) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 6. Onboarding and editing write the coded reason.
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
  v_reason_code public.no_identity_reason_code;
  v_note text;
  v_ask_again boolean;
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

  if v_join_file and not v_file_exists then
    raise exception 'file not found' using errcode = 'P0002';
  end if;

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

  if v_identity_type = 'none' then
    v_reason_code := nullif(btrim(p_patient->>'no_identity_reason_code'), '')::public.no_identity_reason_code;
    if v_reason_code is null then
      raise exception 'an identity reason is required when no document is recorded'
        using errcode = '22023';
    end if;
    v_note := nullif(btrim(p_patient->>'no_identity_note'), '');
    v_ask_again := coalesce((p_patient->>'ask_identity_again')::boolean, false);
  else
    v_reason_code := null;
    v_note := null;
    v_ask_again := false;
  end if;

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
    no_identity_reason_code,
    no_identity_note,
    ask_identity_again,
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
    -- Legacy column mirrors the coded reason while both are maintained.
    case
      when v_identity_type <> 'none' then null
      when v_reason_code = 'other' then v_note
      else public.no_identity_reason_label(v_reason_code)
    end,
    v_reason_code,
    v_note,
    v_ask_again,
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
  v_reason_code public.no_identity_reason_code;
  v_note text;
  v_ask_again boolean;
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

  if v_identity_type = 'none' then
    v_reason_code := nullif(btrim(p_patient->>'no_identity_reason_code'), '')::public.no_identity_reason_code;
    if v_reason_code is null then
      raise exception 'an identity reason is required when no document is recorded'
        using errcode = '22023';
    end if;
    v_note := nullif(btrim(p_patient->>'no_identity_note'), '');
    v_ask_again := coalesce((p_patient->>'ask_identity_again')::boolean, false);
  else
    v_reason_code := null;
    v_note := null;
    v_ask_again := false;
  end if;

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
    no_identity_reason = case
      when v_identity_type <> 'none' then null
      when v_reason_code = 'other' then v_note
      else public.no_identity_reason_label(v_reason_code)
    end,
    no_identity_reason_code = v_reason_code,
    no_identity_note = v_note,
    ask_identity_again = v_ask_again,
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

notify pgrst, 'reload schema';
