import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "../(auth)/actions";
import { JoinCourseForm } from "./JoinCourseForm";

interface StudentHomeProps {
  searchParams: Promise<{ spaceError?: string }>;
}

export default async function StudentHome({ searchParams }: StudentHomeProps) {
  const { spaceError } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS on `courses` for students = is_enrolled(id), so this naturally
  // returns only the courses this student has joined.
  const [{ data: profile }, { data: courses }, { data: spaceMembers }] =
    await Promise.all([
      supabase
        .from("users")
        .select("name, email")
        .eq("id", user!.id)
        .single(),
      supabase
        .from("courses")
        .select("id, code, name")
        .order("code", { ascending: true }),
      supabase
        .from("stitch_space_members")
        .select("space_id, stitch_spaces!inner(id, status, course_id, created_at)")
        .eq("user_id", user!.id),
    ]);

  // Filter to in-progress rooms (status='active') and pull a course label
  // for each. Admin client only needed if we want partner names — skipped
  // here, the room itself shows them.
  type SpaceRow = {
    id: string;
    status: string;
    course_id: string;
    created_at: string;
  };
  const openSpaces: SpaceRow[] = ((spaceMembers ?? [])
    .map((r) =>
      Array.isArray(r.stitch_spaces) ? r.stitch_spaces[0] : r.stitch_spaces
    )
    .filter(
      (s): s is SpaceRow => !!s && (s as SpaceRow).status === "active"
    )) as SpaceRow[];

  let courseLabelById = new Map<string, string>();
  if (openSpaces.length > 0) {
    const admin = createAdminClient();
    const { data: courseRows } = await admin
      .from("courses")
      .select("id, code, name")
      .in(
        "id",
        openSpaces.map((s) => s.course_id)
      );
    courseLabelById = new Map(
      (courseRows ?? []).map((c) => [
        c.id as string,
        `${c.code as string} · ${c.name as string}`,
      ])
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
            >
              Profile
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
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

        {spaceError && (
          <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Couldn&apos;t start a Stitch Space: {spaceError}
          </div>
        )}

        {openSpaces.length > 0 && (
          <section className="mt-10">
            <h2 className="text-base font-medium text-foreground">
              Open Stitch Spaces
            </h2>
            <ul className="mt-3 space-y-2">
              {openSpaces.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/space/${s.id}`}
                    className="flex items-center justify-between rounded-2xl border border-foreground/30 bg-foreground/5 px-5 py-4 transition-colors hover:bg-foreground/10"
                  >
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">
                        Live session
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                        {courseLabelById.get(s.course_id) ?? "Course"}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 rounded-lg bg-foreground px-3 py-1 text-xs font-medium text-background">
                      Join →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

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
