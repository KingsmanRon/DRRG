-- Household consent: one signature covers the file.
--
-- Why: adding the second and third person to a family file walked the same
-- four-step registration as a stranger — including a consent step that asked
-- reception to type a signature and tick "the patient is present" for someone
-- standing in the same room as the person who just signed. Reception described
-- it as registering two or three patients for what is one household visit.
--
-- The shortcut people reach for is to auto-fill the consent step and hide it.
-- That would write a record saying the patient signed when they did not, which
-- is worse than the friction: `patient_consents` is append-only, follows the
-- record through a merge, and is the only evidence the practice has. It is also
-- wrong in the most common case on a family file — a child cannot sign their
-- own consent, so typing their name as a signature invents a legal act.
--
-- So the consent is inherited rather than invented. The person who opened the
-- file signed once; when someone is added to that file, that signature is
-- promoted to cover the household and the new member gets a consent row that
-- records *whose* signature covers them (`granted_by_patient_id`). Reception
-- sees no consent fields at all. Every row still says exactly what happened.
--
-- Nothing is backfilled. Files that already carry one signature per person hold
-- real signatures; rewriting them as inherited would erase evidence that exists.
-- They promote themselves the next time someone is added to the file.

-- --------------------------------------------------------------------------
-- 1. Scope, and who granted an inherited consent.
-- --------------------------------------------------------------------------

create type public.consent_scope as enum ('individual', 'household');

alter table public.patient_consents
  add column scope public.consent_scope not null default 'individual',
  -- The patient whose signature covers this row. Null means this row *is* the
  -- signature. Never deleted (patients never are), so the trail cannot dangle.
  add column granted_by_patient_id uuid references public.patients(id) on delete restrict,
  add column scope_changed_at timestamptz,
  add column scope_changed_by uuid references auth.users(id);

-- The original constraint made "the patient is present" true for every consent
-- row. An inherited row asserts no such thing: nobody attested to the new
-- member being present, and pretending otherwise is the fabrication this
-- migration exists to avoid. A signed row still has to attest.
alter table public.patient_consents
  drop constraint if exists patient_consents_patient_present_attestation_check;

alter table public.patient_consents
  add constraint patient_consents_attestation_check
    check (patient_present_attestation or granted_by_patient_id is not null);

-- A consent cannot be granted by the person it covers, and an inherited consent
-- is household scope by definition.
alter table public.patient_consents
  add constraint patient_consents_granted_by_other_check
    check (granted_by_patient_id is null or granted_by_patient_id <> patient_id);

alter table public.patient_consents
  add constraint patient_consents_granted_scope_check
    check (granted_by_patient_id is null or scope = 'household');

create index patient_consents_granted_by_idx
  on public.patient_consents (granted_by_patient_id)
  where granted_by_patient_id is not null;

comment on column public.patient_consents.granted_by_patient_id is
  'The patient who signed the consent this row inherits. Null when this row is the signature itself. When set, signature_value is that person''s signature, not this patient''s.';

-- --------------------------------------------------------------------------
-- 2. Promoting a file's consent is an audited event.
-- --------------------------------------------------------------------------

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check
  check (action in (
    'patient_created',
    'patient_updated',
    'patient_archived',
    'patient_restored',
    'patient_deleted',
    'duplicate_reviewed',
    'duplicate_resolved',
    'patient_merged',
    'consent_scope_promoted'
  ));

-- --------------------------------------------------------------------------
-- 3. The file's signed consent.
-- --------------------------------------------------------------------------

-- The row a new member inherits from: the earliest consent on the file that is
-- a signature in its own right (not itself inherited). Active members are
-- preferred, but an archived signatory still counts — the consent it captured
-- happened, and refusing to find it would block reception from adding anyone to
-- a file whose original member was archived.
create function private.file_signed_consent(p_file_number text)
returns table (
  consent_id uuid,
  patient_id uuid,
  consent_version text,
  consent_text_hash text,
  signature_type public.signature_type,
  signature_value text,
  scope public.consent_scope
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.patient_id,
    c.consent_version,
    c.consent_text_hash,
    c.signature_type,
    c.signature_value,
    c.scope
  from public.patient_consents c
  join public.patients p on p.id = c.patient_id
  where p.file_number = p_file_number
    and c.granted_by_patient_id is null
  order by (p.status = 'active') desc, p.created_at asc
  limit 1;
$$;

-- Only onboard_patient needs it, and that runs as the owner. Staff read consent
-- through the table's own policy, not through this.
revoke all on function private.file_signed_consent(text) from public;

-- --------------------------------------------------------------------------
-- 4. onboard_patient: consent is inherited when joining a file.
-- --------------------------------------------------------------------------
--
-- Unchanged apart from the consent block. When p_join_file is true the
-- p_consent argument is ignored — the file's signature is what covers the new
-- person — so the API no longer collects one on that path.
create or replace function public.onboard_patient(
  p_patient jsonb,
  p_consent jsonb default null,
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
  v_file_consent record;
  -- Held separately from the record: plpgsql resolves every field reference in
  -- an expression, including ones in a CASE branch it will not take, so the
  -- audit metadata below cannot read the record on the non-joining path.
  v_consent_grantor uuid;
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

  -- Resolve the consent before writing anything: a file with no signature on
  -- record cannot pass one on, and that has to fail before a patient row exists.
  if v_join_file then
    select * into v_file_consent from private.file_signed_consent(v_supplied_file_number);
    if not found then
      raise exception 'file_consent_missing'
        using errcode = '22023',
              detail = 'This file has no signed consent to extend to another person.';
    end if;
    v_consent_grantor := v_file_consent.patient_id;
  elsif p_consent is null then
    raise exception 'consent is required to register a patient'
      using errcode = '22023';
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

  -- The postal code is not passed to the duplicate search: it is not a signal.
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
    postal_code,
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
    -- Blank from the form means "not recorded", not "empty string".
    nullif(btrim(p_patient->>'postal_code'), ''),
    nullif(btrim(p_patient->>'no_contact_reason'), ''),
    v_actor,
    v_actor
  )
  returning patients.id, patients.file_number into v_patient_id, v_file_number;

  if v_join_file then
    -- The file's signature now covers a household. Promoting it is a staff
    -- action, recorded as one: the signatory did not sign again.
    if v_file_consent.scope = 'individual' then
      update public.patient_consents
      set scope = 'household',
          scope_changed_at = now(),
          scope_changed_by = v_actor
      where id = v_file_consent.consent_id;

      insert into public.audit_events (actor_user_id, action, patient_id, metadata)
      values (
        v_actor,
        'consent_scope_promoted',
        v_consent_grantor,
        jsonb_build_object(
          'file_number', v_file_number,
          'promoted_for_patient_id', v_patient_id
        )
      );
    end if;

    -- signature_value is the signatory's, and granted_by_patient_id says so.
    -- patient_present_attestation is false: nobody attested to this person.
    insert into public.patient_consents (
      patient_id,
      consent_version,
      consent_text_hash,
      signature_type,
      signature_value,
      patient_present_attestation,
      scope,
      granted_by_patient_id,
      captured_by
    ) values (
      v_patient_id,
      v_file_consent.consent_version,
      v_file_consent.consent_text_hash,
      v_file_consent.signature_type,
      v_file_consent.signature_value,
      false,
      'household',
      v_consent_grantor,
      v_actor
    );
  else
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
  end if;

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
           then jsonb_build_object(
             'joined_file', true,
             'household_size', v_household_size,
             'consent_granted_by_patient_id', v_consent_grantor
           )
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
