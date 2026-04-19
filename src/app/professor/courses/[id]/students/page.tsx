import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { signOut } from "@/app/(auth)/actions";
import { CourseTabs } from "../CourseTabs";
import { cellHex } from "@/lib/ribbon";
import {
  StudentAccordionRow,
  type StudentRowData,
  type TopicMastery,
} from "./StudentAccordionRow";

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

  // Ownership gate — same pattern as the overview page.
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name, professor_id")
    .eq("id", id)
    .single();
  if (!course || course.professor_id !== user!.id) notFound();

  // Pull enrollments + the joined user row in one shot.
  const { data: enrollmentRows } = await supabase
    .from("enrollments")
    .select("user_id, enrolled_at, users!inner(id, name, email)")
    .eq("course_id", id)
    .order("enrolled_at", { ascending: true });

  // Fetch subconcepts with their labels and parent concept labels so we can
  // build per-topic breakdowns for each student.
  const { data: subRows } = await supabase
    .from("subconcepts")
    .select("id, label, concept_id, concepts!inner(id, course_id, label)")
    .eq("concepts.course_id", id);

  type SubRow = {
    id: string;
    label: string;
    concept_id: string;
    concepts: { id: string; course_id: string; label: string };
  };

  type SubInfo = {
    id: string;
    label: string;
    conceptId: string;
    conceptLabel: string;
  };

  const subInfoMap = new Map<string, SubInfo>();
  // Track concept order (first-seen order from DB, stable across the page load).
  const conceptOrder: string[] = [];
  const conceptLabelMap = new Map<string, string>();

  for (const s of (subRows ?? []) as unknown as SubRow[]) {
    subInfoMap.set(s.id, {
      id: s.id,
      label: s.label,
      conceptId: s.concept_id,
      conceptLabel: s.concepts.label,
    });
    if (!conceptLabelMap.has(s.concept_id)) {
      conceptOrder.push(s.concept_id);
      conceptLabelMap.set(s.concept_id, s.concepts.label);
    }
  }

  const subIds = [...subInfoMap.keys()];

  // Paginated through fetchAllRows because Supabase PostgREST caps at 1000
  // rows — a class of N students × M subconcepts blows past that quickly.
  const { rows: masteryRows } =
    subIds.length > 0
      ? await fetchAllRows<{
          user_id: string;
          subconcept_id: string;
          score: number;
        }>(
          (from, to) =>
            supabase
              .from("user_subconcept_mastery")
              .select("user_id, subconcept_id, score")
              .in("subconcept_id", subIds)
              .range(from, to),
        )
      : {
          rows: [] as Array<{
            user_id: string;
            subconcept_id: string;
            score: number;
          }>,
        };

  // ---- Per-student aggregates ----
  type Agg = { sum: number; n: number; weak: number };
  const aggByUser = new Map<string, Agg>();

  // Per-student, per-concept breakdowns for the accordion.
  type TopicAgg = {
    sum: number;
    n: number;
    subconcepts: Array<{ id: string; label: string; score: number }>;
  };
  const topicsByUser = new Map<string, Map<string, TopicAgg>>();

  for (const m of masteryRows) {
    // Overall aggregate
    let a = aggByUser.get(m.user_id);
    if (!a) {
      a = { sum: 0, n: 0, weak: 0 };
      aggByUser.set(m.user_id, a);
    }
    a.sum += m.score;
    a.n += 1;
    if (m.score < WEAK_THRESHOLD) a.weak += 1;

    // Topic-level aggregate
    const info = subInfoMap.get(m.subconcept_id);
    if (info) {
      if (!topicsByUser.has(m.user_id)) topicsByUser.set(m.user_id, new Map());
      const topicMap = topicsByUser.get(m.user_id)!;
      if (!topicMap.has(info.conceptId)) {
        topicMap.set(info.conceptId, { sum: 0, n: 0, subconcepts: [] });
      }
      const ta = topicMap.get(info.conceptId)!;
      ta.sum += m.score;
      ta.n += 1;
      ta.subconcepts.push({ id: m.subconcept_id, label: info.label, score: m.score });
    }
  }

  // Supabase's generated types model `users!inner(...)` as a join array, but
  // at runtime an inner-join on a fk-to-one relationship returns a single
  // object. Cast through unknown so the runtime shape lines up.
  const students: StudentRowData[] = (
    (enrollmentRows ?? []) as unknown as Array<{
      user_id: string;
      users: { id: string; name: string | null; email: string };
    }>
  ).map((row) => {
    const a = aggByUser.get(row.user_id);
    const topicMap = topicsByUser.get(row.user_id);

    const topics: TopicMastery[] = conceptOrder.map((conceptId) => {
      const ta = topicMap?.get(conceptId);
      return {
        conceptId,
        conceptLabel: conceptLabelMap.get(conceptId) ?? conceptId,
        avg: ta && ta.n > 0 ? ta.sum / ta.n : null,
        subconcepts: ta?.subconcepts ?? [],
      };
    });

    return {
      id: row.user_id,
      name: row.users.name ?? row.users.email.split("@")[0],
      email: row.users.email,
      avg: a && a.n > 0 ? a.sum / a.n : null,
      weak: a?.weak ?? 0,
      topics,
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
                    <th className="px-4 py-3" aria-label="Expand" />
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <StudentAccordionRow
                      key={s.id}
                      student={s}
                      courseId={course.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            Click a name to see that student&apos;s full ribbon. Use the{" "}
            <span className="inline-block">▾</span> to preview per-topic mastery
            inline. &ldquo;Weak items&rdquo; are subconcepts below{" "}
            {WEAK_THRESHOLD.toFixed(2)} — the same threshold the Stitch matcher
            uses.
          </p>
        </section>
      </main>
    </div>
  );
}
