import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and enforces
 * role-based routing rules.
 *
 * Route policy:
 *   /login, /signup        -> public; logged-in users get bounced to their dashboard
 *   /professor/*           -> requires role = 'professor'
 *   /student/*             -> requires role = 'student'
 *   /                      -> redirects to dashboard (or /login)
 *   everything else        -> public
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: this call refreshes the session if needed; do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isProfessor = pathname.startsWith("/professor");
  const isStudent = pathname.startsWith("/student");
  const isProfile = pathname.startsWith("/profile");
  const isRoot = pathname === "/";

  // Anything inside /professor, /student, or /profile requires a session.
  // The landing page (/) is public.
  if (!user && (isProfessor || isStudent || isProfile)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // /profile is shared between roles — let any logged-in user view it.
  if (user && isProfile) {
    return response;
  }

  // Logged-in users skip the landing + auth pages and go straight to
  // their dashboard.
  if (user && (isAuthPage || isRoot || isProfessor || isStudent)) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role as "professor" | "student" | undefined;
    const home = role === "professor" ? "/professor" : "/student";

    if (isAuthPage || isRoot) {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return NextResponse.redirect(url);
    }

    // Wrong-role enforcement: a student visiting /professor/* and vice-versa.
    if (isProfessor && role !== "professor") {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return NextResponse.redirect(url);
    }
    if (isStudent && role !== "student") {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return NextResponse.redirect(url);
    }
  }

  return response;
}
