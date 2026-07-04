import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const email = process.env.LOCAL_STAFF_EMAIL ?? "doctor@drrg.local";
const password = process.env.LOCAL_STAFF_PASSWORD ?? "LocalTest123!";

assert(url?.startsWith("http://127.0.0.1:"), "This script only supports local Supabase.");
assert(secretKey, "SUPABASE_SECRET_KEY is required");

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
assert.ifError(listed.error);
let user = listed.data.users.find((candidate) => candidate.email === email);

if (!user) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  user = created.data.user;
}

assert(user, "Local staff user was not created");
const profile = await admin.from("profiles").upsert({
  user_id: user.id,
  display_name: "Dr Refiloe G",
  role: "doctor",
  active: true,
});
assert.ifError(profile.error);

console.log(`Local staff ready: ${email}`);
