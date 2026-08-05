-- Consent on a family file: the first person signs, everyone added afterwards
-- inherits that signature, and the record says so rather than pretending each
-- person signed for themselves.

select test.sign_in('Household Consent Test');

-- The file is opened the normal way: a signed, individual consent.
select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'HC-0001',
    'first_names', 'Nomsa', 'surname', 'Dlamini', 'date_of_birth', '1984-03-03',
    'identity_type', 'none', 'no_identity_reason_code', 'not_brought',
    'phone', '083 400 0001', 'residential_address', E'12 Zone 3\nSebokeng'
  ),
  test.consent('Nomsa Dlamini')
);

select test.eq(
  'the person who opens a file signs an individual consent',
  (select c.scope::text
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.file_number = 'HC-0001'),
  'individual'
);

-- --------------------------------------------------------------------------
-- Adding a second person: no consent payload at all.
-- --------------------------------------------------------------------------

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'HC-0001',
    'first_names', 'Thabo', 'surname', 'Dlamini', 'date_of_birth', '2019-07-07',
    'identity_type', 'none', 'no_identity_reason_code', 'newborn_no_certificate',
    'phone', '083 400 0001', 'residential_address', E'12 Zone 3\nSebokeng'
  ),
  null,
  '{}'::uuid[],
  '',
  true
);

select test.eq(
  'a person can be added to a file without a consent payload',
  (select count(*)::integer from public.patients where file_number = 'HC-0001' and status = 'active'),
  2
);

select test.eq(
  'the file signature is promoted to household scope',
  (select c.scope::text
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.first_names = 'Nomsa' and p.file_number = 'HC-0001'),
  'household'
);

select test.ok(
  'and the promotion records who did it and when',
  (select c.scope_changed_by is not null and c.scope_changed_at is not null
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.first_names = 'Nomsa' and p.file_number = 'HC-0001')
);

select test.eq(
  'the promotion is an audit event on the signatory',
  (select count(*)::integer
     from public.audit_events a
     join public.patients p on p.id = a.patient_id
    where a.action = 'consent_scope_promoted' and p.first_names = 'Nomsa'),
  1
);

select test.eq(
  'the added person''s consent names the patient whose signature covers them',
  (select signer.first_names
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
     join public.patients signer on signer.id = c.granted_by_patient_id
    where p.first_names = 'Thabo'),
  'Nomsa'
);

select test.eq(
  'the inherited consent carries the signature that was actually given',
  (select c.signature_value
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.first_names = 'Thabo'),
  'Nomsa Dlamini'
);

-- Nobody attested that the added person was present, so the record does not
-- claim it. This is the whole point of inheriting rather than auto-filling.
select test.eq(
  'an inherited consent does not assert the patient was present',
  (select c.patient_present_attestation
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.first_names = 'Thabo'),
  false
);

-- --------------------------------------------------------------------------
-- A third person inherits from the original signature, not from the inherited
-- one, and the file is not promoted twice.
-- --------------------------------------------------------------------------

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'HC-0001',
    'first_names', 'Lerato', 'surname', 'Dlamini', 'date_of_birth', '2022-01-04',
    'identity_type', 'none', 'no_identity_reason_code', 'newborn_no_certificate',
    'phone', '083 400 0001', 'residential_address', E'12 Zone 3\nSebokeng'
  ),
  null, '{}'::uuid[], '', true
);

select test.eq(
  'the third person inherits from the signatory, not from an inherited consent',
  (select signer.first_names
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
     join public.patients signer on signer.id = c.granted_by_patient_id
    where p.first_names = 'Lerato'),
  'Nomsa'
);

select test.eq(
  'a file already covering a household is not promoted again',
  (select count(*)::integer
     from public.audit_events a
    where a.action = 'consent_scope_promoted'
      and a.metadata->>'file_number' = 'HC-0001'),
  1
);

select test.eq(
  'every person on the file has exactly one consent row',
  (select count(*)::integer
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.file_number = 'HC-0001'),
  3
);

-- --------------------------------------------------------------------------
-- Guard rails.
-- --------------------------------------------------------------------------

select test.raises(
  'registering a new file still requires a consent',
  $$select public.onboard_patient(
      jsonb_build_object(
        'file_number', 'HC-0002',
        'first_names', 'Sipho', 'surname', 'Nkosi', 'date_of_birth', '1990-05-05',
        'identity_type', 'none', 'no_identity_reason_code', 'not_brought',
        'phone', '083 400 0002', 'residential_address', E'8 Zone 9\nSebokeng'
      ),
      null
    )$$,
  'consent is required'
);

select test.raises(
  'a signed consent must still attest that the patient was present',
  $$update public.patient_consents c
      set patient_present_attestation = false
      from public.patients p
     where p.id = c.patient_id and p.first_names = 'Nomsa'$$,
  'patient_consents_attestation_check'
);

select test.raises(
  'a consent cannot be granted by the patient it covers',
  $$update public.patient_consents c
      set granted_by_patient_id = c.patient_id, scope = 'household'
      from public.patients p
     where p.id = c.patient_id and p.first_names = 'Thabo'$$,
  'patient_consents_granted_by_other_check'
);

-- --------------------------------------------------------------------------
-- An archived signatory still covers the file: reception cannot be blocked
-- from adding someone because the first member's record was archived.
-- --------------------------------------------------------------------------

select public.archive_patient(
  (select id from public.patients where file_number = 'HC-0001' and first_names = 'Nomsa'),
  'Registered in error during testing'
);

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'HC-0001',
    'first_names', 'Kagiso', 'surname', 'Dlamini', 'date_of_birth', '2016-11-11',
    'identity_type', 'none', 'no_identity_reason_code', 'newborn_no_certificate',
    'phone', '083 400 0001', 'residential_address', E'12 Zone 3\nSebokeng'
  ),
  null, '{}'::uuid[], '', true
);

select test.eq(
  'an archived signatory still grants the consent for a new member',
  (select signer.first_names
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
     join public.patients signer on signer.id = c.granted_by_patient_id
    where p.first_names = 'Kagiso'),
  'Nomsa'
);

-- --------------------------------------------------------------------------
-- A file nobody is added to is left exactly as it was: consent becomes a
-- household matter when a household forms, not before.
-- --------------------------------------------------------------------------

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'HC-0003',
    'first_names', 'Palesa', 'surname', 'Mokoena', 'date_of_birth', '1977-06-06',
    'identity_type', 'none', 'no_identity_reason_code', 'declined',
    'phone', '083 400 0003', 'residential_address', E'44 Zone 12\nSebokeng'
  ),
  test.consent('Palesa Mokoena')
);

select test.eq(
  'a single-person file keeps its individual consent',
  (select c.scope::text
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.file_number = 'HC-0003'),
  'individual'
);

select test.ok(
  'and nothing was recorded as a scope change on it',
  (select c.scope_changed_at is null and c.scope_changed_by is null
     from public.patient_consents c
     join public.patients p on p.id = c.patient_id
    where p.file_number = 'HC-0003')
);
