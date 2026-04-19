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

  // Pull the basics in parallel. RLS on `courses` for students = is_enrolled(id),
  // so this naturally returns only the courses this student has joined.
  const [
    { data: profile },
    { data: courses },
    { data: spaceMembers },
    { data: masteryRows },
  ] = await Promise.all([
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
    supabase
      .from("user_subconcept_mastery")
      .select("score")
      .eq("user_id", user!.id),
  ]);

  // Filter to in-progress rooms (status='active') and pull a course label
  // for each. Admin client only needed to look up the course label since
  // we don't need member names on this list view.
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

  const courseCount = courses?.length ?? 0;
  const liveCount = openSpaces.length;
  // "Strong areas" = subconcepts the student is comfortably above the
  // matcher's strong threshold on. Single-number summary that gives the
  // home page a third stat without a second query.
  const strongCount = (masteryRows ?? []).filter((m) => m.score > 0.7).length;
  const firstName = (profile?.name || profile?.email || "").split(/[\s@]/)[0];

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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-16 pb-20">
        <section>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Student
          </p>
          <h1 className="mt-2 font-inter text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
            Hi, {firstName}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Your courses, your ribbon, and any live Stitch Spaces in one
            place.
          </p>

          <dl className="mt-10 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-background">
            <Stat label="Courses" value={courseCount} />
            <Stat label="Live sessions" value={liveCount} divided />
            <Stat label="Strong areas" value={strongCount} divided />
          </dl>
        </section>

        {spaceError && (
          <div className="mt-8 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Couldn&apos;t start a Stitch Space: {spaceError}
          </div>
        )}

        {openSpaces.length > 0 && (
          <section className="mt-16">
            <div className="flex items-end justify-between">
              <h2 className="font-inter text-2xl font-semibold tracking-tight text-foreground">
                Open Stitch Spaces
              </h2>
              <span className="text-sm text-muted">
                {liveCount} live now
              </span>
            </div>

            <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              {openSpaces.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/space/${s.id}`}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 transition-colors hover:bg-emerald-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {/* Pulsing live dot — same chip-style cue used in the
                          inspo: a colored dot + a label, in the green slot. */}
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-700">
                          Live session
                        </p>
                        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                          {courseLabelById.get(s.course_id) ?? "Course"}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity group-hover:opacity-90">
                      Join →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-16">
          <div className="flex items-end justify-between">
            <h2 className="font-inter text-2xl font-semibold tracking-tight text-foreground">
              Your courses
            </h2>
            {courseCount > 0 && (
              <span className="text-sm text-muted">
                {courseCount} {courseCount === 1 ? "course" : "courses"}
              </span>
            )}
          </div>

          {courses && courses.length > 0 ? (
            <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {courses.map((c) => (
                <li key={c.id}>
                  <CourseCard
                    href={`/student/courses/${c.id}`}
                    code={c.code}
                    name={c.name}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-border bg-zinc-50/60 px-6 py-16 text-center">
              <p className="font-display text-2xl font-medium text-foreground">
                No courses yet
              </p>
              <p className="mt-2 text-sm text-muted">
                Join one with the code below to get started.
              </p>
            </div>
          )}
        </section>

        <section className="mt-12">
          <h2 className="font-inter text-2xl font-semibold tracking-tight text-foreground">
            Join a course
          </h2>
          <JoinCourseForm />
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  divided,
}: {
  label: string;
  value: number;
  divided?: boolean;
}) {
  return (
    <div className={`px-6 py-5 ${divided ? "border-l border-border" : ""}`}>
      <dt className="text-xs uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-medium tracking-tight text-foreground">
        {value}
      </dd>
    </div>
  );
}

function CourseCard({
  href,
  code,
  name,
}: {
  href: string;
  code: string;
  name: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-3xl border border-border bg-background p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
    >
      <span className="font-display text-3xl font-medium tracking-tight text-foreground">
        {code}
      </span>
      <p className="mt-3 line-clamp-2 text-base font-medium text-foreground">
        {name}
      </p>

      <div className="mt-auto flex items-center justify-between pt-8">
        <span className="text-sm text-muted">Open ribbon</span>
        <span className="text-foreground transition-transform duration-200 group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </Link>
  );
}
