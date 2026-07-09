import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

assert(url, "SUPABASE_URL is required");
assert(publishableKey, "SUPABASE_PUBLISHABLE_KEY is required");
assert(secretKey, "SUPABASE_SECRET_KEY is required");

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `db-verifier-${Date.now()}@example.test`;
const password = `Verify-${Date.now()}-Safe`;

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
assert.ifError(createError);
assert(created.user, "Test user was not created");

const { error: profileError } = await admin.from("profiles").insert({
  user_id: created.user.id,
  display_name: "Database Verifier",
  role: "doctor",
  active: true,
});
assert.ifError(profileError);

const staff = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: signInError } = await staff.auth.signInWithPassword({ email, password });
assert.ifError(signInError);

const patient = {
  first_names: "Nomsa Thandi",
  surname: "Dlamini",
  date_of_birth: "1980-01-01",
  identity_type: "sa_id",
  identity_number: "8001015009087",
  identity_country: "",
  no_identity_reason: "",
  phone: "+27 82 123 4567",
  email: "nomsa@example.test",
  residential_address: "1 Main Road, Johannesburg",
};
const consent = {
  consent_version: "1.0",
  consent_text_hash: "a".repeat(64),
  signature_type: "typed_name",
  signature_value: "Nomsa Dlamini",
  patient_present_attestation: true,
};

const directInsert = await staff.from("patients").insert({
  ...patient,
  identity_country: null,
  no_identity_reason: null,
  created_by: created.user.id,
  updated_by: created.user.id,
});
assert(directInsert.error, "Direct patient insertion bypassed the onboarding transaction");
assert.equal(directInsert.error.code, "42501");

const first = await staff.rpc("onboard_patient", {
  p_patient: patient,
  p_consent: consent,
  p_duplicate_candidate_ids: [],
  p_duplicate_review_reason: "",
});
assert.ifError(first.error);
assert.equal(first.data?.length, 1, "First patient was not created");
assert.match(first.data[0].file_number, /^DRRG\d{8}$/);

const exactDuplicate = await staff.rpc("onboard_patient", {
  p_patient: { ...patient, phone: "+27 82 999 0000" },
  p_consent: consent,
  p_duplicate_candidate_ids: [],
  p_duplicate_review_reason: "",
});
assert(exactDuplicate.error, "Exact identity duplicate was not blocked");
assert.equal(exactDuplicate.error.code, "23505");
assert.match(exactDuplicate.error.message, /patients_unique_identity_idx/);

const possibleMatches = await staff.rpc("find_possible_duplicates", {
  p_first_names: patient.first_names,
  p_surname: patient.surname,
  p_date_of_birth: patient.date_of_birth,
  p_phone: patient.phone,
  p_limit: 5,
});
assert.ifError(possibleMatches.error);
assert.equal(possibleMatches.data?.length, 1, "Soft duplicate candidate was not found");
assert.equal(possibleMatches.data[0].identity_last4, "9087", "Soft duplicate did not return the masked identity");
assert.ok(!("identity_number" in possibleMatches.data[0]), "Soft duplicate leaked the full identity number");

const phoneOnlyMatches = await staff.rpc("find_possible_duplicates", {
  p_first_names: "Completely Different",
  p_surname: "Patient",
  p_date_of_birth: "1992-02-02",
  p_phone: patient.phone,
  p_limit: 5,
});
assert.ifError(phoneOnlyMatches.error);
assert.equal(phoneOnlyMatches.data?.length, 1, "Exact phone duplicate candidate was not found");
assert.equal(phoneOnlyMatches.data[0].match_score, 55);
assert.deepEqual(phoneOnlyMatches.data[0].match_reasons, ["same_phone"]);

const noIdentityPatient = {
  ...patient,
  identity_type: "none",
  identity_number: "",
  no_identity_reason: "Passport application pending",
  email: "nomsa.second@example.test",
};
const missingReview = await staff.rpc("onboard_patient", {
  p_patient: noIdentityPatient,
  p_consent: { ...consent, signature_value: "Nomsa Thandi Dlamini" },
  p_duplicate_candidate_ids: [],
  p_duplicate_review_reason: "",
});
assert(missingReview.error, "Soft duplicate review could be bypassed");
assert.equal(missingReview.error.code, "22023");
assert.match(missingReview.error.message, /soft_duplicate_review_required/);

const reviewed = await staff.rpc("onboard_patient", {
  p_patient: noIdentityPatient,
  p_consent: { ...consent, signature_value: "Nomsa Thandi Dlamini" },
  p_duplicate_candidate_ids: [first.data[0].patient_id],
  p_duplicate_review_reason: "Different person confirmed in person by reception",
});
assert.ifError(reviewed.error);
assert.equal(reviewed.data?.length, 1, "Reviewed no identity patient was not created");

const patientSearch = await staff.rpc("search_patients", {
  p_query: "082 123",
  p_limit: 1,
  p_offset: 0,
});
assert.ifError(patientSearch.error);
assert.equal(patientSearch.data?.total_count, 2, "Search did not cover all matching patient records");
assert.equal(patientSearch.data?.patients?.length, 1, "Search pagination limit was not applied");
const searchRow = patientSearch.data.patients[0];
assert.ok(!("identity_number" in searchRow), "Patient search leaked the full identity number");
assert.ok("identity_last4" in searchRow, "Patient search did not return the masked identity");
assert.equal(searchRow.possible_duplicate, true, "Patient search did not flag the reviewed patient as a possible duplicate");

const literalWildcardSearch = await staff.rpc("search_patients", {
  p_query: "%",
  p_limit: 25,
  p_offset: 0,
});
assert.ifError(literalWildcardSearch.error);
assert.equal(literalWildcardSearch.data?.total_count, 0, "Search treated user input as a wildcard expression");

const audit = await staff
  .from("audit_events")
  .select("action, patient_id")
  .eq("patient_id", reviewed.data[0].patient_id);
assert.ifError(audit.error);
assert.deepEqual(
  new Set(audit.data.map((event) => event.action)),
  new Set(["patient_created", "duplicate_reviewed"]),
);

console.log("Database verification passed: direct inserts denied, exact identities blocked, name, birth date and phone matches reviewed, full patient search paginated, no identity onboarding allowed, and audit events recorded.");
