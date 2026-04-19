import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { StudentRibbon } from "@/components/StudentRibbon";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { buildGroups, cellHex } from "@/lib/ribbon";
import { MasteryControls } from "./MasteryControls";
import { RealtimeRibbonRefresher } from "@/components/RealtimeRibbonRefresher";

type Params = { id: string };

export default async function StudentCourseDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS gates this read on is_enrolled(id), so a non-enrolled student
  // gets back nothing → 404.
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("id", id)
    .single();
  if (!course) notFound();

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
      .select("id, label, concept_id, lecture_id"),
    supabase
      .from("user_subconcept_mastery")
      .select("subconcept_id, score")
      .eq("user_id", user!.id),
  ]);

  // Filter mastery to only this course's subconcepts so the hero stats are
  // about the course you're looking at — not the union of every course this
  // student is enrolled in.
  const courseSubIds = new Set(
    (subconceptRows ?? []).map((s) => s.id as string)
  );
  const masteryHere = (masteryRows ?? []).filter((m) =>
    courseSubIds.has(m.subconcept_id as string)
  );
  const avg =
    masteryHere.length > 0
      ? masteryHere.reduce((s, m) => s + m.score, 0) / masteryHere.length
      : null;
  const weakCount = masteryHere.filter((m) => m.score < 0.4).length;
  const strongCount = masteryHere.filter((m) => m.score > 0.7).length;

  const concepts = (conceptRows ?? []).map((c) => ({
    id: c.id,
    label: c.label,
  }));
  const lectures = (lectureRows ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    // Sort key for chronological ordering within a concept group. Fall back
    // to created_at when started_at is missing.
    orderKey: l.started_at ?? l.created_at ?? "",
  }));
  const masteryById = new Map<string, number>(
    (masteryRows ?? []).map((m) => [m.subconcept_id, m.score])
  );
  const groups = buildGroups(
    concepts,
    (subconceptRows ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      concept_id: s.concept_id,
      lecture_id: s.lecture_id,
    })),
    lectures,
    (sid) => masteryById.get(sid) ?? null
  );

  // Pre-render the +/- buttons per subconcept so we can pass them across the
  // server→client boundary as JSX (functions aren't serializable, JSX is).
  const cellActions: Record<string, React.ReactNode> = Object.fromEntries(
    (subconceptRows ?? []).map((s) => [
      s.id,
      <MasteryControls
        key={s.id}
        courseId={course.id}
        subconceptId={s.id}
      />,
    ])
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <RealtimeRibbonRefresher scopeId={`student-${course.id}-${user!.id}`} />
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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-12 pb-20">
        <Link
          href="/student"
          className="mb-6 inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          ← Back to courses
        </Link>

        <section>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            {course.code}
          </p>
          <h1 className="mt-2 font-inter text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {course.name}
          </h1>
          <p className="mt-3 text-base text-muted">
            Your personal mastery across every concept in this course.
          </p>

          {/* Quick-glance summary: avg mastery, plus how many subconcepts
              are still shaky vs locked in. Mirrors the prof's per-student
              detail page so the visual language is consistent. */}
          <dl className="mt-8 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-background">
            <Stat
              label="Avg mastery"
              value={avg === null ? "—" : avg.toFixed(2)}
              swatch={avg}
            />
            <Stat
              label="Weak"
              value={String(weakCount)}
              hint="< 0.40"
              divided
            />
            <Stat
              label="Strong"
              value={String(strongCount)}
              hint="> 0.70"
              divided
            />
          </dl>
        </section>

        <section className="mt-14">
          <div className="flex items-end justify-between">
            <h2 className="font-inter text-2xl font-semibold tracking-tight text-foreground">
              Your ribbon
            </h2>
            <p className="text-xs text-muted">
              Click any cell to see who can stitch with you.
            </p>
          </div>
          <div className="mt-6">
            <StudentRibbon
              courseId={course.id}
              groups={groups}
              cellActions={cellActions}
              caption="Your mastery"
              emptyState={
                <>
                  <p className="text-sm text-muted">
                    Your professor hasn&apos;t added any lectures yet.
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Once they do, your personal ribbon renders here.
                  </p>
                </>
              }
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  swatch,
  divided,
}: {
  label: string;
  value: string;
  hint?: string;
  swatch?: number | null;
  divided?: boolean;
}) {
  return (
    <div className={`px-6 py-5 ${divided ? "border-l border-border" : ""}`}>
      <dt className="text-xs uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        {swatch !== undefined && swatch !== null && (
          <span
            className="block h-3.5 w-3.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: cellHex(swatch) }}
          />
        )}
        <span className="font-display text-3xl font-medium tracking-tight text-foreground">
          {value}
        </span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
