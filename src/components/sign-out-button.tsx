"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Demo mode or an unconfigured environment has no session to end.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className="button buttonSecondary" type="button" onClick={signOut} disabled={signingOut}>
      {signingOut ? "Signing out" : "Sign out"}
    </button>
  );
}
