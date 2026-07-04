export function isDemoMode(): boolean {
  return process.env.DRRG_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}
export function hasSupabaseEnvironment(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requireSupabaseEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("DRRG Supabase environment variables are not configured.");
  }

  return { url, key };
}
