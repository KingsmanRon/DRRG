-- What the migration did to the addresses seeded in
-- scripts/db-test/before/20260803120000_postal_code_separation.sql.

select test.eq(
  'a trailing code on its own line is lifted out',
  (select postal_code from public.patients where file_number = 'BF-0001'),
  '1983'
);
select test.eq(
  'and the rest of the address is kept line for line',
  (select residential_address from public.patients where file_number = 'BF-0001'),
  E'1410\nZone 13\nSebokeng'
);

select test.eq(
  'an address with no code keeps its postal code null',
  (select postal_code from public.patients where file_number = 'BF-0002'),
  null::text
);
select test.eq(
  'and is not rewritten',
  (select residential_address from public.patients where file_number = 'BF-0002'),
  E'1410\nZone 13\nSebokeng'
);

select test.eq(
  'a five digit stand number is not a postal code',
  (select postal_code from public.patients where file_number = 'BF-0003'),
  null::text
);
select test.eq(
  'and the address is untouched',
  (select residential_address from public.patients where file_number = 'BF-0003'),
  '17234'
);

select test.eq(
  'an address that is only four digits is left alone',
  (select postal_code from public.patients where file_number = 'BF-0004'),
  null::text
);
select test.eq(
  'because extracting it would empty the address',
  (select residential_address from public.patients where file_number = 'BF-0004'),
  '1983'
);

select test.eq(
  'a street address ending in a code is split',
  (select postal_code from public.patients where file_number = 'BF-0005'),
  '1911'
);
select test.eq(
  'keeping the street and the town',
  (select residential_address from public.patients where file_number = 'BF-0005'),
  E'No 50 Frikkie Meyer Boulevard\nVanderbijlpark'
);

select test.eq(
  'a single line address ending in a standalone code is split too',
  (select postal_code from public.patients where file_number = 'BF-0006'),
  '1983'
);
select test.eq(
  'leaving the address text intact',
  (select residential_address from public.patients where file_number = 'BF-0006'),
  '1410 Zone 13 Sebokeng'
);

select test.eq(
  'an all-numeric address is too ambiguous to split',
  (select postal_code from public.patients where file_number = 'BF-0007'),
  null::text
);
select test.eq(
  'so it is left as entered',
  (select residential_address from public.patients where file_number = 'BF-0007'),
  '1410 1983'
);

select test.eq(
  'no address was emptied by the backfill',
  (select count(*)::integer from public.patients
   where residential_address is not null and char_length(btrim(residential_address)) < 3),
  0
);

-- Idempotence: the rule finds nothing left to extract from what it produced,
-- so re-running the backfill cannot eat another number.
select test.eq(
  'no backfilled address still looks like it ends in a postal code',
  (select count(*)::integer from public.patients
   where postal_code is not null
     and private.postal_code_from_address(residential_address) is not null),
  0
);

select test.eq(
  're-extracting from a split address returns nothing',
  private.postal_code_from_address((select residential_address from public.patients where file_number = 'BF-0001')),
  null::text
);
select test.eq(
  'and re-stripping it changes nothing',
  private.address_without_postal_code(E'1410\nZone 13\nSebokeng'),
  E'1410\nZone 13\nSebokeng'
);

-- The extraction rule on its own, including the shapes no patient row happens
-- to hold.
select test.eq('code after a comma is extracted', private.postal_code_from_address('12 Long Street, Vereeniging, 1930'), '1930');
select test.eq('trailing blank lines do not hide the code', private.postal_code_from_address(E'12 Long Street\nVereeniging\n1930\n\n  '), '1930');
select test.eq('and are trimmed off the address', private.address_without_postal_code(E'12 Long Street\nVereeniging\n1930\n\n  '), E'12 Long Street\nVereeniging');
select test.eq('a three digit tail is not a postal code', private.postal_code_from_address('12 Long Street 193'), null::text);
select test.eq('a six digit tail is not a postal code', private.postal_code_from_address('12 Long Street 193045'), null::text);
select test.eq('digits glued to a word are not a postal code', private.postal_code_from_address('12 Long Street Ext1983'), null::text);
select test.eq('null in, null out', private.postal_code_from_address(null), null::text);
select test.eq('null address is returned unchanged', private.address_without_postal_code(null), null::text);
