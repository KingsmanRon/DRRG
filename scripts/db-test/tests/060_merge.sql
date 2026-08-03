-- Merging two files must not throw the postal code away: it follows the same
-- rule as email, phone and address — an empty survivor field is filled from the
-- record being archived, and a difference is the survivor's to keep.

select test.sign_in('Merge Test');

insert into public.patients (
  file_number, first_names, surname, date_of_birth,
  identity_type, no_identity_reason_code,
  phone, residential_address, postal_code,
  created_by, updated_by
)
values
  ('MG-0001', 'Lebo', 'Radebe', '1979-02-02', 'none', 'not_brought',
   '083 300 0001', E'6 Nhlapo Street\nSebokeng', null,
   (select auth.uid()), (select auth.uid())),
  ('MG-0002', 'Lebo', 'Radebe', '1979-02-02', 'none', 'not_brought',
   '083 300 0002', E'6 Nhlapo Street\nSebokeng', '1983',
   (select auth.uid()), (select auth.uid())),
  ('MG-0003', 'Tumi', 'Radebe', '1981-04-04', 'none', 'not_brought',
   '083 300 0003', E'9 Zone 7\nSebokeng', '1983',
   (select auth.uid()), (select auth.uid())),
  ('MG-0004', 'Tumi', 'Radebe', '1981-04-04', 'none', 'not_brought',
   '083 300 0004', E'9 Zone 7\nSebokeng', '1984',
   (select auth.uid()), (select auth.uid()));

-- The two files are a match on name, date of birth and address.
select test.eq(
  'the pair merging below is a likely duplicate',
  (select m.tier from private.duplicate_match(
     (select id from public.patients where file_number = 'MG-0001'),
     (select id from public.patients where file_number = 'MG-0002')) m),
  'likely'
);

select test.ok(
  'a postal code the survivor lacks is copied from the archived record',
  (select 'postal code' = any(m.fields_copied) from public.merge_patients(
     (select id from public.patients where file_number = 'MG-0001'),
     (select id from public.patients where file_number = 'MG-0002')) m)
);
select test.eq(
  'and is on the surviving file afterwards',
  (select postal_code from public.patients where file_number = 'MG-0001'),
  '1983'
);
select test.eq(
  'while the archived record is kept, not deleted',
  (select status::text from public.patients where file_number = 'MG-0002'),
  'archived'
);

-- Two different codes: the survivor's wins and the difference is recorded.
select public.merge_patients(
  (select id from public.patients where file_number = 'MG-0003'),
  (select id from public.patients where file_number = 'MG-0004')
);
select test.eq(
  'the survivor keeps its own postal code',
  (select postal_code from public.patients where file_number = 'MG-0003'),
  '1983'
);
select test.ok(
  'and the discarded one is written to the audit trail',
  (select ae.metadata->'conflicts_overridden' @> '[{"field": "postal code", "kept": "1983", "discarded": "1984"}]'::jsonb
   from public.audit_events ae
   where ae.action = 'patient_merged'
     and ae.patient_id = (select id from public.patients where file_number = 'MG-0003'))
);

-- Address conflicts are judged on the same key matching uses, so a code left in
-- one address box does not read as a different address during a merge.
insert into public.patients (
  file_number, first_names, surname, date_of_birth,
  identity_type, no_identity_reason_code,
  phone, residential_address, postal_code,
  created_by, updated_by
)
values
  ('MG-0005', 'Kagiso', 'Sithole', '1993-08-08', 'none', 'not_brought',
   '083 300 0005', E'44 Zone 3\nSebokeng', '1983',
   (select auth.uid()), (select auth.uid())),
  ('MG-0006', 'Kagiso', 'Sithole', '1993-08-08', 'none', 'not_brought',
   '083 300 0006', E'44 Zone 3\nSebokeng\n1983', null,
   (select auth.uid()), (select auth.uid()));

select public.merge_patients(
  (select id from public.patients where file_number = 'MG-0005'),
  (select id from public.patients where file_number = 'MG-0006')
);
select test.ok(
  'the same address written two ways is not reported as a conflict',
  (select not (ae.metadata->'conflicts_overridden')::jsonb @> '[{"field": "address"}]'::jsonb
   from public.audit_events ae
   where ae.action = 'patient_merged'
     and ae.patient_id = (select id from public.patients where file_number = 'MG-0005'))
);
