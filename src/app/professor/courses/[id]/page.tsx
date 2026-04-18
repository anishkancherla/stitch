import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Heatmap } from "@/components/Heatmap";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { PublishButton } from "./PublishButton";
import { DeleteButton } from "./DeleteButton";
import {
  buildCells,
  type HeatmapConcept,
  type HeatmapLecture,
} from "@/lib/heatmap";

type Params = { id: string };
type Search = { metric?: string };

type Metric = "avg" | "struggling";

export default async function CourseDetail({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const { metric: metricParam } = await searchParams;
  const metric: Metric = metricParam === "struggling" ? "struggling" : "avg";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name, status, join_code, created_at, professor_id")
    .eq("id", id)
    .single();
  if (!course || course.professor_id !== user!.id) notFound();

  const [
    { count: enrolledCount },
    { data: conceptRows },
    { data: lectureRows },
    { data: subconceptRows },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("course_id", course.id),
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
  ]);

  const subIds = (subconceptRows ?? []).map((s) => s.id);
  // Pull every enrolled student's mastery for these subconcepts. RLS allows
  // this for the course owner via usm_prof_read.
  const { data: allMastery } =
    subIds.length > 0
      ? await supabase
          .from("user_subconcept_mastery")
          .select("subconcept_id, score")
          .in("subconcept_id", subIds)
      : { data: [] as Array<{ subconcept_id: string; score: number }> };

  // Aggregate per subconcept first (so averaging the cell averages the right
  // population, not double-weighted toward dense cells).
  type Agg = { mean: number; struggling: number; n: number };
  const subAgg = new Map<string, Agg>();
  if (allMastery) {
    const grouped = new Map<string, number[]>();
    for (const m of allMastery) {
      if (!grouped.has(m.subconcept_id)) grouped.set(m.subconcept_id, []);
      grouped.get(m.subconcept_id)!.push(m.score);
    }
    for (const [sid, scores] of grouped) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const struggling =
        scores.filter((s) => s < 0.5).length / scores.length; // fraction
      subAgg.set(sid, { mean, struggling, n: scores.length });
    }
  }

  const concepts: HeatmapConcept[] = (conceptRows ?? []).map((c) => ({
    id: c.id,
    label: c.label,
  }));
  const lectures: HeatmapLecture[] = (lectureRows ?? []).map((l, i) => ({
    id: l.id,
    label: `L${i + 1}`,
    title: l.title,
  }));

  const cells = buildCells(
    concepts,
    lectures,
    (subconceptRows ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      concept_id: s.concept_id,
      lecture_id: s.lecture_id,
    })),
    (sid) => {
      const a = subAgg.get(sid);
      if (!a) return null;
      // For "struggling", invert so that high value = good (green).
      return metric === "avg" ? a.mean : 1 - a.struggling;
    }
  );

  const formatValue =
    metric === "avg"
      ? (v: number) => v.toFixed(2)
      : (v: number) => `${Math.round((1 - v) * 100)}% struggling`;

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

        <div className="mt-6 flex items-center gap-3">
          {course.status === "published" && course.join_code ? (
            <div className="flex items-center gap-3 rounded-full border border-border bg-zinc-50 px-4 py-2">
              <span className="text-xs uppercase tracking-wider text-muted">
                Join code
              </span>
              <span className="font-mono text-base tracking-widest text-foreground">
                {course.join_code}
              </span>
            </div>
          ) : (
            <PublishButton courseId={course.id} />
          )}
          <DeleteButton courseId={course.id} />
        </div>

        <p className="mt-4 text-sm text-muted">
          {enrolledCount ?? 0}{" "}
          {enrolledCount === 1 ? "student enrolled" : "students enrolled"}
        </p>

        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-medium text-foreground">
              Class heatmap
            </h2>
            <div className="flex items-center gap-1 rounded-full border border-border bg-zinc-50 p-0.5 text-xs">
              <Link
                href={`/professor/courses/${course.id}?metric=avg`}
                className={[
                  "rounded-full px-3 py-1 transition-colors",
                  metric === "avg"
                    ? "bg-foreground text-background"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                Avg mastery
              </Link>
              <Link
                href={`/professor/courses/${course.id}?metric=struggling`}
                className={[
                  "rounded-full px-3 py-1 transition-colors",
                  metric === "struggling"
                    ? "bg-foreground text-background"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                % struggling
              </Link>
            </div>
          </div>

          <div className="mt-3">
            <Heatmap
              concepts={concepts}
              lectures={lectures}
              cells={cells}
              formatValue={formatValue}
              emptyState={
                <>
                  <p className="text-sm text-muted">
                    No concepts or lectures yet for this course.
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Add some via the editor (coming next) or seed via SQL — the
                    heatmap fills in immediately.
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
