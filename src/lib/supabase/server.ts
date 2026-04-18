import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components, Server Actions
 * and Route Handlers. Reads the auth session from cookies.
 *
 * Uses the publishable / anon key (RLS still applies as the user).
 * For RLS-bypassing operations (LLM extraction pipelines), use
 * `createAdminClient()` from ./admin instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — Next.js disallows
            // writing cookies here. The middleware refreshes the
            // session, so this is safe to ignore.
          }
        },
      },
    }
  );
}
