-- Scale fix for registration-time duplicate detection: prefilter candidates
-- before scoring, and add partial indexes for the common match keys.
-- Scoring weights/tiers are unchanged (still private.duplicate_match).
-- Also: staff directory read so doctor audit trail can show actor names.
--
-- Note: do not index on private.normalise_name(...) — Postgres requires index
-- expressions to use IMMUTABLE builtins (or functions proven immutable). Name
-- prefilter is served by lower(surname)/lower(first_names) plus the existing
-- patients_name_dob_idx.

-- Active staff may read other staff profiles (display name / role) for audit UI.
-- Own-row policy already exists; policies OR together under RLS.
drop policy if exists profiles_select_active_staff_directory on public.profiles;
create policy profiles_select_active_staff_directory
on public.profiles for select
to authenticated
using ((select private.is_active_staff()) and active);

create index if not exists patients_active_dob_idx
  on public.patients (date_of_birth)
  where status = 'active';

create index if not exists patients_active_phone_idx
  on public.patients (phone_normalized)
  where status = 'active';

-- Index the email column directly (equality after lower() in the query still
-- benefits from this for small staff datasets; avoids collation/immutability
-- edge cases with lower() expression indexes on some Postgres builds).
create index if not exists patients_active_email_idx
  on public.patients (email)
  where status = 'active' and email is not null;

create index if not exists patients_active_name_idx
  on public.patients (lower(surname), lower(first_names))
  where status = 'active';

create or replace function public.find_possible_duplicates(
  p_first_names text,
  p_surname text,
  p_date_of_birth date,
  p_phone text,
  p_limit integer default 5,
  p_email text default null,
  p_address text default null
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
  with input as (
    select
      private.normalise_name(p_first_names) as n_first,
      private.normalise_name(p_surname) as n_surname,
      p_date_of_birth as dob,
      private.normalise_phone(p_phone) as n_phone,
      nullif(lower(btrim(coalesce(p_email, ''))), '') as n_email,
      case
        when nullif(btrim(coalesce(p_address, '')), '') is null then null
        else private.normalise_address(p_address)
      end as n_address
  ),
  -- Prefilter: only rows that share at least one scorable signal with the input.
  -- Full-table score is O(n); this keeps candidate set small as the register grows.
  candidate_signals as (
    select
      p.*,
      (private.normalise_name(p.first_names) = i.n_first
        and private.normalise_name(p.surname) = i.n_surname) as same_name,
      p.date_of_birth = i.dob as same_dob,
      coalesce(
        p.email is not null and i.n_email is not null and lower(p.email) = i.n_email,
        false) as same_email,
      coalesce(
        char_length(coalesce(i.n_phone, '')) > 0
          and p.phone_normalized = i.n_phone,
        false) as same_phone,
      coalesce(
        i.n_address is not null
          and private.normalise_address(p.residential_address) = i.n_address,
        false) as same_address
    from public.patients p
    cross join input i
    where p.status = 'active'
      and (
        p.date_of_birth = i.dob
        or (char_length(coalesce(i.n_phone, '')) > 0 and p.phone_normalized = i.n_phone)
        or (i.n_email is not null and p.email is not null and lower(p.email) = i.n_email)
        or (
          private.normalise_name(p.first_names) = i.n_first
          and private.normalise_name(p.surname) = i.n_surname
        )
        or (
          i.n_address is not null
          and private.normalise_address(p.residential_address) = i.n_address
        )
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

revoke all on function public.find_possible_duplicates(text, text, date, text, integer, text, text) from public, anon;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer, text, text) to authenticated;
grant execute on function public.find_possible_duplicates(text, text, date, text, integer, text, text) to service_role;
