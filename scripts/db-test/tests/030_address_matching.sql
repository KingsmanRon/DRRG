-- Addresses are compared on their content: case, punctuation, accents, line
-- breaks and a trailing postal code all fall away; the address itself does not.

select test.eq(
  'line breaks and spacing do not matter',
  private.address_match_key(E'1410\nZone13\nSebokeng'),
  private.address_match_key('1410 Zone 13 Sebokeng')
);

select test.eq(
  'punctuation and case do not matter',
  private.address_match_key('1410, ZONE 13; Sebokeng.'),
  private.address_match_key('1410 zone 13 sebokeng')
);

select test.eq(
  'accents do not matter',
  private.address_match_key('12 Rue Poléve'),
  private.address_match_key('12 Rue Poleve')
);

select test.eq(
  'a postal code on one side only does not stop the match',
  private.address_match_key(E'1410 Zone 13 Sebokeng\n1983'),
  private.address_match_key('1410 Zone 13 Sebokeng')
);

select test.ok(
  'a different street number is still a different address',
  private.address_match_key('1410 Zone 13 Sebokeng') <> private.address_match_key('1411 Zone 13 Sebokeng')
);

select test.ok(
  'a different suburb is still a different address',
  private.address_match_key(E'1410 Zone 13 Sebokeng\n1983') <> private.address_match_key(E'1410 Zone 14 Sebokeng\n1983')
);

select test.eq(
  'the postal code is never appended to the compared address',
  private.address_match_key(E'1410 Zone 13 Sebokeng\n1983'),
  '1410zone13sebokeng'
);

-- normalise_address keeps doing its own job: address search still matches on
-- whatever is stored, postal code separation did not change it.
select test.eq(
  'normalise_address is unchanged',
  private.normalise_address(E'1410, Zone 13\nSebokeng 1983'),
  '1410 zone 13 sebokeng 1983'
);
