import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StaffIdentity = {
  userId: string;
  displayName: string;
  role: "doctor" | "staff";
};

async function loadStaffIdentity(): Promise<
  | { kind: "staff"; staff: StaffIdentity }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "unauthenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role, active")
    .eq("user_id", data.user.id)
    .single();

  if (!profile?.active || !["doctor", "staff"].includes(profile.role)) {
    return { kind: "forbidden" };
  }

  return {
    kind: "staff",
    staff: {
      userId: data.user.id,
      displayName: profile.display_name,
      role: profile.role as StaffIdentity["role"],
    },
  };
}

/** Server Components / pages: redirect to login when unauthenticated or inactive. */
export async function requireStaffPage(): Promise<StaffIdentity> {
  const result = await loadStaffIdentity();
  if (result.kind !== "staff") redirect("/login?error=access");
  return result.staff;
}

/**
 * API routes: same staff gate as pages, returning JSON 401/403 instead of a redirect.
 * Database RPCs still enforce is_active_staff(); this gives clean client errors earlier.
 */
export async function requireStaffApi(): Promise<
  { staff: StaffIdentity; response?: never } | { staff?: never; response: NextResponse }
> {
  const result = await loadStaffIdentity();
  if (result.kind === "unauthenticated") {
    return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (result.kind === "forbidden") {
    return { response: NextResponse.json({ error: "Staff access required." }, { status: 403 }) };
  }
  return { staff: result.staff };
}
