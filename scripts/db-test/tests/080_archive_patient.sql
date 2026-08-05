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

-- Restoring is the way back out, and it shares the output-parameter shape that
-- broke archiving, so it is worth stating that it works.
select test.eq(
  'a manually archived record can be restored',
  (select r.file_number from public.restore_patient(
     (select id from public.patients where file_number = 'AR-0001')) r),
  'AR-0001'
);

select test.eq(
  'and is back on the active register',
  (select status::text from public.patients where file_number = 'AR-0001'),
  'active'
);

-- --------------------------------------------------------------------------
-- The statement that was broken did not just have to stop failing: archiving a
-- file has to take its pair out of the duplicate queue. A pair where one side
-- is archived is not something staff can act on.
-- --------------------------------------------------------------------------

select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'AR-0002',
    'first_names', 'Lerato', 'surname', 'Mahlangu', 'date_of_birth', '1991-02-02',
    'identity_type', 'none', 'no_identity_reason_code', 'not_brought',
    'phone', '083 500 0002', 'residential_address', E'7 Zone 6\nSebokeng'
  ),
  test.consent('Lerato Mahlangu')
);

-- Same name and date of birth: a likely duplicate, reviewed and kept apart.
select public.onboard_patient(
  jsonb_build_object(
    'file_number', 'AR-0003',
    'first_names', 'Lerato', 'surname', 'Mahlangu', 'date_of_birth', '1991-02-02',
    'identity_type', 'none', 'no_identity_reason_code', 'not_brought',
    'phone', '083 500 0003', 'residential_address', E'19 Zone 11\nSebokeng'
  ),
  test.consent('Lerato Mahlangu'),
  array(select id from public.patients where file_number = 'AR-0002'),
  'Different person, confirmed with the patient at the desk'
);

select test.eq(
  'the pair is on the queue before either file is archived',
  (select r.status::text from public.duplicate_reviews r
     join public.patients p on p.id = r.patient_id
    where p.file_number = 'AR-0003'),
  'flagged'
);

select public.archive_patient(
  (select id from public.patients where file_number = 'AR-0003'),
  'Registered in error at the front desk'
);

select test.eq(
  'archiving a file takes its pair off the queue',
  (select r.status::text from public.duplicate_reviews r
     join public.patients p on p.id = r.patient_id
    where p.file_number = 'AR-0003'),
  'not_duplicate'
);

select test.ok(
  'and records who resolved it, when, and why',
  (select r.resolved_by is not null
          and r.resolved_at is not null
          and r.resolution_reason = 'Registered in error at the front desk'
     from public.duplicate_reviews r
     join public.patients p on p.id = r.patient_id
    where p.file_number = 'AR-0003')
);

-- The fingerprint is what stops a resolved pair re-opening unless the matched
-- fields change. It is computed in the statement that carried the bug, so an
-- empty one would mean the fix compiled without doing its work.
select test.ok(
  'the resolved pair carries a match fingerprint',
  (select r.resolved_fingerprint is not null and length(r.resolved_fingerprint) > 0
     from public.duplicate_reviews r
     join public.patients p on p.id = r.patient_id
    where p.file_number = 'AR-0003')
);
