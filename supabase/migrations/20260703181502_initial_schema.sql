create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.staff_role as enum ('doctor', 'staff');
create type public.patient_identity_type as enum (
  'sa_id',
  'passport',
  'foreign_document',
  'none'
);
create type public.patient_status as enum ('active', 'archived');
create type public.signature_type as enum ('typed_name', 'drawn_signature');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = (select auth.uid())
      and active
      and role in ('doctor', 'staff')
  );
$$;

create function private.is_active_doctor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = (select auth.uid())
      and active
      and role = 'doctor'
  );
$$;

revoke all on function private.is_active_staff() from public;
revoke all on function private.is_active_doctor() from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.is_active_doctor() to authenticated;

create function private.normalise_phone(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(value, '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^0[0-9]{9}$' then '27' || substring(digits from 2)
    else digits
  end
  from cleaned;
$$;

revoke all on function private.normalise_phone(text) from public;
grant execute on function private.normalise_phone(text) to authenticated, service_role;

create sequence public.patient_file_number_seq start with 1;

create function public.next_patient_file_number()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select 'DRRG' || lpad(nextval('public.patient_file_number_seq')::text, 8, '0');
$$;

revoke all on function public.next_patient_file_number() from public, anon;
grant execute on function public.next_patient_file_number() to authenticated;
grant usage, select on sequence public.patient_file_number_seq to authenticated;

create table public.patients (
  id uuid primary key default extensions.gen_random_uuid(),
  file_number text not null default public.next_patient_file_number() unique,
  first_names text not null check (char_length(btrim(first_names)) between 1 and 120),
  surname text not null check (char_length(btrim(surname)) between 1 and 120),
  date_of_birth date not null check (date_of_birth <= current_date),
  identity_type public.patient_identity_type not null,
  identity_number text check (char_length(identity_number) <= 80),
  identity_country text,
  no_identity_reason text check (char_length(no_identity_reason) <= 250),
  phone text not null check (char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15),
  phone_normalized text generated always as (private.normalise_phone(phone)) stored,
  email text check (char_length(email) <= 254),
  residential_address text not null check (char_length(btrim(residential_address)) between 3 and 500),
  status public.patient_status not null default 'active',
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_identity_shape_check check (
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
  ),
  constraint patients_archive_shape_check check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create unique index patients_unique_identity_idx
on public.patients (
  identity_type,
  (case when identity_type = 'sa_id' then '' else upper(identity_country) end),
  upper(btrim(identity_number))
)
where identity_type <> 'none';

create index patients_name_dob_idx
on public.patients (lower(surname), lower(first_names), date_of_birth);

create index patients_phone_idx on public.patients (phone_normalized);
create index patients_recent_idx on public.patients (created_at desc);

create table public.patient_consents (
  id uuid primary key default extensions.gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete restrict,
  consent_version text not null check (char_length(btrim(consent_version)) between 1 and 40),
  consent_text_hash text not null check (consent_text_hash ~ '^[a-f0-9]{64}$'),
  signature_type public.signature_type not null,
  signature_value text not null check (char_length(btrim(signature_value)) between 2 and 500),
  patient_present_attestation boolean not null check (patient_present_attestation),
  captured_by uuid not null references auth.users(id),
  captured_at timestamptz not null default now()
);

create table public.duplicate_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  candidate_patient_id uuid not null references public.patients(id) on delete restrict,
  review_reason text not null check (char_length(btrim(review_reason)) between 5 and 500),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  check (patient_id <> candidate_patient_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('patient_created', 'patient_updated', 'patient_archived', 'duplicate_reviewed')),
  patient_id uuid not null references public.patients(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function private.normalise_name(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(lower(btrim(value)), '[^a-z0-9]+', '', 'g');
$$;

create function public.find_possible_duplicates(
  p_first_names text,
  p_surname text,
  p_date_of_birth date,
  p_phone text,
  p_limit integer default 5
)
returns table (
  id uuid,
  file_number text,
  first_names text,
  surname text,
  date_of_birth date,
  phone text,
  identity_type public.patient_identity_type,
  identity_number text,
  status public.patient_status,
  match_score integer,
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
      private.normalise_name(p.first_names) = private.normalise_name(p_first_names) as same_first_names,
      private.normalise_name(p.surname) = private.normalise_name(p_surname) as same_surname,
      p.date_of_birth = p_date_of_birth as same_date_of_birth,
      p.phone_normalized = private.normalise_phone(p_phone) as same_phone
    from public.patients p
  ),
  candidate_scores as (
    select
      s.*,
      case
        when s.same_first_names and s.same_surname and s.same_date_of_birth and s.same_phone then 100
        when s.same_first_names and s.same_surname and s.same_date_of_birth then 85
        when s.same_first_names and s.same_surname and s.same_phone then 80
        when s.same_surname and s.same_date_of_birth and s.same_phone then 75
        when s.same_surname and s.same_phone then 65
        when s.same_surname and s.same_date_of_birth then 55
        when s.same_phone then 55
        else 0
      end::integer as score,
      array_remove(array[
        case when s.same_first_names and s.same_surname then 'same_name' end,
        case when s.same_date_of_birth then 'same_date_of_birth' end,
        case when s.same_phone then 'same_phone' end
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
    c.identity_number,
    c.status,
    c.score,
    c.reasons
  from candidate_scores c
  where c.score >= 55
  order by c.score desc, c.created_at desc
  limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.find_possible_duplicates(text, text, date, text, integer) from public, anon;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer) to authenticated;

create function public.search_patients(
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
      p.identity_number,
      p.phone,
      p.status,
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

revoke all on function public.search_patients(text, integer, integer) from public, anon;
grant execute on function public.search_patients(text, integer, integer) to authenticated;

alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_consents enable row level security;
alter table public.duplicate_reviews enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using (user_id = (select auth.uid()));

create policy patients_select_staff
on public.patients for select
to authenticated
using ((select private.is_active_staff()));

create policy consents_select_staff
on public.patient_consents for select
to authenticated
using ((select private.is_active_staff()));

create policy duplicate_reviews_select_staff
on public.duplicate_reviews for select
to authenticated
using ((select private.is_active_staff()));

create policy audit_events_select_doctor
on public.audit_events for select
to authenticated
using ((select private.is_active_doctor()));

revoke all on public.profiles from anon;
revoke all on public.patients from anon;
revoke all on public.patient_consents from anon;
revoke all on public.duplicate_reviews from anon;
revoke all on public.audit_events from anon;

grant select on public.profiles to authenticated;
grant select on public.patients to authenticated;
grant select on public.patient_consents to authenticated;
grant select on public.duplicate_reviews to authenticated;
grant select on public.audit_events to authenticated;

grant select, insert, update on public.profiles to service_role;
grant select, insert, update on public.patients to service_role;
grant select, insert on public.patient_consents to service_role;
grant select, insert on public.duplicate_reviews to service_role;
grant select, insert on public.audit_events to service_role;
grant usage, select on sequence public.patient_file_number_seq to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;
grant execute on function public.next_patient_file_number() to service_role;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer) to service_role;
grant execute on function public.search_patients(text, integer, integer) to service_role;

create function public.onboard_patient(
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
