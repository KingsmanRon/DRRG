-- Archiving a single file, which raised "column reference patient_id is
-- ambiguous" on every call until 20260805090500. Nothing exercised
-- archive_patient before, which is how it stayed broken.

select test.sign_in('Archive Test');

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'AR-0001',
    'first_names', 'Sipho', 'surname', 'Ncube', 'date_of_birth', '1988-08-08',
    'identity_type', 'none', 'no_identity_reason_code', 'not_brought',
    'phone', '083 500 0001', 'residential_address', E'21 Zone 4\nSebokeng'
  ),
  test.consent('Sipho Ncube')
);

select test.eq(
  'a patient can be archived with a reason',
  (select a.file_number from public.archive_patient(
     (select id from public.patients where file_number = 'AR-0001'),
     'Registered in error') a),
  'AR-0001'
);

select test.eq(
  'and the record is archived, not deleted',
  (select status::text from public.patients where file_number = 'AR-0001'),
  'archived'
);

select test.eq(
  'the archive is recorded in the audit trail',
  (select count(*)::integer
     from public.audit_events a
     join public.patients p on p.id = a.patient_id
    where a.action = 'patient_archived' and p.file_number = 'AR-0001'),
  1
);

select test.raises(
  'archiving twice is refused',
  $$select public.archive_patient(
      (select id from public.patients where file_number = 'AR-0001'),
      'Registered in error')$$,
  'patient_already_archived'
);

select test.raises(
  'a reason is required',
  $$select public.archive_patient(
      (select id from public.patients where file_number = 'AR-0001'),
      'no')$$,
  'archive reason'
);
