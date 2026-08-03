-- Postal code becomes its own field, so two records of the same address match.
--
-- Why: duplicate detection compares the residential address as one exact
-- normalised string. Reception types the postal code into the address box when
-- they have it and leaves it out when they do not, so the same household reads
-- as two different addresses:
--
--     1410 Zone 13 Sebokeng 1983   vs   1410 Zone 13 Sebokeng
--
-- The register already holds one such pair (files 2014 and 1450, both
-- "Boitumelo Phale", dates of birth one day apart). Name matched, address did
-- not, so the pair scored 3 across one field and was never flagged.
--
-- Two changes fix that, and they are deliberately separate:
--
--   1. The postal code moves to public.patients.postal_code, and is removed
--      from the addresses it can be lifted out of safely (below).
--   2. Address *matching* compares the address without any trailing postal
--      code, so a code still typed into the address box does not hide a match.
--      This is comparison-only: nothing rewrites what staff typed.
--
-- Postal code itself is never a duplicate signal. Thousands of DRRG patients
-- share 1983; a delivery area does not identify a person. It is stored,
-- displayed and carried through merges, and it scores zero.

-- --------------------------------------------------------------------------
-- 1. The column, optional, and validated as a South African postal code.
-- --------------------------------------------------------------------------

alter table public.patients add column postal_code text;

-- Text, not an integer: a postal code is an identifier, not a quantity, and
-- 0083 must not become 83. NULL is valid — the field is optional and the
-- contact-details rule (phone + address, or a recorded reason) is unchanged.
alter table public.patients add constraint patients_postal_code_check check (
  postal_code is null
  or postal_code ~ '^[0-9]{4}$'
);

comment on column public.patients.postal_code is
  'Optional four-digit South African postal code, stored apart from '
  'residential_address. Never contributes to duplicate matching: a postal code '
  'is a delivery area shared by thousands of patients.';

-- --------------------------------------------------------------------------
-- 2. One rule for "does this address end in a postal code", used by the
--    backfill and by address matching so the two can never disagree.
-- --------------------------------------------------------------------------

-- Returns the postal code only when lifting it out is unambiguous:
--
--   * the trimmed address ends with a standalone four-digit token or line
--     (preceded by whitespace, a comma or a semicolon — so 17234 is not read
--     as ...7234), and
--   * something is left behind, and what is left contains a letter.
--
-- The letter test is what protects stand numbers. "17234" and "71087" are
-- whole addresses in parts of the register, and "1410 1983" cannot be told
-- apart from a stand number followed by another number. Under-extracting is
-- safe — the address keeps working and matching still ignores the trailing
-- code — while over-extracting silently destroys part of an address.
-- (btrim is not used for the trimming here: it strips spaces only, and these
-- addresses are multiline, so the code is usually behind a newline.)
create function private.postal_code_from_address(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with candidate as (
    select regexp_replace(coalesce(value, ''), '^\s+|\s+$', '', 'g') as address
  ),
  split as (
    select
      address,
      regexp_replace(regexp_replace(address, '[\s,;]*[0-9]{4}$', ''), '\s+$', '') as remainder
    from candidate
  )
  select right(s.address, 4)
  from split s
  where s.address ~ '(^|[\s,;])[0-9]{4}$'
    and s.remainder <> ''
    and s.remainder ~ '[A-Za-z]';
$$;

-- The same address with that trailing code removed. Anything the rule above
-- does not recognise is returned exactly as entered: no re-capitalisation, no
-- re-punctuation, no collapsing of the line breaks staff typed.
create function private.address_without_postal_code(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when private.postal_code_from_address(value) is null then value
    else regexp_replace(
           regexp_replace(
             regexp_replace(value, '^\s+|\s+$', '', 'g'),
             '[\s,;]*[0-9]{4}$', ''),
           '\s+$', '')
  end;
$$;

-- The value addresses are compared on. private.normalise_address is unchanged
-- and still does the lowercasing, accent stripping and punctuation collapsing;
-- this decides *what* is normalised, and then drops the separators altogether.
--
-- Separators go because reception types the same place as "Zone 13" and
-- "Zone13", "No. 50" and "No 50", and one file per spelling is exactly the
-- failure this change is about. Names have been compared this way since the
-- beginning (private.normalise_name); addresses now match it. The postal code
-- is never appended: it is not part of the address for matching purposes.
create function private.address_match_key(value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select replace(private.normalise_address(private.address_without_postal_code(value)), ' ', '');
$$;

comment on function private.normalise_address(text) is
  'Comparison form of an address: lowercase, unaccented, punctuation and '
  'whitespace collapsed. Postal code is a separate column and is never '
  'appended here. Duplicate matching uses private.address_match_key.';

revoke all on function private.postal_code_from_address(text) from public, anon;
revoke all on function private.address_without_postal_code(text) from public, anon;
revoke all on function private.address_match_key(text) from public, anon;
grant execute on function private.postal_code_from_address(text) to authenticated, service_role;
grant execute on function private.address_without_postal_code(text) to authenticated, service_role;
grant execute on function private.address_match_key(text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. Backfill: lift the codes that can be lifted, and remember which rows
--    were touched (step 6 needs them).
-- --------------------------------------------------------------------------

create temporary table postal_code_backfill (
  id uuid primary key,
  address_before text,
  address_after text,
  postal_code text
);

insert into postal_code_backfill (id, address_before, address_after, postal_code)
select
  p.id,
  p.residential_address,
  private.address_without_postal_code(p.residential_address),
  private.postal_code_from_address(p.residential_address)
from public.patients p
where p.postal_code is null
  and p.residential_address is not null
  and private.postal_code_from_address(p.residential_address) is not null
  -- Never leave behind an address the table would reject.
  and char_length(btrim(private.address_without_postal_code(p.residential_address))) between 3 and 500;

update public.patients p set
  postal_code = b.postal_code,
  residential_address = b.address_after
from postal_code_backfill b
where p.id = b.id;

-- Re-running the extraction is a no-op: the stored address no longer ends in a
-- standalone four-digit token, and the insert above skips rows that already
-- have a postal code.

-- --------------------------------------------------------------------------
-- 4. Matching: compare addresses without their postal code.
-- --------------------------------------------------------------------------

-- Also fixes a NULL leak in fields_matched. phone_normalized and
-- residential_address became nullable when contact details were made optional,
-- so `a.phone_normalized = b.phone_normalized` was NULL rather than false for
-- any patient with no phone (or no address) — which made fields_matched NULL,
-- and `points >= 2 and fields_matched >= 2` unknown. A pair involving a patient
-- with no phone could therefore never reach the "possible" tier. Every
-- comparison below is now coalesced to false, as find_possible_duplicates
-- already did. Weights and thresholds are unchanged.
create or replace function private.duplicate_match(a_id uuid, b_id uuid)
returns table (score integer, tier text, reasons text[], identity_match boolean)
language sql
stable
set search_path = ''
as $$
  with sides as (
    select
      coalesce(
        a.identity_type <> 'none' and b.identity_type <> 'none'
          and a.identity_type = b.identity_type
          and upper(btrim(a.identity_number)) = upper(btrim(b.identity_number))
          and (a.identity_type = 'sa_id' or upper(a.identity_country) = upper(b.identity_country)),
        false) as same_identity,
      coalesce(
        private.normalise_name(a.first_names) = private.normalise_name(b.first_names)
          and private.normalise_name(a.surname) = private.normalise_name(b.surname),
        false) as same_name,
      coalesce(a.date_of_birth = b.date_of_birth, false) as same_dob,
      coalesce(a.email is not null and b.email is not null and lower(a.email) = lower(b.email), false) as same_email,
      coalesce(a.phone_normalized = b.phone_normalized, false) as same_phone,
      -- Address content only. The postal code column is not compared: it is a
      -- delivery area, not a patient identifier, and adding it as a signal
      -- would score every household in Sebokeng against every other.
      coalesce(
        private.address_match_key(a.residential_address) = private.address_match_key(b.residential_address),
        false) as same_address
    from public.patients a, public.patients b
    where a.id = a_id and b.id = b_id
  ),
  scored as (
    select
      s.*,
      (case when s.same_name then 3 else 0 end
        + case when s.same_dob then 3 else 0 end
        + case when s.same_email then 2 else 0 end
        + case when s.same_phone then 1 else 0 end
        + case when s.same_address then 1 else 0 end) as points,
      (s.same_name::int + s.same_dob::int + s.same_email::int
        + s.same_phone::int + s.same_address::int) as fields_matched
    from sides s
  )
  select
    s.points,
    case
      when s.same_identity or (s.same_name and s.same_dob) or s.points >= 6 then 'likely'
      when s.points >= 2 and s.fields_matched >= 2 then 'possible'
      else 'none'
    end,
    array_remove(array[
      case when s.same_identity then 'identity number' end,
      case when s.same_name then 'name' end,
      case when s.same_dob then 'date of birth' end,
      case when s.same_email then 'email' end,
      case when s.same_phone then 'phone' end,
      case when s.same_address then 'address' end
    ], null)::text[],
    s.same_identity
  from scored s;
$$;

-- private.patient_match_fingerprint is deliberately NOT changed here. It
-- fingerprints the stored fields so a later edit can re-open a dismissed pair,
-- and the postal *column* is not one of them. Re-keying its address to
-- address_match_key would change the fingerprint of every patient with a
-- multi-word address — every "keep both" decision in the register would then
-- re-open the next time anyone edited either file. The addresses this migration
-- actually rewrote are handled precisely, in step 7.

-- --------------------------------------------------------------------------
-- 5. Registration-time detection: same scoring, postal code carried for
--    display only.
-- --------------------------------------------------------------------------

drop function public.find_possible_duplicates(text, text, date, text, integer, text, text, text);

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
  residential_address text,
  postal_code text,
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
      -- No p_postal_code parameter by design: the postal code is not a signal,
      -- so there is nothing for the caller to send.
      coalesce(
        nullif(btrim(coalesce(p_address, '')), '') is not null
          and private.address_match_key(p.residential_address) = private.address_match_key(p_address),
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
    c.residential_address,
    c.postal_code,
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

-- The duplicate queue shows the postal code beside the address so staff can see
-- that "1410 Zone 13 Sebokeng / 1983" and "1410 Zone 13 Sebokeng" are the same
-- place, and that only one of the two records has the code on file.
drop function public.list_duplicate_reviews();

create function public.list_duplicate_reviews()
returns table (
  review_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  match_score integer,
  match_tier text,
  match_reasons text[],
  identity_match boolean,
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
    m.score,
    m.tier,
    m.reasons,
    m.identity_match,
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
      'postal_code', p.postal_code,
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
      'postal_code', c.postal_code,
      'status', c.status
    )
  from public.duplicate_reviews dr
  join public.patients p on p.id = dr.patient_id
  join public.patients c on c.id = dr.candidate_patient_id
  cross join lateral private.duplicate_match(dr.patient_id, dr.candidate_patient_id) m
  where dr.status = 'flagged'
    and p.status = 'active'
    and c.status = 'active'
  order by
    case m.tier when 'likely' then 0 when 'possible' then 1 else 2 end,
    m.score desc,
    dr.reviewed_at desc;
$$;

revoke all on function public.list_duplicate_reviews() from public, anon;
grant execute on function public.list_duplicate_reviews() to authenticated;
grant execute on function public.list_duplicate_reviews() to service_role;

-- --------------------------------------------------------------------------
-- 6. Writes: onboarding, editing and merging carry the postal code.
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
    -- Clearing the field on the edit form removes the postal code.
    postal_code = nullif(btrim(p_patient->>'postal_code'), ''),
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

-- Merge: the postal code follows the same rule as email, phone and address —
-- fill an empty survivor field from the source, otherwise the survivor wins and
-- the difference is recorded in the audit event. Without this a merge would
-- discard the only postal code the practice holds for that patient.
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
    and private.address_match_key(v_survivor.residential_address)
      <> private.address_match_key(v_source.residential_address) then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'address',
      'kept', v_survivor.residential_address, 'discarded', v_source.residential_address);
  end if;

  if v_survivor.postal_code is null and v_source.postal_code is not null then
    update public.patients set
      postal_code = v_source.postal_code, updated_by = v_actor, updated_at = now()
    where id = p_survivor_id;
    v_copied := array_append(v_copied, 'postal code');
  elsif v_survivor.postal_code is not null and v_source.postal_code is not null
    and v_survivor.postal_code <> v_source.postal_code then
    v_conflicts := v_conflicts || jsonb_build_object(
      'field', 'postal code',
      'kept', v_survivor.postal_code, 'discarded', v_source.postal_code);
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
-- 7. Keep "not a duplicate" decisions dismissed.
--
--    A keep-both resolution stores a fingerprint of the matched fields so a
--    later edit re-opens the pair. Splitting an address is not such an edit —
--    the place did not change — but it does change the stored text, so every
--    dismissed pair touching a backfilled record would otherwise re-open the
--    next time anyone edited it. Re-baseline exactly the rows this migration
--    rewrote; nothing else is touched, so genuine drift still re-opens.
-- --------------------------------------------------------------------------

update public.duplicate_reviews dr set
  resolved_fingerprint = private.pair_match_fingerprint(dr.patient_id, dr.candidate_patient_id)
where dr.status = 'not_duplicate'
  and dr.resolved_fingerprint is not null
  and (
    dr.patient_id in (select b.id from postal_code_backfill b)
    or dr.candidate_patient_id in (select b.id from postal_code_backfill b)
  );

-- --------------------------------------------------------------------------
-- 8. What the backfill did, for the deployment log.
-- --------------------------------------------------------------------------

do $$
declare
  v_rows integer;
  v_empty integer;
begin
  select count(*) into v_rows from postal_code_backfill;
  select count(*) into v_empty from postal_code_backfill
  where char_length(btrim(coalesce(address_after, ''))) < 3;

  raise notice 'postal code backfill: % address(es) split', v_rows;

  if v_empty > 0 then
    raise exception 'postal code backfill would have emptied % address(es)', v_empty;
  end if;
end;
$$;

drop table postal_code_backfill;

notify pgrst, 'reload schema';
