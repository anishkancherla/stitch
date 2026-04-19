import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { PublishButton } from "./PublishButton";
import { DeleteButton } from "./DeleteButton";
import { RealtimeRibbonRefresher } from "@/components/RealtimeRibbonRefresher";
import { UploadSyllabusForm } from "./UploadSyllabusForm";
import { UploadLectureForm } from "./UploadLectureForm";
import {
  TopicMasteryDashboard,
  type SubtopicRow,
  type TopicCard,
} from "./TopicMasteryDashboard";

type Params = { id: string };

export default async function CourseDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

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

  const concepts = conceptRows ?? [];
  const lectures = lectureRows ?? [];
  const subconcepts = subconceptRows ?? [];

  const subIds = subconcepts.map((s) => s.id);
  // Pull every enrolled student's mastery for these subconcepts. RLS allows
  // this for the course owner via usm_prof_read. We need user_id this time
  // so we can aggregate per-student before tiering.
  const { data: allMastery } =
    subIds.length > 0
      ? await supabase
          .from("user_subconcept_mastery")
          .select("user_id, subconcept_id, score")
          .in("subconcept_id", subIds)
      : {
          data: [] as Array<{
            user_id: string;
            subconcept_id: string;
            score: number;
          }>,
        };

  // Index lectures and subconcepts so we can find the "earliest lecture" per
  // concept (used as the week label) without re-scanning every loop.
  const lectureById = new Map<
    string,
    { id: string; title: string; orderKey: string }
  >();
  for (const l of lectures) {
    lectureById.set(l.id, {
      id: l.id,
      title: l.title,
      orderKey: l.started_at ?? l.created_at ?? "",
    });
  }
  // Map: lecture id → its position in the chronological lectures list (1-indexed)
  // so we can synthesise a "Week N" fallback when titles are missing.
  const lectureWeekIdx = new Map<string, number>();
  lectures.forEach((l, i) => lectureWeekIdx.set(l.id, i + 1));

  const subsByConcept = new Map<
    string,
    Array<{ id: string; label: string; lecture_id: string | null }>
  >();
  for (const s of subconcepts) {
    if (!subsByConcept.has(s.concept_id)) subsByConcept.set(s.concept_id, []);
    subsByConcept.get(s.concept_id)!.push({
      id: s.id,
      label: s.label,
      lecture_id: s.lecture_id,
    });
  }
  // subconcept_id → concept_id reverse lookup, for the overall per-student
  // aggregate used in "Class avg mastery" / "Struggling students".
  const conceptIdBySub = new Map<string, string>();
  for (const s of subconcepts) conceptIdBySub.set(s.id, s.concept_id);

  // Group raw scores by (user, concept) so we can take per-student means
  // before tiering them. Aggregating at the score level would let dense
  // subconcept lists drown out sparser ones.
  const scoresByUserConcept = new Map<string, Map<string, number[]>>();
  // And per-user, across the whole course, for the "Struggling students" stat.
  const scoresByUserOverall = new Map<string, number[]>();
  // Per-subconcept scores keep things simple: each (user, subconcept) row
  // already represents one user's mastery on one subconcept, so we don't
  // need a nested map here — one score per row, one entry per user.
  const scoresBySubconcept = new Map<string, number[]>();
  for (const m of allMastery ?? []) {
    const cid = conceptIdBySub.get(m.subconcept_id);
    if (!cid) continue;
    if (!scoresByUserConcept.has(m.user_id))
      scoresByUserConcept.set(m.user_id, new Map());
    const inner = scoresByUserConcept.get(m.user_id)!;
    if (!inner.has(cid)) inner.set(cid, []);
    inner.get(cid)!.push(m.score);

    if (!scoresByUserOverall.has(m.user_id))
      scoresByUserOverall.set(m.user_id, []);
    scoresByUserOverall.get(m.user_id)!.push(m.score);

    if (!scoresBySubconcept.has(m.subconcept_id))
      scoresBySubconcept.set(m.subconcept_id, []);
    scoresBySubconcept.get(m.subconcept_id)!.push(m.score);
  }

  // Pure helper: same cut points as tierFromAvg in the dashboard component
  // — we re-implement here to avoid pulling a "use client" module into a
  // server component.
  const tierOf = (v: number | null): SubtopicRow["tier"] => {
    if (v === null) return null;
    if (v < 0.4) return "weak";
    if (v < 0.7) return "mid";
    return "strong";
  };

  // Build one TopicCard per concept that actually has subconcepts. Concepts
  // without subconcepts don't appear in the grid (matches existing ribbon
  // semantics — empty groups were dropped).
  const topics: TopicCard[] = [];
  for (const c of concepts) {
    const subs = subsByConcept.get(c.id) ?? [];
    if (subs.length === 0) continue;

    // Pick the chronologically earliest lecture among this concept's
    // subconcepts. That becomes the "week" label.
    let earliest: { title: string; idx: number; orderKey: string } | null = null;
    for (const s of subs) {
      if (!s.lecture_id) continue;
      const lec = lectureById.get(s.lecture_id);
      const idx = lectureWeekIdx.get(s.lecture_id);
      if (!lec || !idx) continue;
      if (!earliest || lec.orderKey < earliest.orderKey) {
        earliest = { title: lec.title, idx, orderKey: lec.orderKey };
      }
    }
    const weekLabel = earliest
      ? `Week ${earliest.idx} · ${earliest.title}`
      : null;

    // Collect per-student mean for this concept.
    const studentMeans: number[] = [];
    for (const [, perConcept] of scoresByUserConcept) {
      const arr = perConcept.get(c.id);
      if (!arr || arr.length === 0) continue;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      studentMeans.push(mean);
    }

    let strong = 0;
    let mid = 0;
    let weak = 0;
    for (const m of studentMeans) {
      if (m < 0.4) weak += 1;
      else if (m < 0.7) mid += 1;
      else strong += 1;
    }
    const totalStudents = studentMeans.length;
    const avgMastery =
      totalStudents > 0
        ? studentMeans.reduce((a, b) => a + b, 0) / totalStudents
        : null;
    const strugglingFrac = totalStudents > 0 ? weak / totalStudents : null;

    const tier: TopicCard["tier"] =
      avgMastery === null
        ? null
        : avgMastery < 0.4
          ? "weak"
          : avgMastery < 0.7
            ? "mid"
            : "strong";

    // Per-subconcept rollup. Sorted weakest-first so the detail panel can
    // render a "students struggle most with X" list without re-sorting on
    // the client.
    const subtopics: SubtopicRow[] = subs
      .map((s) => {
        const arr = scoresBySubconcept.get(s.id) ?? [];
        const subTotal = arr.length;
        const subAvg =
          subTotal > 0 ? arr.reduce((a, b) => a + b, 0) / subTotal : null;
        let subWeak = 0;
        for (const v of arr) if (v < 0.4) subWeak += 1;
        return {
          subconceptId: s.id,
          label: s.label,
          avgMastery: subAvg,
          totalStudents: subTotal,
          strugglingCount: subWeak,
          tier: tierOf(subAvg),
        };
      })
      .sort((a, b) => {
        // Subconcepts with no data sink to the bottom; among those with
        // data, lowest avg mastery (weakest) comes first.
        const aHas = a.avgMastery !== null;
        const bHas = b.avgMastery !== null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (!aHas) return a.label.localeCompare(b.label);
        return (a.avgMastery ?? 0) - (b.avgMastery ?? 0);
      });

    topics.push({
      conceptId: c.id,
      label: c.label,
      weekLabel,
      avgMastery,
      strugglingFrac,
      studentCounts: { strong, mid, weak },
      totalStudents,
      strugglingCount: weak,
      tier,
      subtopics,
    });
  }

  // Class-wide aggregates. We average topic-level averages (not raw scores)
  // so a topic with many subconcepts doesn't dominate the headline number.
  const topicsWithData = topics.filter((t) => t.avgMastery !== null);
  const classAvgMastery =
    topicsWithData.length > 0
      ? topicsWithData.reduce((a, t) => a + (t.avgMastery ?? 0), 0) /
        topicsWithData.length
      : null;

  // "Struggling students" = students whose overall course mean (across every
  // subconcept they have a record for) sits below the weak threshold.
  let strugglingStudents = 0;
  for (const [, scores] of scoresByUserOverall) {
    if (scores.length === 0) continue;
    const m = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (m < 0.4) strugglingStudents += 1;
  }

  let weakestTopic: TopicCard | null = null;
  let strongestTopic: TopicCard | null = null;
  for (const t of topicsWithData) {
    if (!weakestTopic || (t.avgMastery ?? 1) < (weakestTopic.avgMastery ?? 1))
      weakestTopic = t;
    if (
      !strongestTopic ||
      (t.avgMastery ?? 0) > (strongestTopic.avgMastery ?? 0)
    )
      strongestTopic = t;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <RealtimeRibbonRefresher scopeId={`prof-${course.id}`} />
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

        {concepts.length === 0 ? (
          // No syllabus yet → keep the original onboarding flow front-and-center.
          <section className="mt-12">
            <UploadSyllabusForm courseId={course.id} />
          </section>
        ) : (
          <>
            <TopicMasteryDashboard
              classAvgMastery={classAvgMastery}
              strugglingStudents={strugglingStudents}
              weakestTopic={weakestTopic}
              strongestTopic={strongestTopic}
              topics={topics}
            />

            <section className="mt-10">
              <UploadLectureForm
                courseId={course.id}
                concepts={concepts.map((c) => ({ id: c.id, label: c.label }))}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
