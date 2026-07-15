-- Allow staff to sign in with a practice number as an alternative to email.
-- The number is stored per profile; the login API resolves it to the account
-- email server-side (service role only), so it is never exposed pre-auth.

alter table public.profiles
  add column practice_number text
  check (practice_number ~ '^[0-9]{4,12}$');

create unique index profiles_practice_number_key
  on public.profiles (practice_number)
  where practice_number is not null;
