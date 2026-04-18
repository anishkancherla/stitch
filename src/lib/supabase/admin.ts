import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client. Bypasses Row-Level Security entirely.
 *
 * NEVER import this from a Client Component or anything that ships to the
 * browser — it uses the service-role secret. Server-side only:
 * route handlers (`app/api/*`), server actions, cron jobs, etc.
 *
 * Used for the LLM extraction pipelines that need to read/write across
 * many users' rows (e.g. backfilling mastery, writing extracted concepts).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
