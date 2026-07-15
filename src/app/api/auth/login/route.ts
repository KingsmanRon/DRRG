import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

const GENERIC_LOGIN_ERROR = "The email/practice number or password is incorrect.";

/**
 * Resolve a practice number to the account email using the service-role key.
 * Runs server-side only so practice-number-to-email mapping is never exposed
 * to unauthenticated clients. Returns null for unknown or inactive accounts.
 */
async function emailForPracticeNumber(practiceNumber: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;

  const admin = createSupabaseClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("practice_number", practiceNumber)
    .eq("active", true)
    .maybeSingle();
  if (!profile) return null;

  const { data } = await admin.auth.admin.getUserById(profile.user_id);
  return data?.user?.email ?? null;
}

export async function POST(request: NextRequest) {
  let body: { identifier?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password) {
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 400 });
  }

  let email = identifier;
  if (!identifier.includes("@")) {
    const digits = identifier.replace(/[\s-]/g, "");
    if (!/^[0-9]{4,12}$/.test(digits)) {
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }
    const resolved = await emailForPracticeNumber(digits);
    if (!resolved) {
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }
    email = resolved;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
