import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Use inside Client Components
 * ("use client") for things like sign-in / sign-up forms.
 *
 * Uses the publishable / anon key, so RLS applies as the logged-in user.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
