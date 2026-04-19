import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Ribbon } from "@/components/Ribbon";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { CourseTabs } from "../../CourseTabs";
import { buildGroups, cellHex } from "@/lib/ribbon";
import { RealtimeRibbonRefresher } from "@/components/RealtimeRibbonRefresher";

type Params = { id: string; studentId: string };

const WEAK_THRESHOLD = 0.4;
const STRONG_THRESHOLD = 0.7;

export default async function CourseStudentDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, studentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Same ownership gate as the other prof pages.
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name, professor_id")
    .eq("id", id)
    .single();
  if (!course || course.professor_id !== user!.id) notFound();

  // Verify the student is actually enrolled in *this* course before showing
  // anything. We also pull their display row in the same go.
  const { data: enrollmentRow } = await supabase
    .from("enrollments")
    .select("user_id, enrolled_at, users!inner(id, name, email)")
    .eq("course_id", id)
    .eq("user_id", studentId)
    .single();
  if (!enrollmentRow) notFound();
  const student = (enrollmentRow as unknown as {
    users: { id: string; name: string | null; email: string };
    enrolled_at: string;
  }).users;
  const enrolledAt = (enrollmentRow as unknown as { enrolled_at: string })
    .enrolled_at;

  const [
    { data: conceptRows },
    { data: lectureRows },
    { data: subconceptRows },
    { data: masteryRows },
  ] = await Promise.all([
    supabase
      .from("concepts")
      .select("id, label, position_y")
      .eq("course_id", id)
      .order("position_y", { ascending: true })
      .order("label", { ascending: true }),
    supabase
      .from("lectures")
      .select("id, title, started_at, created_at")
      .eq("course_id", id)
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("subconcepts")
      .select("id, label, concept_id, lecture_id, concepts!inner(course_id)")
      .eq("concepts.course_id", id),
    supabase
      .from("user_subconcept_mastery")
      .select("subconcept_id, score")
      .eq("user_id", studentId),
  ]);

  const subs = (subconceptRows ?? []) as Array<{
    id: string;
    label: string;
    concept_id: string;
    lecture_id: string | null;
  }>;
  const subById = new Map(subs.map((s) => [s.id, s]));

  const concepts = (conceptRows ?? []).map((c) => ({ id: c.id, label: c.label }));
  const lectures = (lectureRows ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    orderKey: l.started_at ?? l.created_at ?? "",
  }));

  // Filter mastery to only this course's subconcepts (the student may be
  // enrolled in other courses).
  const courseSubIds = new Set(subs.map((s) => s.id));
  const masteryHere = (masteryRows ?? []).filter((m) =>
    courseSubIds.has(m.subconcept_id)
  );
  const masteryById = new Map(masteryHere.map((m) => [m.subconcept_id, m.score]));

  const groups = buildGroups(
    concepts,
    subs.map((s) => ({
      id: s.id,
      label: s.label,
      concept_id: s.concept_id,
      lecture_id: s.lecture_id,
    })),
    lectures,
    (sid) => masteryById.get(sid) ?? null
  );

  // Top-3 weak / top-3 strong, computed off the raw mastery rows. Use stable
  // tie-break by label so re-renders don't reorder.
  const ranked = masteryHere
    .map((m) => ({ score: m.score, label: subById.get(m.subconcept_id)?.label ?? "—" }))
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  const weak = ranked.slice(0, 3);
  const strong = [...ranked].reverse().slice(0, 3);

  const avg =
    masteryHere.length > 0
      ? masteryHere.reduce((s, m) => s + m.score, 0) / masteryHere.length
      : null;
  const weakCount = masteryHere.filter((m) => m.score < WEAK_THRESHOLD).length;
  const strongCount = masteryHere.filter((m) => m.score > STRONG_THRESHOLD).length;

  const displayName = student.name ?? student.email.split("@")[0];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <RealtimeRibbonRefresher
        scopeId={`prof-student-${course.id}-${studentId}`}
      />
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
          <Link
            href={`/professor/courses/${course.id}/students`}
            className="text-sm text-muted hover:text-foreground"
          >
            ← All students
          </Link>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-foreground">
                {displayName}
              </h2>
              <p className="text-sm text-muted">{student.email}</p>
            </div>
            <p className="text-xs text-muted">
              Enrolled {new Date(enrolledAt).toLocaleDateString()}
            </p>
          </div>

          {/* Summary stats — three at-a-glance numbers above the ribbon. */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <StatCard
              label="Avg mastery"
              value={avg === null ? "—" : avg.toFixed(2)}
              swatch={avg}
            />
            <StatCard
              label="Weak items"
              value={String(weakCount)}
              hint={`< ${WEAK_THRESHOLD.toFixed(2)}`}
            />
            <StatCard
              label="Strong items"
              value={String(strongCount)}
              hint={`> ${STRONG_THRESHOLD.toFixed(2)}`}
            />
          </div>

          <div className="mt-8">
            <Ribbon
              groups={groups}
              caption={`${displayName}'s mastery`}
              emptyState={
                <p className="text-sm text-muted">
                  No subconcepts yet — once lectures are uploaded, this
                  student&apos;s ribbon will render here.
                </p>
              }
            />
          </div>

          {/* Weakness/strength lists. Helpful for the prof to scan at a glance
              before clicking into the ribbon for the full picture. */}
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <RankedList title="Top weak subconcepts" items={weak} />
            <RankedList title="Top strong subconcepts" items={strong} />
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  swatch,
}: {
  label: string;
  value: string;
  hint?: string;
  swatch?: number | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        {swatch !== undefined && swatch !== null && (
          <span
            className="block h-3.5 w-3.5 rounded-[3px]"
            style={{ backgroundColor: cellHex(swatch) }}
          />
        )}
        <span className="font-mono text-2xl text-foreground">{value}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    </div>
  );
}

function RankedList({
  title,
  items,
}: {
  title: string;
  items: Array<{ score: number; label: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.length === 0 ? (
          <li className="text-muted">No data yet.</li>
        ) : (
          items.map((it) => (
            <li
              key={it.label}
              className="flex items-center gap-2.5 text-foreground"
            >
              <span
                className="block h-3 w-3 shrink-0 rounded-[3px]"
                style={{ backgroundColor: cellHex(it.score) }}
              />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              <span className="font-mono text-xs text-muted">
                {it.score.toFixed(2)}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
