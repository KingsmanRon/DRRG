-- Assertions for the SQL tests. Every helper raises on failure, so a test file
-- stops at the first bad assertion and the runner reports the file as failed.
-- Passing assertions print "ok - <name>", which the runner counts.

create schema if not exists test;

create or replace function test.ok(p_name text, p_condition boolean)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) then
    raise notice 'ok - %', p_name;
  else
    raise exception 'not ok - %', p_name;
  end if;
end;
$$;

create or replace function test.eq(p_name text, p_got anyelement, p_want anyelement)
returns void
language plpgsql
as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'ok - %', p_name;
  else
    raise exception 'not ok - % (got %, wanted %)',
      p_name, coalesce(p_got::text, '<null>'), coalesce(p_want::text, '<null>');
  end if;
end;
$$;

-- Asserts that a statement fails, and that it fails for the expected reason.
create or replace function test.raises(p_name text, p_sql text, p_pattern text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~ p_pattern then
      raise notice 'ok - %', p_name;
      return;
    end if;
    raise exception 'not ok - % (failed with "%", expected a message matching "%")',
      p_name, sqlerrm, p_pattern;
  end;
  raise exception 'not ok - % (the statement succeeded; it should have failed)', p_name;
end;
$$;

-- Signs the session in as an active staff member, the way the app's RPCs
-- expect: auth.uid() resolves through the shim to this user.
create or replace function test.sign_in(p_name text default 'Test Staff', p_role public.staff_role default 'doctor')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, v_id::text || '@test.local');
  insert into public.profiles (user_id, display_name, role, active)
  values (v_id, p_name, p_role, true);
  perform set_config('test.user_id', v_id::text, false);
  return v_id;
end;
$$;

-- The consent payload every onboarding call has to carry.
create or replace function test.consent(p_signature text default 'Test Patient')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'consent_version', '1.0',
    'consent_text_hash', repeat('a', 64),
    'signature_type', 'typed_name',
    'signature_value', p_signature,
    'patient_present_attestation', true
  );
$$;
