import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnvironment } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

export function createClient() {
  const { url, key } = requireSupabaseEnvironment();
  return createBrowserClient<Database>(url, key);
}
