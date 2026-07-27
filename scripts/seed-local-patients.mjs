// Seed a demo set of cash patients into the LOCAL database, including two
// intentional soft-duplicate pairs so the "Possible duplicates" queue has data.
// Usage (env from .env.local):
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/seed-local-patients.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const email = process.env.LOCAL_STAFF_EMAIL ?? "doctor@drrg.local";
const password = process.env.LOCAL_STAFF_PASSWORD ?? "LocalTest123!";

assert(url?.startsWith("http://127.0.0.1:"), "This script only supports local Supabase.");
assert(publishableKey, "SUPABASE_PUBLISHABLE_KEY is required");

const consent = {
  consent_version: "1.0",
  consent_text_hash: "386a4fa9ec06aa3396bbb324dcb16c71ded4cf68bc0777da64ccce31f3471128",
  signature_type: "typed_name",
  signature_value: "Seed Signature",
  patient_present_attestation: true,
};

// Compute the SA ID check digit so seeded IDs pass the app's validation too.
function saId(twelve) {
  const d = twelve.split("").map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8] + d[10];
  const evenNumber = Number(`${d[1]}${d[3]}${d[5]}${d[7]}${d[9]}${d[11]}`);
  const evenSum = String(evenNumber * 2).split("").reduce((s, x) => s + Number(x), 0);
  const check = (10 - ((oddSum + evenSum) % 10)) % 10;
  return twelve + String(check);
}

const staff = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const signIn = await staff.auth.signInWithPassword({ email, password });
assert.ifError(signIn.error);

// Registered in order. Any patient that softly matches an already-registered one
// is onboarded WITH the match as a reviewed candidate, which flags the pair.
const patients = [
  { first_names: "Nomsa", surname: "Dlamini", date_of_birth: "1987-04-12", identity_type: "sa_id", identity_number: saId("870412500908"), phone: "082 345 6789", email: "nomsa.dlamini@example.com", residential_address: "14 Acacia Road, Soweto", file_number: "" },
  { first_names: "Sipho", surname: "Mthembu", date_of_birth: "1992-11-03", identity_type: "passport", identity_number: "A9201135", identity_country: "ZW", phone: "076 123 4567", email: "", residential_address: "22 Marabastad, Pretoria", file_number: "" },
  { first_names: "Bongani", surname: "Mokoena", date_of_birth: "1983-07-08", identity_type: "none", no_identity_reason: "Passport application pending at Home Affairs", phone: "079 321 0987", email: "", residential_address: "8 Vilakazi Street, Orlando", file_number: "CASH-1007" },
  { first_names: "Lerato", surname: "Khumalo", date_of_birth: "1995-09-30", identity_type: "sa_id", identity_number: saId("950930500808"), phone: "083 777 1234", email: "lerato.k@example.com", residential_address: "5 Church Street, Polokwane", file_number: "" },
  { first_names: "Johannes", surname: "Botha", date_of_birth: "1978-01-15", identity_type: "sa_id", identity_number: saId("780115500808"), phone: "084 555 9090", email: "", residential_address: "31 Loop Street, Bloemfontein", file_number: "CASH-2210" },

  // Pair 1: same name + date of birth (classic duplicate), different phone/document.
  { first_names: "Thabo", surname: "Nkosi", date_of_birth: "1990-06-21", identity_type: "sa_id", identity_number: saId("900621500808"), phone: "071 987 6543", email: "", residential_address: "3 Long Street, Durban", file_number: "" },
  { first_names: "Thabo", surname: "Nkosi", date_of_birth: "1990-06-21", identity_type: "none", no_identity_reason: "ID card lost, affidavit provided", phone: "071 000 1111", email: "", residential_address: "3 Long Street, Durban", file_number: "" },

  // Pair 2: returning patient, same mobile number but mistyped/changed details.
  { first_names: "Ayanda", surname: "Zulu", date_of_birth: "1985-02-14", identity_type: "sa_id", identity_number: saId("850214500808"), phone: "082 111 2222", email: "ayanda.zulu@example.com", residential_address: "77 Beach Road, Gqeberha", file_number: "" },
  { first_names: "Andile", surname: "Zulu", date_of_birth: "1988-08-08", identity_type: "none", no_identity_reason: "Registering on behalf, documents to follow", phone: "082 111 2222", email: "", residential_address: "77 Beach Road, Gqeberha", file_number: "" },
];

let created = 0;
let flagged = 0;
for (const p of patients) {
  const candidates = await staff.rpc("find_possible_duplicates", {
    p_first_names: p.first_names,
    p_surname: p.surname,
    p_date_of_birth: p.date_of_birth,
    p_phone: p.phone,
    p_limit: 10,
    p_email: p.email ?? "",
    p_address: p.residential_address,
  });
  assert.ifError(candidates.error);
  const candidateIds = (candidates.data ?? []).map((c) => c.id);
  const reason = candidateIds.length
    ? "Confirmed a different patient at reception during registration (seed data)."
    : "";

  const result = await staff.rpc("onboard_patient", {
    p_patient: {
      first_names: p.first_names,
      surname: p.surname,
      date_of_birth: p.date_of_birth,
      identity_type: p.identity_type,
      identity_number: p.identity_number ?? "",
      identity_country: p.identity_country ?? "",
      no_identity_reason: p.no_identity_reason ?? "",
      phone: p.phone,
      email: p.email ?? "",
      residential_address: p.residential_address,
      file_number: p.file_number ?? "",
    },
    p_consent: consent,
    p_duplicate_candidate_ids: candidateIds,
    p_duplicate_review_reason: reason,
  });

  if (result.error) {
    console.warn(`skip ${p.first_names} ${p.surname}: ${result.error.message}`);
    continue;
  }
  created += 1;
  if (candidateIds.length) flagged += 1;
  const tag = candidateIds.length ? "  (flagged as possible duplicate)" : "";
  console.log(`+ ${result.data[0].file_number}  ${p.first_names} ${p.surname}${tag}`);
}

console.log(`\nSeeded ${created} patients, ${flagged} flagged for duplicate review.`);
