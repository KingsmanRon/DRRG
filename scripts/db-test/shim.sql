-- Minimum Supabase platform surface the migrations depend on, so the real
-- migration files can be applied to a plain PostgreSQL database and asserted
-- against without Docker or a Supabase project.
--
-- Only what the migrations actually reference is shimmed: the three API roles,
-- auth.users, auth.uid(), and the extensions schema. Nothing here is deployed —
-- on Supabase these objects already exist and this file is never applied.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Supabase exposes gen_random_uuid() from the extensions schema. Since
-- PostgreSQL 13 it is a builtin, so pgcrypto no longer installs it there.
create or replace function extensions.gen_random_uuid()
returns uuid
language sql
volatile
as $$ select pg_catalog.gen_random_uuid(); $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text
);

-- GoTrue reads the signed JWT; tests set the actor with
--   select set_config('test.user_id', '<uuid>', false);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('test.user_id', true), '')::uuid; $$;

grant execute on function auth.uid() to anon, authenticated, service_role;
