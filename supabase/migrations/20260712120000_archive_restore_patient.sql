-- Standalone archive / restore for staff mistakes.
--
-- Archive (any active staff): soft-remove a file from the active register without
-- merging. Row + consent + audit retained (HPCSA). merged_into stays null so this
-- is distinguishable from a merge archive.
--
-- Restore (doctor only): reactivate an archived file that was NOT merged into
-- another patient. Merged archives stay read-only (no unmerge).

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
    'patient_merged'
  ));

-- Soft-archive an active patient (registration error, test file, etc.).
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
  update public.duplicate_reviews set
    status = 'not_duplicate',
    resolved_by = v_actor,
    resolved_at = now(),
    resolution_reason = v_reason,
    resolved_fingerprint = private.pair_match_fingerprint(patient_id, candidate_patient_id)
  where status = 'flagged'
    and (patient_id = p_id or candidate_patient_id = p_id);

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

-- Restore a manually archived (non-merged) patient. Doctors only.
create or replace function public.restore_patient(p_id uuid)
returns table (patient_id uuid, file_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.patients%rowtype;
begin
  if v_actor is null or not (select private.is_active_doctor()) then
    raise exception 'restoring a patient requires an active doctor account'
      using errcode = '42501';
  end if;

  select * into v_row from public.patients where id = p_id for update;
  if v_row.id is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'archived' then
    raise exception 'patient_not_archived: only archived records can be restored'
      using errcode = '22023';
  end if;

  if v_row.merged_into is not null then
    raise exception 'patient_merged_readonly: records archived by a merge cannot be restored; open the kept file instead'
      using errcode = '55000';
  end if;

  update public.patients set
    status = 'active',
    archived_at = null,
    merged_into = null,
    updated_by = v_actor,
    updated_at = now()
  where id = p_id;

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_actor,
    'patient_restored',
    p_id,
    jsonb_build_object('kind', 'manual')
  );

  return query select p_id, v_row.file_number;
end;
$$;

revoke all on function public.restore_patient(uuid) from public, anon;
grant execute on function public.restore_patient(uuid) to authenticated;
grant execute on function public.restore_patient(uuid) to service_role;
