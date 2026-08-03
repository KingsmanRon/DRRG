-- The column itself: optional, four digits when present, and enforced by the
-- database rather than only by the form.

select test.ok(
  'postal_code exists and is nullable',
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public' and table_name = 'patients' and column_name = 'postal_code')
);

select test.eq(
  'postal_code is text, not a number (0083 must not become 83)',
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'patients' and column_name = 'postal_code'),
  'text'
);

select test.ok(
  'a patient may have no postal code',
  (select postal_code is null from public.patients where file_number = 'BF-0002')
);

update public.patients set postal_code = '1983' where file_number = 'BF-0002';
select test.eq(
  'a four digit postal code is accepted',
  (select postal_code from public.patients where file_number = 'BF-0002'),
  '1983'
);

update public.patients set postal_code = null where file_number = 'BF-0002';
select test.ok(
  'a postal code can be removed again',
  (select postal_code is null from public.patients where file_number = 'BF-0002')
);

select test.raises(
  'three digits are rejected',
  $$update public.patients set postal_code = '198' where file_number = 'BF-0002'$$,
  'patients_postal_code_check'
);

select test.raises(
  'five digits are rejected',
  $$update public.patients set postal_code = '19834' where file_number = 'BF-0002'$$,
  'patients_postal_code_check'
);

select test.raises(
  'letters are rejected',
  $$update public.patients set postal_code = 'ABCD' where file_number = 'BF-0002'$$,
  'patients_postal_code_check'
);

select test.raises(
  'an empty string is rejected (the app must send NULL)',
  $$update public.patients set postal_code = '' where file_number = 'BF-0002'$$,
  'patients_postal_code_check'
);

select test.eq(
  'every existing patient row is still valid',
  (select count(*)::integer from public.patients
   where postal_code is not null and postal_code !~ '^[0-9]{4}$'),
  0
);

-- A postal code is not contact detail: it cannot stand in for phone + address,
-- and it does not make an otherwise contactless record valid.
select test.raises(
  'postal code alone does not satisfy the contact rule',
  $$insert into public.patients (
      file_number, first_names, surname, date_of_birth, identity_type,
      no_identity_reason_code, postal_code, created_by, updated_by
    ) values (
      'CT-0001', 'No', 'Contact', '1990-01-01', 'none', 'not_brought', '1983',
      '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'
    )$$,
  'patients_contact_shape_check'
);
