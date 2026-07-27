-- Identity reason: accept the coded reason OR the legacy free text.
--
-- Why: 20260728090000 made the coded reason mandatory, which means any form
-- still posting the old `no_identity_reason` free text cannot register or edit
-- a patient without a document — it fails with 22023. The register's forms do
-- post free text, so the no-document path is blocked end to end.
--
-- Rather than force the forms to change, the database now accepts either shape
-- and derives the code itself:
--
--   * a coded reason arrives  -> used as-is (note optional, except for 'other')
--   * free text arrives       -> mapped to a code, and kept verbatim in the
--                                note so no detail the user typed is lost
--   * neither arrives         -> still rejected; a reason is still required
--
-- The mapping is the same one the backfill used, now extracted into a single
-- function so the two can no longer drift apart. It stays deliberately narrow:
-- anything it cannot name confidently becomes 'other' with the original words
-- intact, because mis-coding a typo into a clinical fact is worse than leaving
-- it uncategorised. (An earlier draft matched bare 'applic' and turned the junk
-- value "Nog applicable" into "Home Affairs application in progress".)

-- --------------------------------------------------------------------------
-- 1. One mapper, shared by the backfill and the runtime path.
-- --------------------------------------------------------------------------

create function private.map_identity_reason(p_text text)
returns public.no_identity_reason_code
language sql
immutable
set search_path = ''
as $$
  select case
    when reason ~ 'newborn|new born|birth certificate'                 then 'newborn_no_certificate'
    when reason ~ '\ylost\y|stolen'                                    then 'lost_or_stolen'
    when reason ~ 'home affairs|\ydha\y|applied for|(id|passport|document) application'
                                                                       then 'home_affairs_pending'
    when reason ~ 'asylum|refugee'                                     then 'asylum_permit_pending'
    when reason ~ 'declin|refus'                                       then 'declined'
    when reason ~ 'not brought|did not bring|didnt bring|forgot|left at home|left it at home'
                                                                       then 'not_brought'
    else 'other'
  end::public.no_identity_reason_code
  from (select lower(btrim(coalesce(p_text, ''))) as reason) t;
$$;

revoke all on function private.map_identity_reason(text) from public, anon;
grant execute on function private.map_identity_reason(text) to authenticated, service_role;

-- Reasons that resolve themselves at a later visit are worth re-asking about.
-- "Declined" is not — asking again would be badgering the patient.
create function private.default_ask_identity_again(p_code public.no_identity_reason_code)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in (
    'not_brought', 'newborn_no_certificate', 'home_affairs_pending', 'asylum_permit_pending'
  );
$$;

revoke all on function private.default_ask_identity_again(public.no_identity_reason_code) from public, anon;
grant execute on function private.default_ask_identity_again(public.no_identity_reason_code) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. Onboarding accepts either shape.
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
  v_free_text text;
  v_note text;
  v_legacy_reason text;
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
    v_free_text := nullif(btrim(p_patient->>'no_identity_reason'), '');

    if v_reason_code is not null then
      -- Coded reason: the note is the caller's, and the legacy column carries
      -- a readable label so anything still reading it stays sensible.
      v_note := nullif(btrim(p_patient->>'no_identity_note'), '');
      v_legacy_reason := case
        when v_reason_code = 'other' then v_note
        else public.no_identity_reason_label(v_reason_code)
      end;
    elsif v_free_text is not null then
      -- Free text: derive the code, and keep the original words in both the
      -- note and the legacy column so the older form reads its own value back
      -- unchanged when the record is reopened.
      v_reason_code := private.map_identity_reason(v_free_text);
      v_note := v_free_text;
      v_legacy_reason := v_free_text;
    end if;

    if v_reason_code is null then
      raise exception 'an identity reason is required when no document is recorded'
        using errcode = '22023';
    end if;

    if v_reason_code = 'other' and char_length(coalesce(btrim(v_note), '')) < 3 then
      raise exception 'a note is required when the identity reason is other'
        using errcode = '22023';
    end if;

    v_ask_again := coalesce(
      (p_patient->>'ask_identity_again')::boolean,
      private.default_ask_identity_again(v_reason_code)
    );
  else
    v_reason_code := null;
    v_note := null;
    v_legacy_reason := null;
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
    v_legacy_reason,
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

-- --------------------------------------------------------------------------
-- 3. Editing accepts either shape, and does not clobber a follow-up flag the
--    older form has no control for.
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
  v_existing_code public.no_identity_reason_code;
  v_existing_ask boolean;
  v_file_number text;
  v_identity_type public.patient_identity_type;
  v_identity_number text;
  v_identity_country text;
  v_reason_code public.no_identity_reason_code;
  v_free_text text;
  v_note text;
  v_legacy_reason text;
  v_ask_again boolean;
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'patient editing requires active staff access'
      using errcode = '42501';
  end if;

  select p.status, p.file_number, p.no_identity_reason_code, p.ask_identity_again
  into v_status, v_current_file_number, v_existing_code, v_existing_ask
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
    v_free_text := nullif(btrim(p_patient->>'no_identity_reason'), '');

    if v_reason_code is not null then
      v_note := nullif(btrim(p_patient->>'no_identity_note'), '');
      v_legacy_reason := case
        when v_reason_code = 'other' then v_note
        else public.no_identity_reason_label(v_reason_code)
      end;
    elsif v_free_text is not null then
      v_reason_code := private.map_identity_reason(v_free_text);
      v_note := v_free_text;
      v_legacy_reason := v_free_text;
    end if;

    if v_reason_code is null then
      raise exception 'an identity reason is required when no document is recorded'
        using errcode = '22023';
    end if;

    if v_reason_code = 'other' and char_length(coalesce(btrim(v_note), '')) < 3 then
      raise exception 'a note is required when the identity reason is other'
        using errcode = '22023';
    end if;

    -- The older form has no follow-up control, so an edit through it must not
    -- silently flip a flag someone set deliberately. Keep the stored value
    -- while the reason is unchanged; derive a fresh default when it changes.
    v_ask_again := coalesce(
      (p_patient->>'ask_identity_again')::boolean,
      case when v_reason_code = v_existing_code then v_existing_ask else null end,
      private.default_ask_identity_again(v_reason_code)
    );
  else
    v_reason_code := null;
    v_note := null;
    v_legacy_reason := null;
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
    no_identity_reason = v_legacy_reason,
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
