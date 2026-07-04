import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type StaffIdentity = {
  userId: string;
  displayName: string;
  role: "doctor" | "staff";
};

export async function requireStaffPage(): Promise<StaffIdentity> {
  if (isDemoMode()) {
    return {
      userId: "demo-user",
      displayName: "Dr Refiloe G",
      role: "doctor",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role, active")
    .eq("user_id", data.user.id)
    .single();

  if (!profile?.active || !["doctor", "staff"].includes(profile.role)) {
    redirect("/login?error=access");
  }

  return {
    userId: data.user.id,
    displayName: profile.display_name,
    role: profile.role as StaffIdentity["role"],
  };
}
