import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnvironment } from "@/lib/env";

export function createClient() {
  const { url, key } = requireSupabaseEnvironment();
  return createBrowserClient(url, key);
}
