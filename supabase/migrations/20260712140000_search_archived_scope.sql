-- Doctor-only patient list scopes: include archived, or archived only.
-- Non-doctors always get active-only results regardless of p_scope.
-- Rows include is_merged so the UI can badge "Merged" vs "Archived".

drop function if exists public.search_patients(text, integer, integer, text, text);

create function public.search_patients(
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
