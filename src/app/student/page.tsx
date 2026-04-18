import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { JoinCourseForm } from "./JoinCourseForm";

export default async function StudentHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS on `courses` for students = is_enrolled(id), so this naturally
  // returns only the courses this student has joined.
  const [{ data: profile }, { data: courses }] = await Promise.all([
    supabase
      .from("users")
      .select("name, email")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("courses")
      .select("id, code, name")
      .order("code", { ascending: true }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
            >
              Profile
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-20 pb-16">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          Student
        </p>
        <h1 className="mt-1 font-display text-4xl tracking-tight text-foreground">
          {profile?.name || profile?.email}
        </h1>

        <section className="mt-12">
          <h2 className="text-base font-medium text-foreground">
            Your courses
          </h2>

          {courses && courses.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {courses.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/student/courses/${c.id}`}
                    className="flex items-center justify-between rounded-2xl border border-border bg-background px-5 py-4 transition-colors hover:bg-zinc-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        <span className="font-display text-base">
                          {c.code}
                        </span>{" "}
                        · {c.name}
                      </p>
                    </div>
                    <span className="text-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 rounded-2xl border border-border bg-zinc-50 px-5 py-8 text-center">
              <p className="text-sm text-muted">
                You aren&apos;t enrolled in any courses yet.
              </p>
            </div>
          )}

          <JoinCourseForm />
        </section>
      </main>
    </div>
  );
}
