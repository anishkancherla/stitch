import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { CourseTabs } from "../CourseTabs";
import { cellHex } from "@/lib/ribbon";

type Params = { id: string };

// Threshold below which we count a subconcept as "weak" for that student.
// Matches the Stitch planner's working definition so the count here is the
// same number the matcher uses to find pair candidates.
const WEAK_THRESHOLD = 0.4;

export default async function CourseStudents({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Ownership gate — same pattern as the overview page. Anyone who isn't the
  // prof for this course gets a 404.
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name, professor_id")
    .eq("id", id)
    .single();
  if (!course || course.professor_id !== user!.id) notFound();

  // Pull enrollments + the joined user row in one shot. The RLS policy
  // `users_prof_read_enrolled` (migration 0009) is what makes this join
  // visible to the prof.
  const { data: enrollmentRows } = await supabase
    .from("enrollments")
    .select("user_id, enrolled_at, users!inner(id, name, email)")
    .eq("course_id", id)
    .order("enrolled_at", { ascending: true });

  // Per-student mastery aggregates so the table can show avg + weak count.
  // We grab every (user_id, score) pair for subconcepts in this course and
  // bucket in-memory — cheaper than a per-row aggregate query, and the data
  // size is N_students × N_subconcepts which is small for a class.
  const { data: subRows } = await supabase
    .from("subconcepts")
    .select("id, concepts!inner(course_id)")
    .eq("concepts.course_id", id);
  const subIds = (subRows ?? []).map((s) => s.id);

  const { data: masteryRows } =
    subIds.length > 0
      ? await supabase
          .from("user_subconcept_mastery")
          .select("user_id, subconcept_id, score")
          .in("subconcept_id", subIds)
      : { data: [] as Array<{ user_id: string; subconcept_id: string; score: number }> };

  type Agg = { sum: number; n: number; weak: number };
  const aggByUser = new Map<string, Agg>();
  for (const m of masteryRows ?? []) {
    let a = aggByUser.get(m.user_id);
    if (!a) {
      a = { sum: 0, n: 0, weak: 0 };
      aggByUser.set(m.user_id, a);
    }
    a.sum += m.score;
    a.n += 1;
    if (m.score < WEAK_THRESHOLD) a.weak += 1;
  }

  type StudentRow = {
    id: string;
    name: string;
    email: string;
    avg: number | null;
    weak: number;
  };
  const students: StudentRow[] = ((enrollmentRows ?? []) as Array<{
    user_id: string;
    users: { id: string; name: string | null; email: string };
  }>).map((row) => {
    const a = aggByUser.get(row.user_id);
    return {
      id: row.user_id,
      name: row.users.name ?? row.users.email.split("@")[0],
      email: row.users.email,
      avg: a && a.n > 0 ? a.sum / a.n : null,
      weak: a?.weak ?? 0,
    };
  });
  // Sort by name (stable, alphabetical) so the roster reads naturally.
  students.sort((a, b) => a.name.localeCompare(b.name));

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

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pt-16 pb-16">
        <Link
          href="/professor"
          className="mb-4 text-sm text-muted hover:text-foreground"
        >
          ← Back to courses
        </Link>

        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl text-muted">
            {course.code}
          </span>
          <h1 className="font-display text-3xl tracking-tight text-foreground">
            {course.name}
          </h1>
        </div>

        <CourseTabs courseId={course.id} active="students" />

        <section className="mt-8">
          {students.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-zinc-50 px-5 py-12 text-center">
              <p className="text-sm text-muted">
                No students enrolled yet. Share the join code so they can hop
                in.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-background">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-zinc-50 text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 text-right font-medium">
                      Avg mastery
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      Weak items
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-b-0 transition-colors hover:bg-zinc-50/50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/professor/courses/${course.id}/students/${s.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted">{s.email}</td>
                      <td className="px-5 py-3 text-right">
                        {s.avg === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="block h-3 w-3 rounded-[3px]"
                              style={{ backgroundColor: cellHex(s.avg) }}
                            />
                            <span className="font-mono text-foreground">
                              {s.avg.toFixed(2)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-foreground">
                        {s.weak}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            Click a name to see that student&apos;s personal ribbon. &ldquo;Weak items&rdquo; are
            subconcepts where their mastery is below {WEAK_THRESHOLD.toFixed(2)} —
            the same threshold the Stitch matcher uses.
          </p>
        </section>
      </main>
    </div>
  );
}
