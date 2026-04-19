import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { CreateCourseForm } from "./CreateCourseForm";

export default async function ProfessorHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: courses }] = await Promise.all([
    supabase
      .from("users")
      .select("name, email")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("courses")
      .select("id, code, name, status, join_code, created_at")
      .eq("professor_id", user!.id)
      .order("created_at", { ascending: false }),
  ]);

  // Per-course enrollment + lecture counts so each card carries some weight.
  // n is small (a professor's course list), so per-course parallel queries
  // are fine — no need for a SQL aggregate function here.
  const counts = await Promise.all(
    (courses ?? []).map(async (c) => {
      const [students, lectures] = await Promise.all([
        supabase
          .from("enrollments")
          .select("user_id", { count: "exact", head: true })
          .eq("course_id", c.id),
        supabase
          .from("lectures")
          .select("id", { count: "exact", head: true })
          .eq("course_id", c.id),
      ]);
      return {
        id: c.id,
        students: students.count ?? 0,
        lectures: lectures.count ?? 0,
      };
    })
  );
  const countById = new Map(counts.map((c) => [c.id, c]));

  const totalStudents = counts.reduce((sum, c) => sum + c.students, 0);
  const totalLectures = counts.reduce((sum, c) => sum + c.lectures, 0);
  const courseCount = courses?.length ?? 0;
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
            Professor
          </p>
          <h1 className="mt-2 font-display text-5xl font-medium tracking-tight text-foreground sm:text-6xl">
            Welcome back, {firstName}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Manage your courses, lectures, and student progress all in one
            place.
          </p>

          <dl className="mt-10 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-background">
            <Stat label="Courses" value={courseCount} />
            <Stat label="Students" value={totalStudents} divided />
            <Stat label="Lectures" value={totalLectures} divided />
          </dl>
        </section>

        <section className="mt-16">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">
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
              {courses.map((c) => {
                const stat = countById.get(c.id);
                return (
                  <li key={c.id}>
                    <CourseCard
                      href={`/professor/courses/${c.id}`}
                      code={c.code}
                      name={c.name}
                      status={c.status}
                      joinCode={c.join_code}
                      students={stat?.students ?? 0}
                      lectures={stat?.lectures ?? 0}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-border bg-zinc-50/60 px-6 py-16 text-center">
              <p className="font-display text-2xl font-medium text-foreground">
                No courses yet
              </p>
              <p className="mt-2 text-sm text-muted">
                Create your first course below to get started.
              </p>
            </div>
          )}
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">
            Create a new course
          </h2>
          <CreateCourseForm />
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
    <div
      className={`px-6 py-5 ${divided ? "border-l border-border" : ""}`}
    >
      <dt className="text-xs uppercase tracking-[0.16em] text-muted">
        {label}
      </dt>
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
  status,
  joinCode,
  students,
  lectures,
}: {
  href: string;
  code: string;
  name: string;
  status: string;
  joinCode: string | null;
  students: number;
  lectures: number;
}) {
  const isPublished = status === "published";
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-3xl border border-border bg-background p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-display text-3xl font-medium tracking-tight text-foreground">
          {code}
        </span>
        <StatusPill status={status} />
      </div>
      <p className="mt-3 line-clamp-2 text-base font-medium text-foreground">
        {name}
      </p>
      {isPublished && joinCode && (
        <p className="mt-2 text-xs text-muted">
          Join code{" "}
          <span className="font-mono tracking-wider text-foreground">
            {joinCode}
          </span>
        </p>
      )}

      <div className="mt-auto flex items-center justify-between pt-8">
        <div className="flex items-center gap-5 text-sm text-muted">
          <span>
            <span className="font-medium text-foreground">{students}</span>{" "}
            {students === 1 ? "student" : "students"}
          </span>
          <span>
            <span className="font-medium text-foreground">{lectures}</span>{" "}
            {lectures === 1 ? "lecture" : "lectures"}
          </span>
        </div>
        <span className="text-foreground transition-transform duration-200 group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: string }) {
  const isPublished = status === "published";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        isPublished
          ? "bg-emerald-50 text-emerald-700"
          : "bg-zinc-100 text-zinc-600"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isPublished ? "bg-emerald-500" : "bg-zinc-400"
        }`}
      />
      {isPublished ? "Published" : status}
    </span>
  );
}
