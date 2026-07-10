// Verifies the merge / keep-both / re-flag machinery against the LOCAL
// database. Re-runnable: every record it creates uses a per-run suffix.
// Usage (env from .env.local):
//   node --env-file=.env.local scripts/verify-local-merge.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

assert(url?.startsWith("http://127.0.0.1:"), "This script only supports local Supabase.");
assert(publishableKey, "SUPABASE_PUBLISHABLE_KEY is required");
assert(secretKey, "SUPABASE_SECRET_KEY is required");

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `merge-verifier-${Date.now()}@example.test`;
const password = `Verify-${Date.now()}-Safe`;

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
assert.ifError(createError);
const { error: profileError } = await admin.from("profiles").insert({
  user_id: created.user.id,
  display_name: "Merge Verifier",
  role: "doctor",
  active: true,
});
assert.ifError(profileError);

const staff = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const signIn = await staff.auth.signInWithPassword({ email, password });
assert.ifError(signIn.error);

const run = String(Date.now());
const consent = {
  consent_version: "1.0",
  consent_text_hash: "a".repeat(64),
  signature_type: "typed_name",
  signature_value: "Merge Verifier",
  patient_present_attestation: true,
};

// SA ID with a valid Luhn-style check digit (same maths as the app).
function saId(twelve) {
  const d = twelve.split("").map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8] + d[10];
  const evenNumber = Number(`${d[1]}${d[3]}${d[5]}${d[7]}${d[9]}${d[11]}`);
  const evenSum = String(evenNumber * 2).split("").reduce((s, x) => s + Number(x), 0);
  const check = (10 - ((oddSum + evenSum) % 10)) % 10;
  return twelve + String(check);
}

async function onboard(patient, candidateIds = []) {
  const result = await staff.rpc("onboard_patient", {
    p_patient: patient,
    p_consent: consent,
    p_duplicate_candidate_ids: candidateIds,
    p_duplicate_review_reason: candidateIds.length ? "Confirmed different at reception (verify script)" : "",
  });
  assert.ifError(result.error);
  return { ...patient, id: result.data[0].patient_id, file_number: result.data[0].file_number };
}

const rand4 = String(Math.floor(Math.random() * 10000)).padStart(4, "0");

// Likely pair: same name + date of birth; disjoint extras (P1 has the identity
// document and email, P2 has neither).
const p1 = await onboard({
  first_names: "Zanele",
  surname: `Vtest${run}`,
  date_of_birth: "1991-03-05",
  identity_type: "sa_id",
  identity_number: saId(`910305${rand4}08`),
  identity_country: "",
  no_identity_reason: "",
  phone: `061${run.slice(-7)}`,
  email: `zanele${run}@example.test`,
  residential_address: `1 Alpha Street, Durban ${run}`,
  file_number: "",
});

const p2Candidates = await staff.rpc("find_possible_duplicates", {
  p_first_names: "Zanele",
  p_surname: `Vtest${run}`,
  p_date_of_birth: "1991-03-05",
  p_phone: `062${run.slice(-7)}`,
  p_limit: 10,
  p_email: "",
  p_address: `9 Beta Road, Pretoria ${run}`,
});
assert.ifError(p2Candidates.error);
assert.deepEqual(p2Candidates.data.map((c) => c.id), [p1.id], "P2 should softly match exactly P1");
assert.equal(p2Candidates.data[0].match_tier, "likely", "Name + DOB must be a likely duplicate");

const p2 = await onboard({
  first_names: "Zanele",
  surname: `Vtest${run}`,
  date_of_birth: "1991-03-05",
  identity_type: "none",
  identity_number: "",
  identity_country: "",
  no_identity_reason: "Documents left at home (verify script)",
  phone: `062${run.slice(-7)}`,
  email: "",
  residential_address: `9 Beta Road, Pretoria ${run}`,
  file_number: "",
}, [p1.id]);

// Possible pair: different names and birth dates, shared phone + address.
const sharedPhone = `071${run.slice(-7)}`;
const sharedAddress = `${run} Verification Road, Polokwane`;
const p3 = await onboard({
  first_names: "Sipho",
  surname: `Wtest${run}A`,
  date_of_birth: "1984-07-19",
  identity_type: "none",
  identity_number: "",
  identity_country: "",
  no_identity_reason: "Asylum papers pending (verify script)",
  phone: sharedPhone,
  email: `sipho${run}@example.test`,
  residential_address: sharedAddress,
  file_number: "",
});

const p4Candidates = await staff.rpc("find_possible_duplicates", {
  p_first_names: "Thandi",
  p_surname: `Wtest${run}B`,
  p_date_of_birth: "1979-11-02",
  p_phone: sharedPhone,
  p_limit: 10,
  p_email: "",
  p_address: sharedAddress,
});
assert.ifError(p4Candidates.error);
assert.deepEqual(p4Candidates.data.map((c) => c.id), [p3.id], "P4 should softly match exactly P3");
assert.equal(p4Candidates.data[0].match_score, 2);
assert.equal(p4Candidates.data[0].match_tier, "possible", "Phone + address alone must only ever be possible");

const p4 = await onboard({
  first_names: "Thandi",
  surname: `Wtest${run}B`,
  date_of_birth: "1979-11-02",
  identity_type: "none",
  identity_number: "",
  identity_country: "",
  no_identity_reason: "Registered without documents (verify script)",
  phone: sharedPhone,
  email: "",
  residential_address: sharedAddress,
  file_number: "",
}, [p3.id]);

// A phone match alone stays below the flagging threshold.
const weakOnly = await staff.rpc("find_possible_duplicates", {
  p_first_names: "Unrelated",
  p_surname: `Nomatch${run}`,
  p_date_of_birth: "1955-01-01",
  p_phone: sharedPhone,
  p_limit: 10,
});
assert.ifError(weakOnly.error);
assert.ok(
  !weakOnly.data.some((c) => [p3.id, p4.id].includes(c.id)),
  "A single weak field (phone) must not flag",
);

// --- Duplicates queue: tiers and ordering -------------------------------
function pairOf(review, a, b) {
  const ids = [review.patient.id, review.candidate.id];
  return ids.includes(a.id) && ids.includes(b.id);
}

let queue = await staff.rpc("list_duplicate_reviews");
assert.ifError(queue.error);
const likelyIdx = queue.data.findIndex((review) => pairOf(review, p1, p2));
const possibleIdx = queue.data.findIndex((review) => pairOf(review, p3, p4));
assert.ok(likelyIdx >= 0, "Likely pair missing from the queue");
assert.ok(possibleIdx >= 0, "Possible pair missing from the queue");
assert.equal(queue.data[likelyIdx].match_tier, "likely");
assert.deepEqual(queue.data[likelyIdx].match_reasons, ["name", "date of birth"]);
assert.equal(queue.data[possibleIdx].match_tier, "possible");
assert.deepEqual(queue.data[possibleIdx].match_reasons, ["phone", "address"]);
assert.ok(likelyIdx < possibleIdx, "Likely pairs must be ordered above possible pairs");
assert.ok(!("identity_number" in queue.data[likelyIdx].patient), "Queue leaked a full identity number");

// --- Keep both persists, and edits re-open the pair ---------------------
const keepBoth = await staff.rpc("resolve_duplicate", {
  p_patient_id: p3.id,
  p_candidate_id: p4.id,
  p_reason: "Housemates sharing one phone, confirmed in person",
});
assert.ifError(keepBoth.error);

queue = await staff.rpc("list_duplicate_reviews");
assert.equal(queue.data.findIndex((review) => pairOf(review, p3, p4)), -1, "Dismissed pair still flagged");

// Second resolution of the same pair fails gracefully (nothing left flagged).
const doubleResolve = await staff.rpc("resolve_duplicate", {
  p_patient_id: p3.id,
  p_candidate_id: p4.id,
  p_reason: "Trying to resolve the same pair twice",
});
assert.equal(doubleResolve.error?.code, "P0002", "Double keep-both should fail with P0002");

// Editing a matched field (email now matches P3) re-opens the dismissed pair.
const editP4 = await staff.rpc("update_patient", {
  p_id: p4.id,
  p_patient: {
    file_number: p4.file_number,
    first_names: p4.first_names,
    surname: p4.surname,
    date_of_birth: p4.date_of_birth,
    identity_type: "none",
    identity_number: "",
    identity_country: "",
    no_identity_reason: p4.no_identity_reason,
    phone: p4.phone,
    email: p3.email,
    residential_address: p4.residential_address,
  },
});
assert.ifError(editP4.error);

queue = await staff.rpc("list_duplicate_reviews");
const reopened = queue.data.find((review) => pairOf(review, p3, p4));
assert.ok(reopened, "Edited dismissed pair was not re-flagged");
assert.match(reopened.review_reason, /details changed/i);

// --- Merge: union of data, alias search, archival ------------------------
// Survivor P2 has no document and no email; source P1 has both. The merge
// must produce the union.
const merge = await staff.rpc("merge_patients", { p_survivor_id: p2.id, p_source_id: p1.id });
assert.ifError(merge.error);
assert.equal(merge.data[0].patient_id, p2.id);
assert.deepEqual(new Set(merge.data[0].fields_copied), new Set(["email", "identity document"]));

const survivorRow = await staff.from("patients").select("*").eq("id", p2.id).single();
assert.ifError(survivorRow.error);
assert.equal(survivorRow.data.status, "active");
assert.equal(survivorRow.data.identity_type, "sa_id");
assert.equal(survivorRow.data.identity_number, p1.identity_number, "Identity document did not move to the survivor");
assert.equal(survivorRow.data.email, p1.email, "Email did not move to the survivor");

const sourceRow = await staff.from("patients").select("*").eq("id", p1.id).single();
assert.ifError(sourceRow.error);
assert.equal(sourceRow.data.status, "archived");
assert.equal(sourceRow.data.merged_into, p2.id);
assert.ok(sourceRow.data.archived_at, "Archived source has no archived_at");
assert.equal(sourceRow.data.identity_type, "none", "Source should no longer hold the identity document");

// Old file number finds the survivor; the archived record is excluded.
const aliasSearch = await staff.rpc("search_patients", { p_query: p1.file_number, p_limit: 25, p_offset: 0 });
assert.ifError(aliasSearch.error);
const aliasIds = aliasSearch.data.patients.map((row) => row.id);
assert.ok(aliasIds.includes(p2.id), "Searching the archived file number must return the survivor");
assert.ok(!aliasIds.includes(p1.id), "Archived records must not appear in search results");

const defaultList = await staff.rpc("search_patients", { p_query: `Vtest${run}`, p_limit: 25, p_offset: 0 });
assert.ifError(defaultList.error);
assert.deepEqual(defaultList.data.patients.map((row) => row.id), [p2.id], "Only the survivor should be listed");
assert.equal(defaultList.data.patients[0].duplicate_tier, null, "Merged pair must no longer flag the survivor");

// Alias + consent + audit survive on the right records.
const alias = await staff.from("patient_aliases").select("alias_file_number, source_patient_id").eq("patient_id", p2.id);
assert.ifError(alias.error);
assert.deepEqual(alias.data.map((row) => row.alias_file_number), [p1.file_number]);

const sourceConsent = await staff.from("patient_consents").select("id").eq("patient_id", p1.id);
assert.ifError(sourceConsent.error);
assert.equal(sourceConsent.data.length, 1, "The archived source must keep its consent record");

const auditMerged = await staff.from("audit_events").select("action, metadata").eq("patient_id", p2.id).eq("action", "patient_merged");
assert.ifError(auditMerged.error);
assert.equal(auditMerged.data.length, 1, "Merge audit event missing");
assert.equal(auditMerged.data[0].metadata.source_file_number, p1.file_number);

const auditArchived = await staff.from("audit_events").select("action").eq("patient_id", p1.id).eq("action", "patient_archived");
assert.ifError(auditArchived.error);
assert.equal(auditArchived.data.length, 1, "Archive audit event missing");

// --- Guards ----------------------------------------------------------------
// A second merge of the same pair fails gracefully (already resolved).
const doubleMerge = await staff.rpc("merge_patients", { p_survivor_id: p2.id, p_source_id: p1.id });
assert.equal(doubleMerge.error?.code, "55000", "Second merge should fail with 55000");

// Archived records are read only.
const editArchived = await staff.rpc("update_patient", {
  p_id: p1.id,
  p_patient: {
    file_number: `${p1.file_number}-edited`,
    first_names: p1.first_names,
    surname: p1.surname,
    date_of_birth: p1.date_of_birth,
    identity_type: "none",
    identity_number: "",
    identity_country: "",
    no_identity_reason: "Attempted edit of archived record",
    phone: p1.phone,
    email: "",
    residential_address: p1.residential_address,
  },
});
assert.equal(editArchived.error?.code, "55000", "Editing an archived record must be refused");

// No hard-delete path exists any more.
const deleteRpc = await staff.rpc("delete_patient", { p_id: p2.id, p_reason: "should not exist" });
assert.ok(deleteRpc.error, "delete_patient should no longer exist");

console.log(
  "Merge verification passed: weighted tiers and ordering, keep-both persistence and re-flag on edit, " +
  "merge union of data, alias search, archival with consent/audit intact, concurrency and read-only guards, no delete path.",
);
