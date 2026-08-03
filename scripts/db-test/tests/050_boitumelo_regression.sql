-- The case this change exists for.
--
--   File 2014  Boitumelo Phale  1995-09-09  1410 Zone 13 Sebokeng  1983
--   File 1450  Boitumelo Phale  1995-09-10  1410 Zone 13 Sebokeng  (no code)
--
-- Same name, same address, one day apart, different phone, no email. Before
-- this change the address comparison failed on the postal code and the pair
-- scored 3 across one field — under the threshold, so nothing was ever shown.

select test.sign_in('Regression Test');

-- File 2014 is already on file (seeded, then split by the backfill).
select test.eq(
  'the existing record holds the address without its code',
  (select residential_address from public.patients where file_number = '2014'),
  E'1410\nZone 13\nSebokeng'
);
select test.eq(
  'and the code in its own field',
  (select postal_code from public.patients where file_number = '2014'),
  '1983'
);

-- Registering the second one now surfaces the first.
select test.eq(
  'the older file is found',
  (select d.file_number from public.find_possible_duplicates(
     'Boitumelo', 'Phale', '1995-09-10', '079 444 5555', 10, '',
     E'1410\nZone 13\nSebokeng', null) d),
  '2014'
);
select test.eq(
  'scoring 4 — name and address',
  (select d.match_score from public.find_possible_duplicates(
     'Boitumelo', 'Phale', '1995-09-10', '079 444 5555', 10, '',
     E'1410\nZone 13\nSebokeng', null) d),
  4
);
select test.eq(
  'as a possible duplicate for a person to look at',
  (select d.match_tier from public.find_possible_duplicates(
     'Boitumelo', 'Phale', '1995-09-10', '079 444 5555', 10, '',
     E'1410\nZone 13\nSebokeng', null) d),
  'possible'
);
select test.eq(
  'and the reasons name both signals',
  (select d.match_reasons from public.find_possible_duplicates(
     'Boitumelo', 'Phale', '1995-09-10', '079 444 5555', 10, '',
     E'1410\nZone 13\nSebokeng', null) d),
  array['name', 'address']::text[]
);

-- Onboarding cannot slip past it.
select test.raises(
  'onboarding without reviewing the match is refused',
  $$select public.onboard_patient(
      jsonb_build_object(
        'file_number', '1450',
        'first_names', 'Boitumelo',
        'surname', 'Phale',
        'date_of_birth', '1995-09-10',
        'identity_type', 'none',
        'no_identity_reason_code', 'not_brought',
        'phone', '079 444 5555',
        'email', '',
        'residential_address', E'1410\nZone 13\nSebokeng',
        'postal_code', ''
      ),
      test.consent('Boitumelo Phale')
    )$$,
  'soft_duplicate_review_required'
);

select test.raises(
  'and so is submitting a record that is not one of the current matches',
  $$select public.onboard_patient(
      jsonb_build_object(
        'file_number', '1450',
        'first_names', 'Boitumelo',
        'surname', 'Phale',
        'date_of_birth', '1995-09-10',
        'identity_type', 'none',
        'no_identity_reason_code', 'not_brought',
        'phone', '079 444 5555',
        'email', '',
        'residential_address', E'1410\nZone 13\nSebokeng',
        'postal_code', ''
      ),
      test.consent('Boitumelo Phale'),
      array[
        (select id from public.patients where file_number = '2014'),
        (select id from public.patients where file_number = 'BF-0002')
      ]::uuid[],
      'Checked the register, this is a different person.'
    )$$,
  'soft_duplicate_review_mismatch'
);

-- Reviewed and justified, the record is created and the pair goes into the
-- duplicate queue. Nothing is merged: staff decide.
select public.onboard_patient(
  jsonb_build_object(
    'file_number', '1450',
    'first_names', 'Boitumelo',
    'surname', 'Phale',
    'date_of_birth', '1995-09-10',
    'identity_type', 'none',
    'no_identity_reason_code', 'not_brought',
    'phone', '079 444 5555',
    'email', '',
    'residential_address', E'1410\nZone 13\nSebokeng',
    'postal_code', ''
  ),
  test.consent('Boitumelo Phale'),
  array[(select id from public.patients where file_number = '2014')]::uuid[],
  'Patient says she has never been here before; date of birth differs by a day.'
);

select test.eq(
  'a blank postal code is stored as nothing, not as an empty string',
  (select postal_code is null from public.patients where file_number = '1450'),
  true
);

select test.eq(
  'the pair is now waiting for review',
  (select count(*)::integer from public.duplicate_reviews dr
   join public.patients a on a.id = dr.patient_id
   join public.patients b on b.id = dr.candidate_patient_id
   where dr.status = 'flagged'
     and a.file_number = '1450' and b.file_number = '2014'),
  1
);

select test.eq(
  'both records are still there — nothing was merged',
  (select count(*)::integer from public.patients
   where file_number in ('2014', '1450') and status = 'active'),
  2
);

-- What the review screen is given.
select test.eq(
  'the queue tiers the pair as possible',
  (select r.match_tier from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450'),
  'possible'
);
select test.eq(
  'scoring 4',
  (select r.match_score from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450'),
  4
);
select test.eq(
  'naming the signals that matched',
  (select r.match_reasons from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450'),
  array['name', 'address']::text[]
);
select test.eq(
  'showing the postal code the older file has',
  (select r.candidate->>'postal_code' from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450'),
  '1983'
);
select test.eq(
  'and that the newer one has none, rather than hiding the difference',
  (select r.patient->>'postal_code' from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450'),
  null::text
);
select test.ok(
  'with both dates of birth visible, a day apart',
  (select (r.patient->>'date_of_birth') = '1995-09-10'
      and (r.candidate->>'date_of_birth') = '1995-09-09'
   from public.list_duplicate_reviews() r
   where (r.patient->>'file_number') = '1450')
);

-- The same comparison from the stored side, which is what the queue and the
-- register badges use.
select test.eq(
  'the stored pair scores the same way',
  (select m.score from private.duplicate_match(
     (select id from public.patients where file_number = '2014'),
     (select id from public.patients where file_number = '1450')) m),
  4
);
select test.eq(
  'and tiers the same way',
  (select m.tier from private.duplicate_match(
     (select id from public.patients where file_number = '2014'),
     (select id from public.patients where file_number = '1450')) m),
  'possible'
);
