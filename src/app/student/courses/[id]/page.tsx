import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { StudentRibbon } from "@/components/StudentRibbon";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { buildGroups } from "@/lib/ribbon";
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

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pt-16 pb-16">
        <Link
          href="/student"
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

        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-medium text-foreground">
              Your ribbon
            </h2>
            <p className="text-xs text-muted">
              Click any cell for the subconcept breakdown.
            </p>
          </div>
          <div className="mt-3">
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
