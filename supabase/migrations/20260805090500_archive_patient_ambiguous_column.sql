-- Archiving a patient has never worked.
--
-- `archive_patient` returns `table (patient_id uuid, file_number text)`, so
-- `patient_id` is a variable inside the function body. The statement that drops
-- the file from the duplicate queue then referred to `duplicate_reviews`'s
-- column of the same name without qualifying it:
--
--   where status = 'flagged' and (patient_id = p_id or ...)
--
-- plpgsql refuses to guess between a variable and a column, so every call
-- raised 42702 "column reference patient_id is ambiguous" before anything was
-- written. The function is reached only from the archive button, and no test
-- called it, so the failure sat behind a generic "The patient could not be
-- archived." Nothing was ever half-archived: the error is raised on the first
-- statement of the transaction.
--
-- Found while testing household consent — that suite archives a patient to
-- check a file's signatory can be archived without blocking the file.
--
-- The body below is the original with the three column references qualified.

create or replace function public.archive_patient(
  p_id uuid,
  p_reason text
)
returns table (patient_id uuid, file_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.patients%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null or not (select private.is_active_staff()) then
    raise exception 'archiving a patient requires active staff access'
      using errcode = '42501';
  end if;

  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'an archive reason between 5 and 500 characters is required'
      using errcode = '22023';
  end if;

  select * into v_row from public.patients where id = p_id for update;
  if v_row.id is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'active' then
    raise exception 'patient_already_archived: this record is already archived'
      using errcode = '55000';
  end if;

  -- Drop this file from the open duplicate queue (pair is no longer actionable).
  -- Every column is qualified with the alias: `patient_id` on its own is the
  -- function's own output parameter.
  update public.duplicate_reviews d set
    status = 'not_duplicate',
    resolved_by = v_actor,
    resolved_at = now(),
    resolution_reason = v_reason,
    resolved_fingerprint = private.pair_match_fingerprint(d.patient_id, d.candidate_patient_id)
  where d.status = 'flagged'
    and (d.patient_id = p_id or d.candidate_patient_id = p_id);

  update public.patients set
    status = 'archived',
    archived_at = now(),
    merged_into = null,
    updated_by = v_actor,
    updated_at = now()
  where id = p_id;

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_archived',
    p_id,
    jsonb_build_object(
      'reason', v_reason,
      'kind', 'manual'
    )
  );

  return query select p_id, v_row.file_number;
end;
$$;

revoke all on function public.archive_patient(uuid, text) from public, anon;
grant execute on function public.archive_patient(uuid, text) to authenticated;
grant execute on function public.archive_patient(uuid, text) to service_role;
