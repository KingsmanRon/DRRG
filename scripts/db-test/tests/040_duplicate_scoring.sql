-- The weighted score is unchanged by postal code separation: name 3, date of
-- birth 3, email 2, phone 1, address 1; possible needs 2 points across two
-- fields; likely needs an identity match, name + date of birth, or 6 points.
-- Postal code is worth nothing on its own.

select test.sign_in('Scoring Test');

insert into public.patients (
  file_number, first_names, surname, date_of_birth,
  identity_type, no_identity_reason_code,
  phone, email, residential_address, postal_code,
  created_by, updated_by
)
values
  ('SC-0001', 'Refilwe', 'Tshabalala', '1983-05-05', 'none', 'not_brought',
   '081 400 0001', null, E'7 Nkosi Street\nBoipatong', '1911',
   (select auth.uid()), (select auth.uid())),

  -- Same postal code, nothing else in common.
  ('SC-0002', 'Gugulethu', 'Mahlangu', '1966-12-12', 'none', 'not_brought',
   '081 400 0002', null, E'19 Twala Avenue\nBophelong', '1911',
   (select auth.uid()), (select auth.uid()));

-- --- Exact name + matching address -----------------------------------------
select test.eq(
  'name + address scores 4',
  (select d.match_score from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-06', '081 999 9999', 5, '', '7 Nkosi Street Boipatong') d
   where d.file_number = 'SC-0001'),
  4
);
select test.eq(
  'name + address is a possible duplicate, not a likely one',
  (select d.match_tier from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-06', '081 999 9999', 5, '', '7 Nkosi Street Boipatong') d
   where d.file_number = 'SC-0001'),
  'possible'
);
select test.eq(
  'and says why',
  (select d.match_reasons from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-06', '081 999 9999', 5, '', '7 Nkosi Street Boipatong') d
   where d.file_number = 'SC-0001'),
  array['name', 'address']::text[]
);

-- The candidate carries its address and postal code so the review screen can
-- show that the two records describe the same place.
select test.eq(
  'the candidate carries its address',
  (select d.residential_address from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-06', '081 999 9999', 5, '', '7 Nkosi Street Boipatong') d
   where d.file_number = 'SC-0001'),
  E'7 Nkosi Street\nBoipatong'
);
select test.eq(
  'and its postal code',
  (select d.postal_code from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-06', '081 999 9999', 5, '', '7 Nkosi Street Boipatong') d
   where d.file_number = 'SC-0001'),
  '1911'
);

-- --- Exact name + exact date of birth --------------------------------------
select test.ok(
  'name + date of birth scores at least 6',
  (select d.match_score >= 6 from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-05', '081 999 9999', 5, '', 'Somewhere else entirely') d
   where d.file_number = 'SC-0001')
);
select test.eq(
  'and is a likely duplicate',
  (select d.match_tier from public.find_possible_duplicates(
     'Refilwe', 'Tshabalala', '1983-05-05', '081 999 9999', 5, '', 'Somewhere else entirely') d
   where d.file_number = 'SC-0001'),
  'likely'
);

-- --- Postal code alone ------------------------------------------------------
-- Two patients share 1911 and nothing else. A postal code covers a whole
-- delivery area; treating it as a signal would pair every patient in Sebokeng
-- with every other one.
select test.eq(
  'a shared postal code scores nothing',
  (select m.score from private.duplicate_match(
     (select id from public.patients where file_number = 'SC-0001'),
     (select id from public.patients where file_number = 'SC-0002')) m),
  0
);
select test.eq(
  'and is not a duplicate of any tier',
  (select m.tier from private.duplicate_match(
     (select id from public.patients where file_number = 'SC-0001'),
     (select id from public.patients where file_number = 'SC-0002')) m),
  'none'
);
select test.eq(
  'a shared postal code is never given as a reason',
  (select m.reasons from private.duplicate_match(
     (select id from public.patients where file_number = 'SC-0001'),
     (select id from public.patients where file_number = 'SC-0002')) m),
  '{}'::text[]
);
select test.eq(
  'and never reaches the registration search',
  (select count(*)::integer from public.find_possible_duplicates(
     'Someone', 'Unrelated', '2001-02-03', '', 5, '', '') d),
  0
);

-- --- Households -------------------------------------------------------------
-- Relatives share an address and a phone. That is a possible match by design
-- (+1 +1), never a likely one, and adding someone to their own file skips it.
select test.eq(
  'two people at one address with one phone are a possible match at most',
  (select m.tier from private.duplicate_match(
     (select id from public.patients where file_number = 'HH-0100' and first_names = 'Palesa'),
     (select id from public.patients where file_number = 'HH-0100' and first_names = 'Karabo')) m),
  'possible'
);
select test.eq(
  'scoring two points, not more',
  (select m.score from private.duplicate_match(
     (select id from public.patients where file_number = 'HH-0100' and first_names = 'Palesa'),
     (select id from public.patients where file_number = 'HH-0100' and first_names = 'Karabo')) m),
  2
);
select test.eq(
  'adding a third person to that file is not blocked by the people already on it',
  (select count(*)::integer from public.find_possible_duplicates(
     'Neo', 'Mokoena', '2004-06-06', '082 555 0100', 5, '',
     E'88 Moshoeshoe Street\nSharpeville', 'HH-0100') d),
  0
);
select test.eq(
  'the same person registered as a brand new file is still flagged',
  (select count(*)::integer from public.find_possible_duplicates(
     'Neo', 'Mokoena', '2004-06-06', '082 555 0100', 5, '',
     E'88 Moshoeshoe Street\nSharpeville', null) d),
  2
);
select test.ok(
  'and only as a possible duplicate',
  (select bool_and(d.match_tier = 'possible') from public.find_possible_duplicates(
     'Neo', 'Mokoena', '2004-06-06', '082 555 0100', 5, '',
     E'88 Moshoeshoe Street\nSharpeville', null) d)
);

-- The household's address had its postal code split out by the backfill, and it
-- still matches an address typed with the code still in it.
select test.eq(
  'a code typed into the address box does not hide the match',
  (select count(*)::integer from public.find_possible_duplicates(
     'Neo', 'Mokoena', '2004-06-06', '082 555 0100', 5, '',
     E'88 Moshoeshoe Street\nSharpeville\n1928', null) d),
  2
);

-- --- Keep-both decisions ----------------------------------------------------
-- The pair dismissed before the migration must stay dismissed: rewriting an
-- address to lift its postal code out is not a change of matched details.
select test.eq(
  'a dismissed pair is not re-opened by the backfill',
  (select count(*)::integer from public.duplicate_reviews dr
   join public.patients a on a.id = dr.patient_id
   where a.file_number in ('KB-0201', 'KB-0202') and dr.status = 'flagged'),
  0
);
select test.ok(
  'and its stored fingerprint still matches the records',
  (select dr.resolved_fingerprint = private.pair_match_fingerprint(dr.patient_id, dr.candidate_patient_id)
   from public.duplicate_reviews dr
   join public.patients a on a.id = dr.patient_id
   where a.file_number = 'KB-0201')
);

-- Editing one of them re-opens nothing while the matched fields stay put.
select public.update_patient(
  (select id from public.patients where file_number = 'KB-0201'),
  jsonb_build_object(
    'file_number', 'KB-0201',
    'first_names', 'Sipho',
    'surname', 'Ndlovu',
    'date_of_birth', '1988-03-03',
    'identity_type', 'none',
    'no_identity_reason_code', 'not_brought',
    'phone', '084 222 0001',
    'email', '',
    'residential_address', E'12 Mandela Drive\nEvaton',
    'postal_code', '1984'
  )
);
select test.eq(
  'and editing that file afterwards still does not re-open it',
  (select count(*)::integer from public.duplicate_reviews dr
   join public.patients a on a.id = dr.patient_id
   where a.file_number in ('KB-0201', 'KB-0202') and dr.status = 'flagged'),
  0
);
select test.eq(
  'though the postal code was saved',
  (select postal_code from public.patients where file_number = 'KB-0201'),
  '1984'
);

-- A dismissed pair with no postal code anywhere must be left completely alone —
-- the migration is not allowed to disturb decisions it has nothing to do with.
select test.ok(
  'a dismissed pair the migration never touched keeps its original fingerprint',
  (select dr.resolved_fingerprint = private.pair_match_fingerprint(dr.patient_id, dr.candidate_patient_id)
   from public.duplicate_reviews dr
   join public.patients a on a.id = dr.patient_id
   where a.file_number = 'KB-0301')
);
select test.eq(
  'and its addresses are byte for byte what they were',
  (select residential_address from public.patients where file_number = 'KB-0301'),
  E'5 Rose Street\nVereeniging'
);
select test.eq(
  'and it is still a match, so the dismissal is doing real work',
  (select m.tier from private.duplicate_match(
     (select id from public.patients where file_number = 'KB-0301'),
     (select id from public.patients where file_number = 'KB-0302')) m),
  'possible'
);
