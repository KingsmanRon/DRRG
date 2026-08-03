-- Post-deployment data operation, run once, by hand, after
-- 20260803120000_postal_code_separation.sql is live.
--
-- Purpose: put files 2014 and 1450 ("Boitumelo Phale") in front of staff. From
-- now on the matcher finds this pair by itself, but only at the moment a record
-- is registered or edited — nothing rescans the register — so the pair that
-- prompted this change has to be queued explicitly.
--
-- This is a *review*, not a merge. Nothing is combined, nothing is archived,
-- and no date of birth is corrected. Staff open Possible duplicates and decide:
--
--   * Are both files the same person?
--   * Is the date of birth 9 or 10 September 1995?
--   * Which phone number is current?
--   * Which consent and audit history has to stay attached?
--   * Should 1450 be merged into 2014?
--
-- File 2014 is the likely survivor — it is older and more complete — but that
-- is the practice's call, and merging is done through the app so it is audited.
--
-- Why this is not in a migration: reviewed_by must be a real staff member, and
-- staff user ids differ per environment. Set the email below to the account
-- doing the review, then run the whole file:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/post-deploy/20260803_flag_boitumelo_phale_review.sql
--
-- Re-running it is safe: it inserts nothing if the pair is already queued or
-- has already been resolved.

\set reviewer_email 'CHANGE-ME@drrg.co.za'

-- psql does not substitute variables inside a dollar-quoted body, so the email
-- is handed to the block through a session setting.
select set_config('drrg.reviewer_email', :'reviewer_email', false);

do $$
declare
  v_reviewer_email text := btrim(current_setting('drrg.reviewer_email', true));
  v_reviewer uuid;
  v_older uuid;
  v_newer uuid;
  v_tier text;
  v_score integer;
begin
  select u.id into v_reviewer
  from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(u.email) = lower(v_reviewer_email)
    and p.active
    and p.role in ('doctor', 'staff');

  if v_reviewer is null then
    raise exception 'No active staff account for "%". Set :reviewer_email to a real reviewer.', v_reviewer_email;
  end if;

  select id into v_older from public.patients
  where file_number = '2014' and status = 'active'
    and private.normalise_name(first_names) = private.normalise_name('Boitumelo')
    and private.normalise_name(surname) = private.normalise_name('Phale');

  select id into v_newer from public.patients
  where file_number = '1450' and status = 'active'
    and private.normalise_name(first_names) = private.normalise_name('Boitumelo')
    and private.normalise_name(surname) = private.normalise_name('Phale');

  if v_older is null or v_newer is null then
    raise exception 'Both active files were not found (2014: %, 1450: %). Nothing was changed.',
      coalesce(v_older::text, 'missing'), coalesce(v_newer::text, 'missing');
  end if;

  -- Only queue what the matcher itself considers a match, so this cannot be
  -- used to force an unrelated pair in front of staff.
  select m.tier, m.score into v_tier, v_score
  from private.duplicate_match(v_newer, v_older) m;

  if v_tier = 'none' then
    raise exception 'These files no longer match (score %). Nothing was changed.', v_score;
  end if;

  if exists (
    select 1 from public.duplicate_reviews dr
    where (dr.patient_id = v_newer and dr.candidate_patient_id = v_older)
       or (dr.patient_id = v_older and dr.candidate_patient_id = v_newer)
  ) then
    raise notice 'This pair already has a review row; nothing to do.';
    return;
  end if;

  insert into public.duplicate_reviews (patient_id, candidate_patient_id, review_reason, reviewed_by)
  values (
    v_newer,
    v_older,
    'Flagged for review after postal code separation: same name and address, '
    || 'dates of birth one day apart. Confirm whether these are one person.',
    v_reviewer
  );

  insert into public.audit_events (actor_user_id, action, patient_id, metadata)
  values (
    v_reviewer,
    'duplicate_reviewed',
    v_newer,
    jsonb_build_object(
      'candidate_patient_ids', array[v_older],
      'reason', 'Queued by post-deploy script 20260803_flag_boitumelo_phale_review.sql',
      'match_tier', v_tier,
      'match_score', v_score
    )
  );

  raise notice 'Files 2014 and 1450 queued for review (% duplicate, score %).', v_tier, v_score;
end;
$$;
