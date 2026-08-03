-- Rows as they look *before* postal code separation, so the migration's
-- backfill can be asserted on. Addresses here are the shapes the real register
-- holds: multiline with a trailing code, multiline without one, a bare stand
-- number, and the Boitumelo Phale file the change exists for.

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000101', 'fixtures@drrg.test');

insert into public.profiles (user_id, display_name, role, active)
values ('00000000-0000-4000-8000-000000000101', 'Fixture Loader', 'staff', true);

insert into public.patients (
  file_number, first_names, surname, date_of_birth,
  identity_type, no_identity_reason_code,
  phone, email, residential_address,
  created_by, updated_by
)
values
  -- Trailing code on its own line: extracted.
  ('BF-0001', 'Trailing', 'Line', '1990-01-01', 'none', 'not_brought',
   '082 000 0001', null, E'1410\nZone 13\nSebokeng\n1983',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- No code at all: left exactly as it is.
  ('BF-0002', 'No', 'Code', '1990-01-02', 'none', 'not_brought',
   '082 000 0002', null, E'1410\nZone 13\nSebokeng',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- Five digits, no separator: a stand number, not a postal code.
  ('BF-0003', 'Stand', 'Number', '1990-01-03', 'none', 'not_brought',
   '082 000 0003', null, '17234',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- Extraction would leave nothing behind, so nothing is extracted.
  ('BF-0004', 'Four', 'Digits', '1990-01-04', 'none', 'not_brought',
   '082 000 0004', null, '1983',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- Street address ending in a code: first two lines survive.
  ('BF-0005', 'Frikkie', 'Meyer', '1990-01-05', 'none', 'not_brought',
   '082 000 0005', null, E'No 50 Frikkie Meyer Boulevard\nVanderbijlpark\n1911',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- Same shape on one line: the token is still standalone.
  ('BF-0006', 'One', 'Line', '1990-01-06', 'none', 'not_brought',
   '082 000 0006', null, '1410 Zone 13 Sebokeng 1983',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- All numbers: "stand 1410, code 1983" and "two stand numbers" read the same,
  -- so this is left alone.
  ('BF-0007', 'Numbers', 'Only', '1990-01-07', 'none', 'not_brought',
   '082 000 0007', null, '1410 1983',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- The pair this change exists for. File 2014 is the older, fuller record.
  ('2014', 'Boitumelo', 'Phale', '1995-09-09', 'none', 'not_brought',
   '073 111 2222', null, E'1410\nZone 13\nSebokeng\n1983',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- A household: one file number, two people, one address and one phone.
  ('HH-0100', 'Palesa', 'Mokoena', '1972-04-04', 'none', 'not_brought',
   '082 555 0100', null, E'88 Moshoeshoe Street\nSharpeville\n1928',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),
  ('HH-0100', 'Karabo', 'Mokoena', '1998-11-30', 'none', 'not_brought',
   '082 555 0100', null, E'88 Moshoeshoe Street\nSharpeville\n1928',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- Two files staff have already decided are different people. Both addresses
  -- carry a trailing code, so both are rewritten by the backfill.
  ('KB-0201', 'Sipho', 'Ndlovu', '1988-03-03', 'none', 'not_brought',
   '084 222 0001', null, E'12 Mandela Drive\nEvaton\n1984',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),
  ('KB-0202', 'Sipho', 'Ndlovu', '1991-07-07', 'none', 'not_brought',
   '084 222 0001', null, E'12 Mandela Drive\nEvaton\n1984',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),

  -- The same situation with no postal code anywhere. This migration must not
  -- touch these rows at all — if it did, every dismissed pair in the register
  -- would re-open the next time anyone edited either file.
  ('KB-0301', 'Naledi', 'Motaung', '1986-05-05', 'none', 'not_brought',
   '084 222 0002', null, E'5 Rose Street\nVereeniging',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),
  ('KB-0302', 'Naledi', 'Motaung', '1990-09-09', 'none', 'not_brought',
   '084 222 0002', null, E'5 Rose Street\nVereeniging',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101');

-- The "keep both" decision, fingerprinted the way the database did it before
-- this migration. If the migration left it alone, the next edit to either file
-- would re-open the pair for no reason.
insert into public.duplicate_reviews (
  patient_id, candidate_patient_id, review_reason, reviewed_by,
  status, resolved_by, resolved_at, resolution_reason, resolved_fingerprint
)
select
  a.id, b.id, 'Registered separately on the same day.', a.created_by,
  'not_duplicate', a.created_by, now(), 'Cousins with the same name, confirmed at reception.',
  private.pair_match_fingerprint(a.id, b.id)
from public.patients a, public.patients b
where (a.file_number, b.file_number) in (('KB-0201', 'KB-0202'), ('KB-0301', 'KB-0302'));
